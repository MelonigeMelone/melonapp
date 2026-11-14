use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use unicode_normalization::UnicodeNormalization;

use base64::{Engine, engine::general_purpose::STANDARD};
use melon_crypto::{
    EncString, KdfParams, KeyPair, PasswordOptions, PrivateDataKey, PublicKey, RecoveryKey,
    SealOrigin, SealedKey, SymmetricKey, VaultKeyContext, derive_device_key, derive_master_key,
    item_aad, seal_vault_key, unwrap_account_key, vault_key_id, vault_meta_aad, wrap_account_key,
};
use serde_json::{Value, json};
use zeroize::{Zeroize, Zeroizing};

type Result<T> = std::result::Result<T, &'static str>;

struct Vault {
    key: SymmetricKey,
    version: u32,
}

pub struct Session {
    wrapping: Option<SymmetricKey>,
    account: Option<SymmetricKey>,
    identity: Option<KeyPair>,
    recovery: Option<RecoveryKey>,
    vaults: HashMap<String, Vault>,
    proofs: HashMap<String, Zeroizing<String>>,
    last_activity: Instant,
    timeout: Duration,
    active: bool,
}

impl Default for Session {
    fn default() -> Self {
        Self {
            wrapping: None,
            account: None,
            identity: None,
            recovery: None,
            vaults: HashMap::new(),
            proofs: HashMap::new(),
            last_activity: Instant::now(),
            timeout: Duration::from_secs(300),
            active: true,
        }
    }
}

fn text<'a>(a: &'a Value, name: &str) -> Result<&'a str> {
    a.get(name).and_then(Value::as_str).ok_or("invalid_request")
}

fn number(a: &Value, name: &str) -> Result<u32> {
    a.get(name)
        .and_then(Value::as_u64)
        .and_then(|n| n.try_into().ok())
        .ok_or("invalid_request")
}

fn array<'a>(a: &'a Value, name: &str) -> Result<&'a Vec<Value>> {
    a.get(name)
        .and_then(Value::as_array)
        .ok_or("invalid_request")
}

fn parse(data: &str) -> Result<EncString> {
    EncString::parse(data).map_err(|_| "invalid_ciphertext")
}

fn decrypt(key: &SymmetricKey, data: &str, aad: &[u8]) -> Result<String> {
    let bytes = key
        .decrypt(&parse(data)?, aad)
        .map_err(|_| "decrypt_failed")?;
    String::from_utf8(bytes.to_vec()).map_err(|_| "invalid_plaintext")
}

fn derive(a: &Value, password: &str, salt: &str, kdf: &str) -> Result<melon_crypto::MasterKey> {
    let password = Zeroizing::new(text(a, password)?.to_owned());
    let salt = STANDARD
        .decode(text(a, salt)?)
        .map_err(|_| "invalid_salt")?;
    let params: KdfParams = serde_json::from_value(a.get(kdf).ok_or("invalid_request")?.clone())
        .map_err(|_| "invalid_kdf")?;
    derive_master_key(&password, &salt, &params).map_err(|_| "invalid_KDF_or_password")
}

fn context<'a>(vault_id: &'a str, user_id: &'a str, key_version: u32) -> VaultKeyContext<'a> {
    VaultKeyContext {
        vault_id,
        user_id,
        key_version,
    }
}

fn sealed(
    sender: &KeyPair,
    key: &SymmetricKey,
    public: &str,
    vault: &str,
    user: &str,
    version: u32,
) -> Result<String> {
    let public = PublicKey::from_base64(public).map_err(|_| "invalid_public_key")?;
    seal_vault_key(sender, &public, key, &context(vault, user, version))
        .map(|sealed| sealed.to_string())
        .map_err(|_| "invalid_public_key")
}

fn same_password(a: &str, b: &str) -> bool {
    a.nfkc().eq(b.nfkc())
}

fn biometric_aad(scope: &str) -> Vec<u8> {
    format!("melon/native/biometric/v2/{scope}").into_bytes()
}

fn autofill_aad(scope: &str, name: &str) -> Vec<u8> {
    format!("melon/native/cache/v1/autofill/v1/{scope}/{name}").into_bytes()
}

fn wipe(value: &mut Value) {
    match value {
        Value::String(s) => s.zeroize(),
        Value::Array(values) => values.iter_mut().for_each(wipe),
        Value::Object(values) => values.values_mut().for_each(wipe),
        _ => {}
    }
}

impl Session {
    pub fn set_active(&mut self, active: bool) {
        self.active = active;
        if !active {
            self.lock();
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn is_locked(&self) -> bool {
        self.account.is_none()
            && self.wrapping.is_none()
            && self.recovery.is_none()
            && self.proofs.is_empty()
    }

    pub fn prepare_server_change(&mut self) -> Result<()> {
        if self.account.is_some() {
            return Err("lock_before_changing_server");
        }
        self.lock();
        Ok(())
    }

    pub fn lock(&mut self) {
        self.wrapping = None;
        self.account = None;
        self.identity = None;
        self.recovery = None;
        self.vaults.clear();
        self.proofs.clear();
    }

    pub fn expire(&mut self) -> bool {
        if self.last_activity.elapsed() >= self.timeout {
            let had_keys =
                self.account.is_some() || self.wrapping.is_some() || self.recovery.is_some();
            self.lock();
            return had_keys;
        }
        false
    }

    pub fn activity(&mut self) -> Result<()> {
        self.expire();
        self.require_account()?;
        self.last_activity = Instant::now();
        Ok(())
    }

    fn require_account(&self) -> Result<&SymmetricKey> {
        self.account.as_ref().ok_or("locked")
    }

    fn confirm_password(&self, a: &Value) -> Result<()> {
        self.require_account()?;
        let current = derive(a, "password", "salt", "kdf")?;
        let account = unwrap_account_key(
            &current.wrapping_key(),
            &parse(text(a, "wrappedAccountKey")?)?,
        )
        .map_err(|_| "wrong_password")?;
        if account.as_bytes() != self.require_account()?.as_bytes() {
            return Err("wrong_account");
        }
        Ok(())
    }

    fn vault(&self, id: &str) -> Result<&Vault> {
        self.require_account()?;
        self.vaults.get(id).ok_or("vault_key_missing")
    }

    fn device_key(&self, purpose: &str, scope: &str) -> Result<SymmetricKey> {
        Ok(derive_device_key(self.require_account()?, purpose, scope))
    }

    pub fn biometric_key(&mut self, scope: &str) -> Result<Zeroizing<Vec<u8>>> {
        self.expire();
        Ok(Zeroizing::new(
            self.device_key("biometric", scope)?.as_bytes().to_vec(),
        ))
    }

    pub fn biometric_snapshot(&mut self, scope: &str, metadata: Value) -> Result<String> {
        self.expire();
        let account = self.require_account()?;
        let identity = self.identity.as_ref().ok_or("locked")?;
        let key = derive_device_key(account, "biometric", scope);
        let mut value = json!({"account":STANDARD.encode(account.as_bytes()),"identity":identity.seal_with(account).to_string(),"metadata":metadata});
        let plaintext = serde_json::to_vec(&value).map(Zeroizing::new);
        wipe(&mut value);
        let plaintext = plaintext.map_err(|_| "invalid_request")?;
        Ok(key.encrypt(&plaintext, &biometric_aad(scope)).to_string())
    }

    pub fn biometric_outdated(&mut self, scope: &str, snapshot: &str) -> Result<bool> {
        self.expire();
        let account = self.require_account()?;
        if snapshot.len() > 48 * 1024 * 1024 {
            return Err("cache_too_large");
        }
        let Ok(ciphertext) = parse(snapshot) else {
            return Ok(false);
        };
        Ok(account
            .decrypt(
                &ciphertext,
                format!("melon/native/biometric/v1/{scope}").as_bytes(),
            )
            .is_ok())
    }

    pub fn biometric_configured(&mut self, scope: &str, snapshot: Option<&str>) -> Result<bool> {
        self.expire();
        let key = self.device_key("biometric", scope)?;
        let Some(snapshot) = snapshot else {
            return Ok(false);
        };
        if snapshot.len() > 48 * 1024 * 1024 {
            return Err("cache_too_large");
        }
        let Ok(ciphertext) = parse(snapshot) else {
            return Ok(false);
        };
        Ok(key.decrypt(&ciphertext, &biometric_aad(scope)).is_ok())
    }

    pub fn biometric_restore(&mut self, key: &[u8], scope: &str, snapshot: &str) -> Result<Value> {
        self.lock();
        if !self.active {
            return Err("background_locked");
        }
        let bytes: [u8; 32] = key.try_into().map_err(|_| "invalid_key")?;
        let wrap = SymmetricKey::from_bytes(bytes);
        let plaintext = wrap
            .decrypt(&parse(snapshot)?, &biometric_aad(scope))
            .map_err(|_| "decrypt_failed")?;
        let mut value: Value = serde_json::from_slice(&plaintext).map_err(|_| "invalid_cache")?;
        let result = Self::restored(&wrap, scope, &value);
        let metadata = value["metadata"].clone();
        wipe(&mut value);
        let (account, identity) = result?;
        self.account = Some(account);
        self.identity = Some(identity);
        self.last_activity = Instant::now();
        Ok(metadata)
    }

    fn restored(
        wrap: &SymmetricKey,
        scope: &str,
        value: &Value,
    ) -> Result<(SymmetricKey, KeyPair)> {
        let raw = Zeroizing::new(
            STANDARD
                .decode(text(value, "account")?)
                .map_err(|_| "invalid_cache")?,
        );
        let bytes: [u8; 32] = raw.as_slice().try_into().map_err(|_| "invalid_cache")?;
        let account = SymmetricKey::from_bytes(bytes);
        if derive_device_key(&account, "biometric", scope).as_bytes() != wrap.as_bytes() {
            return Err("decrypt_failed");
        }
        let identity = KeyPair::open_with(&account, &parse(text(value, "identity")?)?)
            .map_err(|_| "decrypt_failed")?;
        Ok((account, identity))
    }

    pub fn autofill_key(&mut self, scope: &str) -> Result<Zeroizing<Vec<u8>>> {
        self.expire();
        Ok(Zeroizing::new(
            self.device_key("autofill", scope)?.as_bytes().to_vec(),
        ))
    }

    pub fn autofill_seal(&mut self, scope: &str, name: &str, plaintext: &[u8]) -> Result<String> {
        self.expire();
        if plaintext.len() > 32 * 1024 * 1024 {
            return Err("cache_too_large");
        }
        Ok(self
            .device_key("autofill", scope)?
            .encrypt(plaintext, &autofill_aad(scope, name))
            .to_string())
    }

    pub fn autofill_open(
        &mut self,
        scope: &str,
        name: &str,
        ciphertext: &str,
    ) -> Result<Zeroizing<Vec<u8>>> {
        self.expire();
        if ciphertext.len() > 48 * 1024 * 1024 {
            return Err("cache_too_large");
        }
        self.device_key("autofill", scope)?
            .decrypt(&parse(ciphertext)?, &autofill_aad(scope, name))
            .map_err(|_| "decrypt_failed")
    }

    pub fn autofill_passkey_seal(
        &mut self,
        scope: &str,
        rp: &str,
        id: &[u8],
        private: &[u8],
    ) -> Result<String> {
        self.expire();
        melon_crypto::seal_passkey_key(&self.device_key("autofill", scope)?, rp, id, private)
            .map_err(|_| "invalid_passkey")
    }

    pub fn autofill_passkey_open(
        &mut self,
        scope: &str,
        rp: &str,
        id: &[u8],
        encrypted_key: &str,
    ) -> Result<Zeroizing<Vec<u8>>> {
        self.expire();
        melon_crypto::open_passkey_key(&self.device_key("autofill", scope)?, rp, id, encrypted_key)
            .map_err(|_| "decrypt_failed")
    }

    pub fn passkey_open(
        &mut self,
        rp: &str,
        id: &[u8],
        encrypted_key: &str,
    ) -> Result<Zeroizing<Vec<u8>>> {
        self.expire();
        melon_crypto::open_passkey_key(self.require_account()?, rp, id, encrypted_key)
            .map_err(|_| "decrypt_failed")
    }

    pub fn passkey_seal(&mut self, rp: &str, id: &[u8], private: &[u8]) -> Result<String> {
        self.expire();
        melon_crypto::seal_passkey_key(self.require_account()?, rp, id, private)
            .map_err(|_| "invalid_passkey")
    }

    pub fn cache_seal(&mut self, scope: &str, plaintext: &[u8]) -> Result<String> {
        self.expire();
        if plaintext.len() > 32 * 1024 * 1024 {
            return Err("cache_too_large");
        }
        Ok(self
            .require_account()?
            .encrypt(
                plaintext,
                format!("melon/native/cache/v1/{scope}").as_bytes(),
            )
            .to_string())
    }

    pub fn cache_open(&mut self, scope: &str, ciphertext: &str) -> Result<Zeroizing<Vec<u8>>> {
        self.expire();
        if ciphertext.len() > 48 * 1024 * 1024 {
            return Err("cache_too_large");
        }
        self.require_account()?
            .decrypt(
                &parse(ciphertext)?,
                format!("melon/native/cache/v1/{scope}").as_bytes(),
            )
            .map_err(|_| "decrypt_failed")
    }

    pub fn call(&mut self, method: &str, mut a: Value) -> Result<Value> {
        let result = self.call_inner(method, &a);
        wipe(&mut a);
        if result.is_err() && matches!(method, "unlock" | "createAccount") {
            self.lock();
        }
        let mut result = result?;
        if matches!(method, "derive" | "recoveryAuth") {
            self.hide_proof(&mut result)?;
        } else if let Value::Object(fields) = &mut result {
            for name in ["authKey", "currentAuthKey", "recoveryAuthKey"] {
                if let Some(value) = fields.get_mut(name) {
                    self.hide_proof(value)?;
                }
            }
        }
        Ok(result)
    }

    fn hide_proof(&mut self, value: &mut Value) -> Result<()> {
        if self.proofs.len() >= 32 {
            return Err("too_many_pending_auth_requests");
        }
        let proof = value.as_str().ok_or("invalid_auth_proof")?.to_owned();
        wipe(value);
        let handle = format!(
            "native-proof:{}",
            STANDARD.encode(melon_crypto::generate_salt())
        );
        self.proofs.insert(handle.clone(), Zeroizing::new(proof));
        *value = json!(handle);
        Ok(())
    }

    pub fn resolve_auth_proofs(&mut self, body: &mut Value) -> Result<()> {
        self.expire();
        if let Value::Object(fields) = body {
            for name in ["auth_key", "current_auth_key", "recovery_auth_key"] {
                if let Some(value) = fields.get_mut(name) {
                    let proof = self
                        .proofs
                        .get(value.as_str().ok_or("invalid_auth_handle")?)
                        .ok_or("invalid_auth_handle")?;
                    *value = json!(proof.as_str());
                }
            }
        }
        Ok(())
    }

    fn call_inner(&mut self, method: &str, a: &Value) -> Result<Value> {
        self.expire();
        if !self.active && method != "lock" {
            return Err("background_locked");
        }
        match method {
            "lock" => {
                self.lock();
                Ok(Value::Null)
            }
            "activity" => {
                self.activity()?;
                Ok(Value::Null)
            }
            "generateSalt" => Ok(json!(STANDARD.encode(melon_crypto::generate_salt()))),
            "generatePassword" => {
                let flag = |name| {
                    a.get(name)
                        .and_then(Value::as_bool)
                        .ok_or("invalid_request")
                };
                let options = PasswordOptions {
                    length: number(a, "length")? as usize,
                    lowercase: flag("lowercase")?,
                    uppercase: flag("uppercase")?,
                    digits: flag("digits")?,
                    symbols: flag("symbols")?,
                    avoid_ambiguous: flag("avoidAmbiguous")?,
                };
                Ok(json!(
                    melon_crypto::generate_password(&options)
                        .map_err(|_| "invalid_options")?
                        .to_string()
                ))
            }
            "derive" => {
                self.lock();
                let master = derive(a, "password", "salt", "kdf")?;
                self.wrapping = Some(master.wrapping_key());
                self.last_activity = Instant::now();
                Ok(json!(master.auth_key().to_base64()))
            }
            "createAccount" => {
                let wrapping = self.wrapping.take().ok_or("keys_not_derived")?;
                let account = SymmetricKey::generate();
                let identity = KeyPair::generate();
                let key = SymmetricKey::generate();
                let id = text(a, "personalVaultId")?;
                let result = json!({"wrappedAccountKey": wrap_account_key(&wrapping, &account).to_string(), "publicKey": identity.public_key().to_base64(), "encryptedPrivateKey": identity.seal_with(&account).to_string(), "personalVault": {"encryptedMeta": key.encrypt(text(a,"meta")?.as_bytes(), &vault_meta_aad(id,1)).to_string(), "encryptedVaultKey": sealed(&identity,&key,&identity.public_key().to_base64(), id,text(a,"userId")?,1)?}});
                self.account = Some(account);
                self.identity = Some(identity);
                self.vaults.insert(id.to_owned(), Vault { key, version: 1 });
                Ok(result)
            }
            "unlock" => {
                let wrapping = self.wrapping.take().ok_or("keys_not_derived")?;
                let account = unwrap_account_key(&wrapping, &parse(text(a, "wrappedAccountKey")?)?)
                    .map_err(|_| "decrypt_failed")?;
                let identity =
                    KeyPair::open_with(&account, &parse(text(a, "encryptedPrivateKey")?)?)
                        .map_err(|_| "decrypt_failed")?;
                let public = identity.public_key().to_base64();
                self.account = Some(account);
                self.identity = Some(identity);
                self.last_activity = Instant::now();
                Ok(json!(public))
            }
            "openVault" => {
                self.require_account()?;
                let id = text(a, "vaultId")?;
                let version = number(a, "keyVersion")?;
                let (positions, senders): (Vec<usize>, Vec<PublicKey>) = array(a, "senders")?
                    .iter()
                    .enumerate()
                    .filter_map(|(i, s)| Some((i, PublicKey::from_base64(s.as_str()?).ok()?)))
                    .unzip();
                let (key, origin) = self
                    .identity
                    .as_ref()
                    .ok_or("locked")?
                    .open_vault_key(
                        &SealedKey::parse(text(a, "sealed")?).map_err(|_| "invalid_ciphertext")?,
                        &context(id, text(a, "userId")?, version),
                        &senders,
                    )
                    .map_err(|_| "decrypt_failed")?;
                let sender = match origin {
                    SealOrigin::Legacy if a.get("legacy") == Some(&Value::Bool(true)) => {
                        Value::Null
                    }
                    SealOrigin::Legacy => return Err("vault_key_unauthenticated"),
                    SealOrigin::Sender(i) => json!(positions[i]),
                };
                let key_id = vault_key_id(&key, id, version);
                match a.get("pinned") {
                    None | Some(Value::Null) => {}
                    Some(Value::String(pinned)) if *pinned == key_id => {}
                    Some(Value::String(_)) => return Err("vault_key_changed"),
                    Some(_) => return Err("invalid_argument"),
                }
                self.vaults.insert(id.to_owned(), Vault { key, version });
                Ok(json!({"sender": sender, "keyId": key_id}))
            }
            "newVault" => {
                self.require_account()?;
                let identity = self.identity.as_ref().ok_or("locked")?;
                let id = text(a, "vaultId")?;
                let key = SymmetricKey::generate();
                let result = json!({"encryptedMeta":key.encrypt(text(a,"meta")?.as_bytes(), &vault_meta_aad(id,1)).to_string(),"encryptedVaultKey":sealed(identity,&key,&identity.public_key().to_base64(),id,text(a,"userId")?,1)?});
                self.vaults.insert(id.to_owned(), Vault { key, version: 1 });
                Ok(result)
            }
            "ownPublicKey" => Ok(json!(
                self.identity
                    .as_ref()
                    .ok_or("locked")?
                    .public_key()
                    .to_base64()
            )),
            "hasVault" => Ok(json!(
                self.vault(text(a, "vaultId")?)
                    .is_ok_and(|v| v.version == number(a, "keyVersion").unwrap_or(0))
            )),
            "encryptMeta" | "decryptMeta" | "encryptItem" | "decryptItems" | "sealFor"
            | "rotate" => self.vault_call(method, a),
            "sealPrivate" => {
                let key = PrivateDataKey::derive(self.require_account()?);
                Ok(json!(
                    key.seal(
                        text(a, "userId")?,
                        text(a, "purpose")?,
                        text(a, "plaintext")?.as_bytes()
                    )
                    .to_string()
                ))
            }
            "openPrivate" => {
                let key = PrivateDataKey::derive(self.require_account()?);
                let plain = key
                    .open(
                        text(a, "userId")?,
                        text(a, "purpose")?,
                        &parse(text(a, "data")?)?,
                    )
                    .map_err(|_| "decrypt_failed")?;
                Ok(json!(
                    String::from_utf8(plain.to_vec()).map_err(|_| "decrypt_failed")?
                ))
            }
            "fingerprint" => Ok(json!(melon_crypto::fingerprint(
                &PublicKey::from_base64(text(a, "publicKey")?).map_err(|_| "invalid_public_key")?
            ))),
            "checkPassword" => {
                self.confirm_password(a)?;
                Ok(json!(true))
            }
            "sealExport" => {
                self.confirm_password(a)?;
                if same_password(text(a, "password")?, text(a, "exportPassword")?) {
                    return Err("export_password_is_master_password");
                }
                melon_crypto::seal_export(
                    text(a, "exportPassword")?,
                    text(a, "plaintext")?.as_bytes(),
                )
                .map(|file| json!(file))
                .map_err(|e| match e {
                    melon_crypto::CryptoError::WeakExportPassword => "weak_export_password",
                    _ => "export_failed",
                })
            }
            "openExport" => {
                let plain = melon_crypto::open_export(text(a, "password")?, text(a, "data")?)
                    .map_err(|e| match e {
                        melon_crypto::CryptoError::Decrypt => "wrong_export_password",
                        melon_crypto::CryptoError::UnsupportedVersion => "unsupported_export",
                        _ => "invalid_export",
                    })?;
                String::from_utf8(plain.to_vec())
                    .map(|s| json!(s))
                    .map_err(|_| "invalid_export")
            }
            "setupRecovery" | "changePassword" => {
                self.require_account()?;
                let current = derive(a, "password", "salt", "kdf")?;
                let account = unwrap_account_key(
                    &current.wrapping_key(),
                    &parse(text(a, "wrappedAccountKey")?)?,
                )
                .map_err(|_| "wrong_password")?;
                if account.as_bytes() != self.require_account()?.as_bytes() {
                    return Err("wrong_account");
                }
                if method == "setupRecovery" {
                    let recovery = RecoveryKey::generate();
                    Ok(
                        json!({"currentAuthKey":current.auth_key().to_base64(),"recoveryKey":recovery.display().to_string(),"recoveryAuthKey":recovery.auth_key().to_base64(),"recoveryWrappedAccountKey":recovery.wrap_account_key(&account).to_string()}),
                    )
                } else {
                    let next = derive(a, "newPassword", "newSalt", "newKdf")?;
                    Ok(
                        json!({"currentAuthKey":current.auth_key().to_base64(),"authKey":next.auth_key().to_base64(),"wrappedAccountKey":wrap_account_key(&next.wrapping_key(),&account).to_string()}),
                    )
                }
            }
            "recoveryAuth" => {
                self.lock();
                let key = Zeroizing::new(text(a, "recoveryKey")?.to_owned());
                let recovery = RecoveryKey::parse(&key).map_err(|_| "invalid_recovery_key")?;
                let auth = recovery.auth_key().to_base64();
                self.recovery = Some(recovery);
                self.last_activity = Instant::now();
                Ok(json!(auth))
            }
            "recoveryReset" => {
                let recovery = self.recovery.take().ok_or("recovery_not_started")?;
                let account = recovery
                    .unwrap_account_key(&parse(text(a, "recoveryWrappedAccountKey")?)?)
                    .map_err(|_| "decrypt_failed")?;
                let next = derive(a, "newPassword", "newSalt", "newKdf")?;
                Ok(
                    json!({"authKey":next.auth_key().to_base64(),"wrappedAccountKey":wrap_account_key(&next.wrapping_key(),&account).to_string()}),
                )
            }
            _ => Err("unsupported_method"),
        }
    }

    fn vault_call(&self, method: &str, a: &Value) -> Result<Value> {
        let id = text(a, "vaultId")?;
        let v = self.vault(id)?;
        let identity = self.identity.as_ref().ok_or("locked")?;
        match method {
            "encryptMeta" => Ok(json!(
                v.key
                    .encrypt(
                        text(a, "plaintext")?.as_bytes(),
                        &vault_meta_aad(id, v.version)
                    )
                    .to_string()
            )),
            "decryptMeta" => Ok(json!(decrypt(
                &v.key,
                text(a, "data")?,
                &vault_meta_aad(id, v.version)
            )?)),
            "encryptItem" => Ok(json!(
                v.key
                    .encrypt(
                        text(a, "plaintext")?.as_bytes(),
                        &item_aad(id, text(a, "itemId")?, v.version)
                    )
                    .to_string()
            )),
            "decryptItems" => {
                let results: Result<Vec<Value>> = array(a, "items")?
                    .iter()
                    .map(|item| {
                        let item_id = text(item, "id")?;
                        let result = if number(item, "keyVersion")? != v.version {
                            Err("key_version_mismatch")
                        } else {
                            decrypt(
                                &v.key,
                                text(item, "data")?,
                                &item_aad(id, item_id, v.version),
                            )
                        };
                        Ok(match result {
                            Ok(plaintext) => json!({"id":item_id,"plaintext":plaintext}),
                            Err(error) => json!({"id":item_id,"error":error}),
                        })
                    })
                    .collect();
                Ok(json!(results?))
            }
            "sealFor" => Ok(json!(sealed(
                identity,
                &v.key,
                text(a, "publicKey")?,
                id,
                text(a, "userId")?,
                v.version
            )?)),
            "rotate" => {
                let next = v.version.checked_add(1).ok_or("invalid_version")?;
                let key = SymmetricKey::generate();
                let members: Result<Vec<Value>> = array(a,"members")?.iter().map(|m| Ok(json!({"user_id":text(m,"userId")?,"encrypted_vault_key":sealed(identity,&key,text(m,"publicKey")?,id,text(m,"userId")?,next)?}))).collect();
                let items: Result<Vec<Value>> = array(a,"items")?.iter().map(|i| Ok(json!({"id":text(i,"id")?,"data":key.encrypt(text(i,"plaintext")?.as_bytes(),&item_aad(id,text(i,"id")?,next)).to_string()}))).collect();
                Ok(
                    json!({"encryptedMeta":key.encrypt(text(a,"meta")?.as_bytes(),&vault_meta_aad(id,next)).to_string(),"members":members?,"items":items?}),
                )
            }
            _ => Err("unsupported_method"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEGACY_PRIVATE: &str = "1.le7Bu4FdIov-f-gIjgG54vWZGAcWp4tgm_6neURlCJpzZVYx8EeijJ_zbzUzKCICCGXaPT_4G_g-_wbsNIoBwW2IBAUIDhmz";
    const LEGACY_SEALED: &str = "h1.LK_MzopzpzCIQGJ9fXY4pWjtDypDKFeZcQR3dMYTfzqSwWYOQdCf0j_PUAeOdxMD45jJ2PPFijVSoIKD60ejhpRWtq8S4bT26vXWWTBgcNQ";

    fn account() -> (Session, Value) {
        let mut session = Session::default();
        session.call("derive", json!({"password":"test-password", "salt":STANDARD.encode(b"0123456789abcdef"), "kdf":KdfParams::minimum()})).unwrap();
        let created = session
            .call(
                "createAccount",
                json!({"userId":"user", "personalVaultId":"vault", "meta":"private name"}),
            )
            .unwrap();
        (session, created)
    }

    #[test]
    fn private_data_is_bound_to_the_account_user_and_purpose() {
        let (mut session, _) = account();
        let (mut other, _) = account();
        let sealed = session
            .call(
                "sealPrivate",
                json!({"userId":"user","purpose":"verified-codes","plaintext":"marks"}),
            )
            .unwrap();
        let open = |s: &mut Session, user: &str, purpose: &str| {
            s.call(
                "openPrivate",
                json!({"userId":user,"purpose":purpose,"data":sealed.clone()}),
            )
        };
        assert_eq!(
            open(&mut session, "user", "verified-codes"),
            Ok(json!("marks"))
        );
        assert!(open(&mut session, "other", "verified-codes").is_err());
        assert!(open(&mut session, "user", "export").is_err());
        assert!(open(&mut other, "user", "verified-codes").is_err());
        session.lock();
        assert_eq!(open(&mut session, "user", "verified-codes"), Err("locked"));
    }

    #[test]
    fn biometric_status_is_account_and_context_bound_and_requires_an_unlocked_session() {
        let (mut session, _) = account();
        let snapshot = session
            .biometric_snapshot("server/biometric", json!({"token":"secret"}))
            .unwrap();
        assert_eq!(
            session.biometric_configured("server/biometric", None),
            Ok(false)
        );
        assert_eq!(
            session.biometric_configured("server/biometric", Some(&snapshot)),
            Ok(true)
        );
        assert_eq!(
            session.biometric_configured("other/biometric", Some(&snapshot)),
            Ok(false)
        );
        let (mut other, _) = account();
        assert_eq!(
            other.biometric_configured("server/biometric", Some(&snapshot)),
            Ok(false)
        );
        assert_eq!(
            session.biometric_configured("server/biometric", Some(&snapshot[..snapshot.len() - 1])),
            Ok(false)
        );
        let cache = session.cache_seal("server/biometric", b"secret").unwrap();
        assert_eq!(
            session.biometric_configured("server/biometric", Some(&cache)),
            Ok(false)
        );
        session.lock();
        assert_eq!(
            session.biometric_configured("server/biometric", Some(&snapshot)),
            Err("locked")
        );
        assert_eq!(
            session.biometric_configured("server/biometric", None),
            Err("locked")
        );
        assert!(session.is_locked());
    }

    #[test]
    fn biometric_status_does_not_extend_the_native_lock_timeout() {
        let (mut session, _) = account();
        let snapshot = session
            .biometric_snapshot("server/biometric", json!({}))
            .unwrap();
        let activity = session.last_activity;
        assert_eq!(
            session.biometric_configured("server/biometric", Some(&snapshot)),
            Ok(true)
        );
        assert_eq!(session.last_activity, activity);
        session.last_activity = Instant::now() - Duration::from_secs(301);
        assert_eq!(
            session.biometric_configured("server/biometric", Some(&snapshot)),
            Err("locked")
        );
        assert!(session.is_locked());
    }

    #[test]
    fn sharing_and_rotation_preserve_context_and_versions() {
        let (mut owner, owner_account) = account();
        let (mut guest, guest_account) = account();
        let senders = json!([owner_account["publicKey"]]);
        let sealed = owner
            .call(
                "sealFor",
                json!({"vaultId":"vault","publicKey":guest_account["publicKey"],"userId":"guest"}),
            )
            .unwrap();
        assert!(
            guest
                .call(
                    "openVault",
                    json!({"vaultId":"vault","userId":"attacker","keyVersion":1,"sealed":sealed,"senders":senders})
                )
                .is_err()
        );
        let opened = guest
            .call(
                "openVault",
                json!({"vaultId":"vault","userId":"guest","keyVersion":1,"sealed":sealed,"senders":senders}),
            )
            .unwrap();
        assert_eq!(opened["sender"], 0);
        let data = owner
            .call(
                "encryptItem",
                json!({"vaultId":"vault","itemId":"item","plaintext":"shared"}),
            )
            .unwrap();
        let result = guest
            .call(
                "decryptItems",
                json!({"vaultId":"vault","items":[{"id":"item","data":data,"keyVersion":1}]}),
            )
            .unwrap();
        assert_eq!(result[0]["plaintext"], "shared");
        let rotated = owner.call("rotate",json!({"vaultId":"vault","meta":"new name","members":[{"userId":"guest","publicKey":guest_account["publicKey"]}],"items":[{"id":"item","plaintext":"rotated"}]})).unwrap();
        let item = json!({"vaultId":"vault","items":[{"id":"item","data":rotated["items"][0]["data"],"keyVersion":2}]});
        assert_eq!(
            guest.call("decryptItems", item.clone()).unwrap()[0]["error"],
            "key_version_mismatch"
        );
        guest.call("openVault",json!({"vaultId":"vault","userId":"guest","keyVersion":2,"sealed":rotated["members"][0]["encrypted_vault_key"],"senders":senders})).unwrap();
        assert_eq!(
            guest.call("decryptItems", item).unwrap()[0]["plaintext"],
            "rotated"
        );
        assert_eq!(
            owner
                .call("hasVault", json!({"vaultId":"vault","keyVersion":1}))
                .unwrap(),
            true
        );
    }

    fn open_args(sealed: &Value, senders: Value, extra: Value) -> Value {
        let mut args = json!({"vaultId":"vault","userId":"guest","keyVersion":1,"sealed":sealed,"senders":senders});
        for (k, v) in extra.as_object().unwrap() {
            args[k] = v.clone();
        }
        args
    }

    #[test]
    fn vault_key_from_a_sender_outside_the_list_is_refused() {
        let (mut server, server_account) = account();
        let (mut guest, guest_account) = account();
        let forged = server
            .call(
                "sealFor",
                json!({"vaultId":"vault","publicKey":guest_account["publicKey"],"userId":"guest"}),
            )
            .unwrap();
        let before = guest.vaults.get("vault").map(|v| v.key.as_bytes().to_vec());
        assert_eq!(
            guest
                .call(
                    "openVault",
                    open_args(&forged, json!([guest_account["publicKey"]]), json!({}))
                )
                .err(),
            Some("decrypt_failed")
        );
        assert_eq!(
            guest.vaults.get("vault").map(|v| v.key.as_bytes().to_vec()),
            before
        );
        let opened = guest
            .call(
                "openVault",
                open_args(&forged, json!([server_account["publicKey"]]), json!({})),
            )
            .unwrap();
        assert_eq!(opened["sender"], 0);
    }

    #[test]
    fn vault_key_that_does_not_match_the_pinned_one_is_refused() {
        let (mut owner, owner_account) = account();
        let (mut guest, guest_account) = account();
        let sealed = owner
            .call(
                "sealFor",
                json!({"vaultId":"vault","publicKey":guest_account["publicKey"],"userId":"guest"}),
            )
            .unwrap();
        let senders = json!([owner_account["publicKey"]]);
        let before = guest.vaults.get("vault").map(|v| v.key.as_bytes().to_vec());
        assert_eq!(
            guest
                .call(
                    "openVault",
                    open_args(&sealed, senders.clone(), json!({"pinned":"other"}))
                )
                .err(),
            Some("vault_key_changed")
        );
        assert_eq!(
            guest.vaults.get("vault").map(|v| v.key.as_bytes().to_vec()),
            before
        );
        let first = guest
            .call("openVault", open_args(&sealed, senders.clone(), json!({})))
            .unwrap();
        guest
            .call(
                "openVault",
                open_args(&sealed, senders, json!({"pinned":first["keyId"]})),
            )
            .unwrap();
    }

    #[test]
    fn sealing_for_a_weak_public_key_fails_without_breaking_the_session() {
        let (mut owner, _) = account();
        let zero = STANDARD.encode([0u8; 32]);
        assert_eq!(
            owner
                .call(
                    "sealFor",
                    json!({"vaultId":"vault","publicKey":zero,"userId":"eve"})
                )
                .err(),
            Some("invalid_public_key")
        );
        assert_eq!(
            owner.call("rotate", json!({"vaultId":"vault","meta":"m","members":[{"userId":"eve","publicKey":zero}],"items":[]})).err(),
            Some("invalid_public_key")
        );
        assert!(
            owner
                .call(
                    "encryptMeta",
                    json!({"vaultId":"vault","plaintext":"still works"})
                )
                .is_ok()
        );
    }

    #[test]
    fn an_unusable_sender_key_is_skipped_and_positions_stay_right() {
        let (mut owner, owner_account) = account();
        let (mut guest, guest_account) = account();
        let sealed = owner
            .call(
                "sealFor",
                json!({"vaultId":"vault","publicKey":guest_account["publicKey"],"userId":"guest"}),
            )
            .unwrap();
        let senders = json!([
            "kaputt",
            STANDARD.encode([0u8; 32]),
            owner_account["publicKey"]
        ]);
        let opened = guest
            .call("openVault", open_args(&sealed, senders, json!({})))
            .unwrap();
        assert_eq!(opened["sender"], 2);
    }

    #[test]
    fn legacy_vault_key_opens_only_when_allowed() {
        let mut session = Session::default();
        let account = SymmetricKey::from_bytes([9u8; 32]);
        session.identity =
            Some(KeyPair::open_with(&account, &EncString::parse(LEGACY_PRIVATE).unwrap()).unwrap());
        session.account = Some(account);
        let args = json!({"vaultId":"vault-1","userId":"user-1","keyVersion":1,"sealed":LEGACY_SEALED,"senders":[]});
        assert_eq!(
            session.call("openVault", args.clone()).err(),
            Some("vault_key_unauthenticated")
        );
        assert!(session.vaults.is_empty());
        let mut allowed = args;
        allowed["legacy"] = json!(true);
        let opened = session.call("openVault", allowed).unwrap();
        assert_eq!(opened["sender"], Value::Null);
    }

    #[test]
    fn password_change_and_recovery_preserve_account_and_reject_wrong_password() {
        let (mut session, created) = account();
        let mut reauth = json!({"password":"wrong","salt":STANDARD.encode(b"0123456789abcdef"),"kdf":KdfParams::minimum(),"wrappedAccountKey":created["wrappedAccountKey"],"newPassword":"next-password","newSalt":STANDARD.encode(b"fedcba9876543210"),"newKdf":KdfParams::minimum()});
        assert_eq!(
            session.call("changePassword", reauth.clone()).err(),
            Some("wrong_password")
        );
        reauth["password"] = json!("test-password");
        let recovery = session.call("setupRecovery", reauth.clone()).unwrap();
        let changed = session.call("changePassword", reauth).unwrap();
        assert!(
            changed["authKey"]
                .as_str()
                .unwrap()
                .starts_with("native-proof:")
        );
        session.call("derive",json!({"password":"next-password","salt":STANDARD.encode(b"fedcba9876543210"),"kdf":KdfParams::minimum()})).unwrap();
        assert_eq!(session.call("unlock",json!({"wrappedAccountKey":changed["wrappedAccountKey"],"encryptedPrivateKey":created["encryptedPrivateKey"]})).unwrap(),created["publicKey"]);
        session
            .call(
                "recoveryAuth",
                json!({"recoveryKey":recovery["recoveryKey"]}),
            )
            .unwrap();
        let reset = session.call("recoveryReset",json!({"recoveryWrappedAccountKey":recovery["recoveryWrappedAccountKey"],"newPassword":"reset-password","newSalt":STANDARD.encode(b"0123456789abcdef"),"newKdf":KdfParams::minimum()})).unwrap();
        assert!(session.call("recoveryReset", json!({})).is_err());
        session.call("derive",json!({"password":"reset-password","salt":STANDARD.encode(b"0123456789abcdef"),"kdf":KdfParams::minimum()})).unwrap();
        assert_eq!(session.call("unlock",json!({"wrappedAccountKey":reset["wrappedAccountKey"],"encryptedPrivateKey":created["encryptedPrivateKey"]})).unwrap(),created["publicKey"]);
    }

    #[test]
    fn passkey_keys_move_between_wrappings_only_with_the_unlocked_account() {
        let (mut session, _) = account();
        let device = autofill_key(&mut session, "scope");
        let created = melon_crypto::create_passkey(&device, "example.com").unwrap();
        let id = created.credential_id.clone();
        let private = session
            .autofill_passkey_open("scope", "example.com", &id, &created.encrypted_key)
            .unwrap();
        assert!(
            session
                .passkey_open("example.com", &id, &created.encrypted_key)
                .is_err()
        );
        let sealed = session
            .autofill_passkey_seal("scope", "example.com", &id, &private)
            .unwrap();
        assert!(
            melon_crypto::assert_passkey(&device, "example.com", &id, &sealed, &[1; 32]).is_ok()
        );
        let legacy = session.passkey_seal("example.com", &id, &private).unwrap();
        assert_eq!(
            &*session.passkey_open("example.com", &id, &legacy).unwrap(),
            &*private
        );
        assert!(
            melon_crypto::assert_passkey(&device, "example.com", &id, &legacy, &[1; 32]).is_err()
        );
        for (scope, rp) in [("other", "example.com"), ("scope", "other.example")] {
            assert!(
                session
                    .autofill_passkey_open(scope, rp, &id, &created.encrypted_key)
                    .is_err()
            );
        }
        let (mut other, _) = account();
        assert!(
            other
                .autofill_passkey_open("scope", "example.com", &id, &created.encrypted_key)
                .is_err()
        );
        session.lock();
        assert_eq!(
            session
                .autofill_passkey_open("scope", "example.com", &id, &created.encrypted_key)
                .err(),
            Some("locked")
        );
        assert_eq!(
            session
                .autofill_passkey_seal("scope", "example.com", &id, &private)
                .err(),
            Some("locked")
        );
        assert_eq!(session.autofill_key("scope").err(), Some("locked"));
    }

    fn autofill_key(session: &mut Session, scope: &str) -> SymmetricKey {
        SymmetricKey::from_bytes(
            session
                .autofill_key(scope)
                .unwrap()
                .as_slice()
                .try_into()
                .unwrap(),
        )
    }

    #[test]
    fn autofill_key_cannot_open_the_account() {
        let (mut session, created) = account();
        let device = autofill_key(&mut session, "scope");
        let encrypted = parse(created["encryptedPrivateKey"].as_str().unwrap()).unwrap();
        assert!(KeyPair::open_with(&device, &encrypted).is_err());
        assert!(KeyPair::open_with(session.account.as_ref().unwrap(), &encrypted).is_ok());
        assert_ne!(
            device.as_bytes(),
            session.account.as_ref().unwrap().as_bytes()
        );
        let cached = session
            .cache_seal("https://melon.example/x", b"secret")
            .unwrap();
        assert!(
            device
                .decrypt(
                    &parse(&cached).unwrap(),
                    b"melon/native/cache/v1/https://melon.example/x"
                )
                .is_err()
        );
        let forged = device
            .encrypt(b"forged", b"melon/native/cache/v1/https://melon.example/x")
            .to_string();
        assert!(
            session
                .cache_open("https://melon.example/x", &forged)
                .is_err()
        );
        let biometric = session.biometric_key("server/biometric").unwrap();
        assert_ne!(biometric.as_slice(), device.as_bytes());
        assert_ne!(
            device.as_bytes(),
            autofill_key(&mut session, "other").as_bytes()
        );
    }

    #[test]
    fn autofill_files_open_only_with_their_scope_and_name() {
        let (mut session, _) = account();
        let sealed = session.autofill_seal("scope", "passwords", b"[]").unwrap();
        assert_eq!(
            &*session
                .autofill_open("scope", "passwords", &sealed)
                .unwrap(),
            b"[]"
        );
        assert!(session.autofill_open("scope", "synced", &sealed).is_err());
        assert!(
            session
                .autofill_open("other", "passwords", &sealed)
                .is_err()
        );
        assert!(
            session
                .cache_open("autofill/v1/scope/passwords", &sealed)
                .is_err()
        );
        let device = autofill_key(&mut session, "scope");
        assert_eq!(
            &*device
                .decrypt(
                    &parse(&sealed).unwrap(),
                    b"melon/native/cache/v1/autofill/v1/scope/passwords"
                )
                .unwrap(),
            b"[]"
        );
        let (mut other, _) = account();
        assert!(other.autofill_open("scope", "passwords", &sealed).is_err());
    }

    #[test]
    fn background_rejects_pending_biometric_restore_and_new_derivation() {
        let (mut session, _) = account();
        let key = session.biometric_key("test").unwrap();
        let snapshot = session.biometric_snapshot("test", json!({})).unwrap();
        session.set_active(false);
        assert_eq!(
            session.biometric_restore(&key, "test", &snapshot).err(),
            Some("background_locked")
        );
        assert_eq!(
            session.call("derive", json!({})).err(),
            Some("background_locked")
        );
        session.set_active(true);
        assert!(session.is_locked());
        assert!(session.biometric_restore(&key, "test", &snapshot).is_ok());
    }

    #[test]
    fn auth_proofs_stay_native_and_handles_expire_on_lock() {
        let mut session = Session::default();
        let handle = session.call("derive",json!({"password":"test-password", "salt":STANDARD.encode(b"0123456789abcdef"), "kdf":KdfParams::minimum()})).unwrap();
        assert!(handle.as_str().unwrap().starts_with("native-proof:"));
        let mut body = json!({"auth_key":handle});
        session.resolve_auth_proofs(&mut body).unwrap();
        assert!(
            !body["auth_key"]
                .as_str()
                .unwrap()
                .starts_with("native-proof:")
        );
        assert_eq!(
            STANDARD
                .decode(body["auth_key"].as_str().unwrap())
                .unwrap()
                .len(),
            32
        );
        assert!(
            session
                .resolve_auth_proofs(&mut json!({"auth_key":"forged"}))
                .is_err()
        );
        session.lock();
        assert!(
            session
                .resolve_auth_proofs(&mut json!({"auth_key":handle}))
                .is_err()
        );
    }

    #[test]
    fn biometric_restore_authenticates_snapshot_and_never_returns_keys() {
        let (mut session, _) = account();
        let key = session.biometric_key("server/account").unwrap();
        assert_ne!(key.as_slice(), session.account.as_ref().unwrap().as_bytes());
        let snapshot = session
            .biometric_snapshot("server/account", json!({"email":"test@example.com"}))
            .unwrap();
        session.lock();
        let metadata = session
            .biometric_restore(&key, "server/account", &snapshot)
            .unwrap();
        assert_eq!(metadata, json!({"email":"test@example.com"}));
        assert!(session.identity.is_some());
        assert!(
            session
                .biometric_restore(&[0; 32], "server/account", &snapshot)
                .is_err()
        );
        assert!(session.account.is_none());
        assert!(
            session
                .biometric_restore(&key, "other/account", &snapshot)
                .is_err()
        );
        assert!(session.account.is_none());
        let (mut other, _) = account();
        let foreign_key = other.biometric_key("server/account").unwrap();
        let foreign = other
            .biometric_snapshot("server/account", json!({}))
            .unwrap();
        let account_bytes = other.account.as_ref().unwrap().as_bytes().to_vec();
        let swapped = SymmetricKey::from_bytes(foreign_key.as_slice().try_into().unwrap());
        let mut plain: Value = serde_json::from_slice(
            &swapped
                .decrypt(&parse(&foreign).unwrap(), &biometric_aad("server/account"))
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            STANDARD.decode(plain["account"].as_str().unwrap()).unwrap(),
            account_bytes
        );
        plain["account"] = json!(STANDARD.encode([1u8; 32]));
        let tampered = swapped
            .encrypt(
                &serde_json::to_vec(&plain).unwrap(),
                &biometric_aad("server/account"),
            )
            .to_string();
        assert_eq!(
            session
                .biometric_restore(&foreign_key, "server/account", &tampered)
                .err(),
            Some("decrypt_failed")
        );
        assert!(session.account.is_none());
    }

    #[test]
    fn old_biometric_snapshots_under_the_raw_account_key_are_refused() {
        let (mut session, _) = account();
        let account = SymmetricKey::from_bytes(*session.account.as_ref().unwrap().as_bytes());
        let identity = session
            .identity
            .as_ref()
            .unwrap()
            .seal_with(&account)
            .to_string();
        let old = account
            .encrypt(
                &serde_json::to_vec(&json!({"identity":identity,"metadata":{}})).unwrap(),
                b"melon/native/biometric/v1/server/biometric",
            )
            .to_string();
        assert!(
            !session
                .biometric_configured("server/biometric", Some(&old))
                .unwrap()
        );
        assert!(
            session
                .biometric_outdated("server/biometric", &old)
                .unwrap()
        );
        assert!(!session.biometric_outdated("other/biometric", &old).unwrap());
        let current = session
            .biometric_snapshot("server/biometric", json!({}))
            .unwrap();
        assert!(
            !session
                .biometric_outdated("server/biometric", &current)
                .unwrap()
        );
        let (mut other, _) = super::tests::account();
        assert!(!other.biometric_outdated("server/biometric", &old).unwrap());
        session.lock();
        assert_eq!(
            session.biometric_outdated("server/biometric", &old).err(),
            Some("locked")
        );
        assert!(
            session
                .biometric_restore(account.as_bytes(), "server/biometric", &old)
                .is_err()
        );
        assert!(session.account.is_none());
    }

    #[test]
    fn roundtrip_and_wrong_item_context() {
        let (mut session, _) = account();
        let encrypted = session
            .call(
                "encryptItem",
                json!({"vaultId":"vault", "itemId":"item", "plaintext":"secret"}),
            )
            .unwrap();
        let result = session.call("decryptItems", json!({"vaultId":"vault", "items":[{"id":"item", "keyVersion":1,"data":encrypted},{"id":"other","keyVersion":1,"data":encrypted}]})).unwrap();
        assert_eq!(result[0]["plaintext"], "secret");
        assert_eq!(result[1]["error"], "decrypt_failed");
    }

    #[test]
    fn cache_rejects_wrong_key_scope_and_tampering() {
        let (mut session, _) = account();
        let encrypted = session.cache_seal("user", b"cache secret").unwrap();
        assert!(!encrypted.contains("cache secret"));
        assert_eq!(
            &**session.cache_open("user", &encrypted).as_ref().unwrap(),
            b"cache secret"
        );
        assert!(session.cache_open("other", &encrypted).is_err());
        let (mut other, _) = account();
        assert!(other.cache_open("user", &encrypted).is_err());
        let mut tampered = encrypted.into_bytes();
        tampered[12] = if tampered[12] == b'A' { b'B' } else { b'A' };
        assert!(
            session
                .cache_open("user", std::str::from_utf8(&tampered).unwrap())
                .is_err()
        );
    }

    #[test]
    fn locked_state_cannot_access_cache_or_vaults() {
        let (mut session, _) = account();
        let encrypted = session.cache_seal("user", b"secret").unwrap();
        session.lock();
        assert_eq!(session.cache_seal("user", b"x").err(), Some("locked"));
        assert_eq!(session.cache_open("user", &encrypted).err(), Some("locked"));
        assert_eq!(
            session
                .call(
                    "encryptItem",
                    json!({"vaultId":"vault","itemId":"item","plaintext":"x"})
                )
                .err(),
            Some("locked")
        );
        assert_eq!(session.activity().err(), Some("locked"));
    }

    #[test]
    fn wrong_password_does_not_leave_keys_and_retry_needs_derivation() {
        let (mut session, created) = account();
        session.call("derive",json!({"password":"wrong", "salt":STANDARD.encode(b"0123456789abcdef"), "kdf":KdfParams::minimum()})).unwrap();
        let args = json!({"wrappedAccountKey":created["wrappedAccountKey"], "encryptedPrivateKey":created["encryptedPrivateKey"]});
        assert_eq!(
            session.call("unlock", args.clone()).err(),
            Some("decrypt_failed")
        );
        assert_eq!(session.call("unlock", args).err(), Some("keys_not_derived"));
        assert!(session.account.is_none());
        assert!(session.vaults.is_empty());
    }

    #[test]
    fn timeout_is_enforced_without_ui_timer() {
        let (mut session, _) = account();
        session.last_activity = Instant::now() - Duration::from_secs(301);
        assert_eq!(session.cache_seal("user", b"x").err(), Some("locked"));
        assert!(session.identity.is_none());
        assert!(session.wrapping.is_none());
    }

    #[test]
    fn raw_keys_and_unknown_commands_are_never_exposed() {
        let (mut session, _) = account();
        for method in ["exportVaultKeys", "importVaultKeys", "anything"] {
            assert_eq!(
                session.call(method, json!({})).err(),
                Some("unsupported_method")
            );
        }
    }

    #[test]
    fn export_needs_the_master_password_and_reopens_with_the_export_password() {
        let (mut session, created) = account();
        let reauth = |password: &str| {
            json!({"password":password, "salt":STANDARD.encode(b"0123456789abcdef"), "kdf":KdfParams::minimum(),
                   "wrappedAccountKey":created["wrappedAccountKey"], "exportPassword":"Export-Passwort 2026!", "plaintext":"{\"items\":[]}"})
        };
        assert_eq!(
            session.call("sealExport", reauth("wrong")).err(),
            Some("wrong_password")
        );
        let mut same = reauth("test-password");
        same["exportPassword"] = json!("test-password");
        assert_eq!(
            session.call("sealExport", same).err(),
            Some("export_password_is_master_password")
        );
        assert_eq!(
            session.call("checkPassword", reauth("wrong")).err(),
            Some("wrong_password")
        );
        assert_eq!(
            session
                .call("checkPassword", reauth("test-password"))
                .unwrap(),
            json!(true)
        );
        let file = session.call("sealExport", reauth("test-password")).unwrap();
        let opened = session
            .call(
                "openExport",
                json!({"password":"Export-Passwort 2026!", "data":file}),
            )
            .unwrap();
        assert_eq!(opened, json!("{\"items\":[]}"));
        assert_eq!(
            session
                .call(
                    "openExport",
                    json!({"password":"falsch falsch falsch", "data":file})
                )
                .err(),
            Some("wrong_export_password")
        );
    }

    #[test]
    fn failed_unlock_discards_pending_auth_proofs() {
        let (mut session, created) = account();
        let handle = session
            .call("derive",json!({"password":"wrong", "salt":STANDARD.encode(b"0123456789abcdef"), "kdf":KdfParams::minimum()}))
            .unwrap();
        assert!(!session.is_locked());
        let args = json!({"wrappedAccountKey":created["wrappedAccountKey"], "encryptedPrivateKey":created["encryptedPrivateKey"]});
        assert_eq!(session.call("unlock", args).err(), Some("decrypt_failed"));
        assert!(session.is_locked());
        assert_eq!(
            session
                .resolve_auth_proofs(&mut json!({ "auth_key": handle }))
                .err(),
            Some("invalid_auth_handle")
        );
    }

    #[test]
    fn server_change_drops_an_abandoned_login_but_not_an_open_vault() {
        let mut session = Session::default();
        let handle = session
            .call("derive",json!({"password":"pw", "salt":STANDARD.encode(b"0123456789abcdef"), "kdf":KdfParams::minimum()}))
            .unwrap();
        assert!(session.prepare_server_change().is_ok());
        assert!(session.is_locked());
        assert!(
            session
                .resolve_auth_proofs(&mut json!({ "auth_key": handle }))
                .is_err()
        );
        let (mut open, _) = account();
        assert_eq!(
            open.prepare_server_change().err(),
            Some("lock_before_changing_server")
        );
        assert!(open.account.is_some());
    }

    #[test]
    fn api_cache_and_biometric_snapshot_cannot_be_swapped() {
        let (mut session, _) = account();
        let scope = "https://melon.example/biometric";
        let snapshot = session.biometric_snapshot(scope, json!({})).unwrap();
        assert!(session.cache_open(scope, &snapshot).is_err());
        let cached = session
            .cache_seal(scope, br#"{"identity":"x","metadata":{}}"#)
            .unwrap();
        let key = session.biometric_key(scope).unwrap();
        assert_eq!(
            session.biometric_restore(&key, scope, &cached).err(),
            Some("decrypt_failed")
        );
    }

    #[test]
    fn failed_derivation_clears_previous_session() {
        let (mut session, _) = account();
        assert!(
            session
                .call("derive", json!({"password":"x","salt":"invalid","kdf":{}}))
                .is_err()
        );
        assert!(session.account.is_none());
        assert!(session.vaults.is_empty());
    }
}
