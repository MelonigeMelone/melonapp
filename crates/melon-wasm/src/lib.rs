use base64::{Engine, engine::general_purpose::STANDARD};
use melon_crypto::{
    EncString, KdfParams, KeyPair, PasswordOptions, PrivateDataKey, PublicKey, RecoveryKey,
    SealOrigin, SealedKey, SymmetricKey, VaultKeyContext, derive_master_key, item_aad,
    unwrap_account_key, vault_key_id, vault_meta_aad, wrap_account_key,
};
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
}

fn context<'a>(vault_id: &'a str, user_id: &'a str, key_version: u32) -> VaultKeyContext<'a> {
    VaultKeyContext {
        vault_id,
        user_id,
        key_version,
    }
}

#[wasm_bindgen]
pub struct DerivedKeys {
    auth_key: String,
    wrapping_key: SymmetricKey,
}

#[wasm_bindgen]
impl DerivedKeys {
    #[wasm_bindgen(getter, js_name = authKey)]
    pub fn auth_key(&self) -> String {
        self.auth_key.clone()
    }

    #[wasm_bindgen(js_name = wrapAccountKey)]
    pub fn wrap_account_key(&self, account_key: &AccountKey) -> String {
        wrap_account_key(&self.wrapping_key, &account_key.0).to_string()
    }

    #[wasm_bindgen(js_name = unwrapAccountKey)]
    pub fn unwrap_account_key(&self, wrapped: &str) -> Result<AccountKey, JsError> {
        let enc = EncString::parse(wrapped).map_err(js_err)?;
        unwrap_account_key(&self.wrapping_key, &enc)
            .map(AccountKey)
            .map_err(js_err)
    }
}

#[wasm_bindgen(js_name = deriveKeys)]
pub fn derive_keys(
    password: &str,
    salt_b64: &str,
    memory_kib: u32,
    iterations: u32,
    parallelism: u32,
) -> Result<DerivedKeys, JsError> {
    let salt = STANDARD.decode(salt_b64).map_err(js_err)?;
    let params = KdfParams {
        memory_kib,
        iterations,
        parallelism,
    };
    let master = derive_master_key(password, &salt, &params).map_err(js_err)?;
    Ok(DerivedKeys {
        auth_key: master.auth_key().to_base64(),
        wrapping_key: master.wrapping_key(),
    })
}

#[wasm_bindgen]
pub struct AccountKey(SymmetricKey);

#[wasm_bindgen]
impl AccountKey {
    pub fn generate() -> AccountKey {
        AccountKey(SymmetricKey::generate())
    }
}

#[wasm_bindgen]
pub struct PrivateData(PrivateDataKey);

#[wasm_bindgen]
impl PrivateData {
    pub fn derive(account_key: &AccountKey) -> PrivateData {
        PrivateData(PrivateDataKey::derive(&account_key.0))
    }

    pub fn seal(&self, user_id: &str, purpose: &str, plaintext: &str) -> String {
        self.0
            .seal(user_id, purpose, plaintext.as_bytes())
            .to_string()
    }

    pub fn open(&self, user_id: &str, purpose: &str, data: &str) -> Result<String, JsError> {
        let enc = EncString::parse(data).map_err(js_err)?;
        let plain = self.0.open(user_id, purpose, &enc).map_err(js_err)?;
        String::from_utf8(plain.to_vec()).map_err(js_err)
    }
}

#[wasm_bindgen]
pub struct Identity(KeyPair);

#[wasm_bindgen]
impl Identity {
    pub fn generate() -> Identity {
        Identity(KeyPair::generate())
    }

    pub fn open(account_key: &AccountKey, sealed: &str) -> Result<Identity, JsError> {
        let enc = EncString::parse(sealed).map_err(js_err)?;
        KeyPair::open_with(&account_key.0, &enc)
            .map(Identity)
            .map_err(js_err)
    }

    #[wasm_bindgen(getter, js_name = publicKey)]
    pub fn public_key(&self) -> String {
        self.0.public_key().to_base64()
    }

    pub fn seal(&self, account_key: &AccountKey) -> String {
        self.0.seal_with(&account_key.0).to_string()
    }

    #[wasm_bindgen(js_name = openVaultKey)]
    pub fn open_vault_key(
        &self,
        sealed: &str,
        vault_id: &str,
        user_id: &str,
        key_version: u32,
        senders: Vec<String>,
    ) -> Result<OpenedVaultKey, JsError> {
        let sealed = SealedKey::parse(sealed).map_err(js_err)?;
        let senders = senders
            .iter()
            .map(|s| PublicKey::from_base64(s))
            .collect::<Result<Vec<_>, _>>()
            .map_err(js_err)?;
        let (key, origin) = self
            .0
            .open_vault_key(&sealed, &context(vault_id, user_id, key_version), &senders)
            .map_err(js_err)?;
        let sender = match origin {
            SealOrigin::Legacy => -1,
            SealOrigin::Sender(i) => i32::try_from(i).map_err(js_err)?,
        };
        Ok(OpenedVaultKey {
            key: VaultKey(key),
            sender,
        })
    }

    #[wasm_bindgen(js_name = sealVaultKey)]
    pub fn seal_vault_key(
        &self,
        public_key: &str,
        vault_key: &VaultKey,
        vault_id: &str,
        user_id: &str,
        key_version: u32,
    ) -> Result<String, JsError> {
        let recipient = PublicKey::from_base64(public_key).map_err(js_err)?;
        Ok(melon_crypto::seal_vault_key(
            &self.0,
            &recipient,
            &vault_key.0,
            &context(vault_id, user_id, key_version),
        )
        .to_string())
    }
}

#[wasm_bindgen]
pub struct OpenedVaultKey {
    key: VaultKey,
    sender: i32,
}

#[wasm_bindgen]
impl OpenedVaultKey {
    #[wasm_bindgen(getter)]
    pub fn sender(&self) -> i32 {
        self.sender
    }

    #[wasm_bindgen(js_name = intoKey)]
    pub fn into_key(self) -> VaultKey {
        self.key
    }
}

#[wasm_bindgen]
pub struct VaultKey(SymmetricKey);

fn decrypt_str(key: &SymmetricKey, data: &str, aad: &[u8]) -> Result<String, JsError> {
    let enc = EncString::parse(data).map_err(js_err)?;
    let plain = key.decrypt(&enc, aad).map_err(js_err)?;
    String::from_utf8(plain.to_vec()).map_err(js_err)
}

#[wasm_bindgen]
impl VaultKey {
    pub fn generate() -> VaultKey {
        VaultKey(SymmetricKey::generate())
    }

    pub fn id(&self, vault_id: &str, key_version: u32) -> String {
        vault_key_id(&self.0, vault_id, key_version)
    }

    #[wasm_bindgen(js_name = exportRaw)]
    pub fn export_raw(&self) -> Vec<u8> {
        self.0.as_bytes().to_vec()
    }

    #[wasm_bindgen(js_name = fromRaw)]
    pub fn from_raw(bytes: &[u8]) -> Result<VaultKey, JsError> {
        let arr: [u8; 32] = bytes
            .try_into()
            .map_err(|_| JsError::new("invalid key length"))?;
        Ok(VaultKey(SymmetricKey::from_bytes(arr)))
    }

    #[wasm_bindgen(js_name = encryptItem)]
    pub fn encrypt_item(
        &self,
        vault_id: &str,
        item_id: &str,
        key_version: u32,
        plaintext: &str,
    ) -> String {
        self.0
            .encrypt(
                plaintext.as_bytes(),
                &item_aad(vault_id, item_id, key_version),
            )
            .to_string()
    }

    #[wasm_bindgen(js_name = decryptItem)]
    pub fn decrypt_item(
        &self,
        vault_id: &str,
        item_id: &str,
        key_version: u32,
        data: &str,
    ) -> Result<String, JsError> {
        decrypt_str(&self.0, data, &item_aad(vault_id, item_id, key_version))
    }

    #[wasm_bindgen(js_name = encryptMeta)]
    pub fn encrypt_meta(&self, vault_id: &str, key_version: u32, plaintext: &str) -> String {
        self.0
            .encrypt(plaintext.as_bytes(), &vault_meta_aad(vault_id, key_version))
            .to_string()
    }

    #[wasm_bindgen(js_name = decryptMeta)]
    pub fn decrypt_meta(
        &self,
        vault_id: &str,
        key_version: u32,
        data: &str,
    ) -> Result<String, JsError> {
        decrypt_str(&self.0, data, &vault_meta_aad(vault_id, key_version))
    }
}

#[wasm_bindgen(js_name = generateSalt)]
pub fn generate_salt() -> String {
    STANDARD.encode(melon_crypto::generate_salt())
}

#[wasm_bindgen(js_name = generatePassword)]
pub fn generate_password(
    length: usize,
    lowercase: bool,
    uppercase: bool,
    digits: bool,
    symbols: bool,
    avoid_ambiguous: bool,
) -> Result<String, JsError> {
    let opts = PasswordOptions {
        length,
        lowercase,
        uppercase,
        digits,
        symbols,
        avoid_ambiguous,
    };
    melon_crypto::generate_password(&opts)
        .map(|p| p.to_string())
        .map_err(js_err)
}

#[wasm_bindgen]
pub struct Recovery(RecoveryKey);

#[wasm_bindgen]
impl Recovery {
    pub fn generate() -> Recovery {
        Recovery(RecoveryKey::generate())
    }

    pub fn parse(input: &str) -> Result<Recovery, JsError> {
        RecoveryKey::parse(input).map(Recovery).map_err(js_err)
    }

    #[wasm_bindgen(getter)]
    pub fn display(&self) -> String {
        self.0.display().to_string()
    }

    #[wasm_bindgen(getter, js_name = authKey)]
    pub fn auth_key(&self) -> String {
        self.0.auth_key().to_base64()
    }

    #[wasm_bindgen(js_name = wrapAccountKey)]
    pub fn wrap_account_key(&self, account_key: &AccountKey) -> String {
        self.0.wrap_account_key(&account_key.0).to_string()
    }

    #[wasm_bindgen(js_name = unwrapAccountKey)]
    pub fn unwrap_account_key(&self, wrapped: &str) -> Result<AccountKey, JsError> {
        let enc = EncString::parse(wrapped).map_err(js_err)?;
        self.0
            .unwrap_account_key(&enc)
            .map(AccountKey)
            .map_err(js_err)
    }
}

#[wasm_bindgen(js_name = sealExport)]
pub fn seal_export(password: &str, plaintext: &str) -> Result<String, JsError> {
    melon_crypto::seal_export(password, plaintext.as_bytes()).map_err(js_err)
}

#[wasm_bindgen(js_name = openExport)]
pub fn open_export(password: &str, file: &str) -> Result<String, JsError> {
    let plain = melon_crypto::open_export(password, file).map_err(js_err)?;
    String::from_utf8(plain.to_vec()).map_err(js_err)
}

#[wasm_bindgen]
pub fn fingerprint(public_key: &str) -> Result<String, JsError> {
    let key = PublicKey::from_base64(public_key).map_err(js_err)?;
    Ok(melon_crypto::fingerprint(&key))
}
