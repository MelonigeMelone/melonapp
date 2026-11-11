use base64::{Engine, engine::general_purpose::STANDARD};
use melon_crypto::{
    EncString, KdfParams, PasswordOptions, SymmetricKey, derive_master_key, item_aad,
    unwrap_vault_key, wrap_vault_key,
};
use wasm_bindgen::prelude::*;

fn js_err(e: impl std::fmt::Display) -> JsError {
    JsError::new(&e.to_string())
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

    #[wasm_bindgen(js_name = wrapVaultKey)]
    pub fn wrap_vault_key(&self, vault_key: &VaultKey) -> String {
        wrap_vault_key(&self.wrapping_key, &vault_key.0).to_string()
    }

    #[wasm_bindgen(js_name = unwrapVaultKey)]
    pub fn unwrap_vault_key(&self, wrapped: &str) -> Result<VaultKey, JsError> {
        let enc = EncString::parse(wrapped).map_err(js_err)?;
        unwrap_vault_key(&self.wrapping_key, &enc)
            .map(VaultKey)
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
pub struct VaultKey(SymmetricKey);

#[wasm_bindgen]
impl VaultKey {
    pub fn generate() -> VaultKey {
        VaultKey(SymmetricKey::generate())
    }

    pub fn encrypt(&self, module: &str, id: &str, plaintext: &str) -> String {
        self.0
            .encrypt(plaintext.as_bytes(), &item_aad(module, id))
            .to_string()
    }

    pub fn decrypt(&self, module: &str, id: &str, data: &str) -> Result<String, JsError> {
        let enc = EncString::parse(data).map_err(js_err)?;
        let plain = self
            .0
            .decrypt(&enc, &item_aad(module, id))
            .map_err(js_err)?;
        String::from_utf8(plain.to_vec()).map_err(js_err)
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
