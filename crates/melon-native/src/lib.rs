use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::STANDARD};
use melon_crypto::{
    EncString, KdfParams, KeyPair, PasswordOptions, PublicKey, RecoveryKey, SealedKey,
    SymmetricKey, VaultKeyContext, derive_master_key, item_aad, seal_vault_key, unwrap_account_key,
    vault_meta_aad, wrap_account_key,
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
    key: &SymmetricKey,
    public: &str,
    vault: &str,
    user: &str,
    version: u32,
) -> Result<String> {
    let public = PublicKey::from_base64(public).map_err(|_| "invalid_public_key")?;
    Ok(seal_vault_key(&public, key, &context(vault, user, version)).to_string())
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

    fn vault(&self, id: &str) -> Result<&Vault> {
        self.require_account()?;
        self.vaults.get(id).ok_or("vault_key_missing")
    }

    pub fn biometric_key(&mut self) -> Result<Zeroizing<Vec<u8>>> {
        self.expire();
        Ok(Zeroizing::new(self.require_account()?.as_bytes().to_vec()))
    }

    pub fn biometric_snapshot(&mut self, scope: &str, metadata: Value) -> Result<String> {
        self.expire();
        let account = self.require_account()?;
        let identity = self.identity.as_ref().ok_or("locked")?;
        let plaintext = Zeroizing::new(
            serde_json::to_vec(
                &json!({"identity":identity.seal_with(account).to_string(),"metadata":metadata}),
            )
            .map_err(|_| "invalid_request")?,
        );
        self.cache_seal(scope, &plaintext)
    }

    pub fn biometric_restore(&mut self, key: &[u8], scope: &str, snapshot: &str) -> Result<Value> {
        self.lock();
        let bytes: [u8; 32] = key.try_into().map_err(|_| "invalid_key")?;
        let account = SymmetricKey::from_bytes(bytes);
        let plaintext = account
            .decrypt(
                &parse(snapshot)?,
                format!("melon/native/cache/v1/{scope}").as_bytes(),
            )
            .map_err(|_| "decrypt_failed")?;
        let value: Value = serde_json::from_slice(&plaintext).map_err(|_| "invalid_cache")?;
        let identity = KeyPair::open_with(&account, &parse(text(&value, "identity")?)?)
            .map_err(|_| "decrypt_failed")?;
        self.account = Some(account);
        self.identity = Some(identity);
        self.last_activity = Instant::now();
        Ok(value["metadata"].clone())
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
                let result = json!({"wrappedAccountKey": wrap_account_key(&wrapping, &account).to_string(), "publicKey": identity.public_key().to_base64(), "encryptedPrivateKey": identity.seal_with(&account).to_string(), "personalVault": {"encryptedMeta": key.encrypt(text(a,"meta")?.as_bytes(), &vault_meta_aad(id,1)).to_string(), "encryptedVaultKey": sealed(&key,&identity.public_key().to_base64(), id,text(a,"userId")?,1)?}});
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
                let key = self
                    .identity
                    .as_ref()
                    .ok_or("locked")?
                    .open_vault_key(
                        &SealedKey::parse(text(a, "sealed")?).map_err(|_| "invalid_ciphertext")?,
                        &context(id, text(a, "userId")?, version),
                    )
                    .map_err(|_| "decrypt_failed")?;
                self.vaults.insert(id.to_owned(), Vault { key, version });
                Ok(Value::Null)
            }
            "newVault" => {
                self.require_account()?;
                let identity = self.identity.as_ref().ok_or("locked")?;
                let id = text(a, "vaultId")?;
                let key = SymmetricKey::generate();
                let result = json!({"encryptedMeta":key.encrypt(text(a,"meta")?.as_bytes(), &vault_meta_aad(id,1)).to_string(),"encryptedVaultKey":sealed(&key,&identity.public_key().to_base64(),id,text(a,"userId")?,1)?});
                self.vaults.insert(id.to_owned(), Vault { key, version: 1 });
                Ok(result)
            }
            "hasVault" => Ok(json!(
                self.vault(text(a, "vaultId")?)
                    .is_ok_and(|v| v.version == number(a, "keyVersion").unwrap_or(0))
            )),
            "encryptMeta" | "decryptMeta" | "encryptItem" | "decryptItems" | "sealFor"
            | "rotate" => self.vault_call(method, a),
            "fingerprint" => Ok(json!(melon_crypto::fingerprint(
                &PublicKey::from_base64(text(a, "publicKey")?).map_err(|_| "invalid_public_key")?
            ))),
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
                &v.key,
                text(a, "publicKey")?,
                id,
                text(a, "userId")?,
                v.version
            )?)),
            "rotate" => {
                let next = v.version.checked_add(1).ok_or("invalid_version")?;
                let key = SymmetricKey::generate();
                let members: Result<Vec<Value>> = array(a,"members")?.iter().map(|m| Ok(json!({"user_id":text(m,"userId")?,"encrypted_vault_key":sealed(&key,text(m,"publicKey")?,id,text(m,"userId")?,next)?}))).collect();
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
        let key = session.biometric_key().unwrap();
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
