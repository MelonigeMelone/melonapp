use melon_crypto::{EncString, SymmetricKey};
use zeroize::Zeroizing;

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CacheError {
    #[error("invalid key")]
    InvalidKey,
    #[error("invalid cache")]
    InvalidCache,
}

#[uniffi::export]
pub fn decrypt_cache(
    key: Vec<u8>,
    ciphertext: String,
    scope: String,
) -> Result<Vec<u8>, CacheError> {
    let key = Zeroizing::new(key);
    let bytes = key
        .as_slice()
        .try_into()
        .map_err(|_| CacheError::InvalidKey)?;
    let key = SymmetricKey::from_bytes(bytes);
    if ciphertext.len() > 48 * 1024 * 1024 {
        return Err(CacheError::InvalidCache);
    }
    let ciphertext = EncString::parse(&ciphertext).map_err(|_| CacheError::InvalidCache)?;
    key.decrypt(
        &ciphertext,
        format!("melon/native/cache/v1/{scope}").as_bytes(),
    )
    .map(|p| p.to_vec())
    .map_err(|_| CacheError::InvalidCache)
}

#[uniffi::export]
pub fn encrypt_cache(
    key: Vec<u8>,
    plaintext: Vec<u8>,
    scope: String,
) -> Result<String, CacheError> {
    let key = Zeroizing::new(key);
    let plaintext = Zeroizing::new(plaintext);
    let bytes = key
        .as_slice()
        .try_into()
        .map_err(|_| CacheError::InvalidKey)?;
    if plaintext.len() > 32 * 1024 * 1024 {
        return Err(CacheError::InvalidCache);
    }
    Ok(SymmetricKey::from_bytes(bytes)
        .encrypt(
            &plaintext,
            format!("melon/native/cache/v1/{scope}").as_bytes(),
        )
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swift_cache_roundtrip_and_attack_cases() {
        let key = vec![7; 32];
        let cipher = encrypt_cache(key.clone(), b"secret".to_vec(), "autofill/v1".into()).unwrap();
        assert_eq!(
            decrypt_cache(key.clone(), cipher.clone(), "autofill/v1".into()).unwrap(),
            b"secret"
        );
        assert!(decrypt_cache(vec![8; 32], cipher.clone(), "autofill/v1".into()).is_err());
        assert!(decrypt_cache(key, cipher, "other".into()).is_err());
        assert!(decrypt_cache(vec![7; 31], "bad".into(), "autofill/v1".into()).is_err());
    }
}

#[derive(uniffi::Record)]
pub struct Registration {
    pub credential_id: Vec<u8>,
    pub encrypted_key: String,
    pub attestation: Vec<u8>,
}

#[derive(uniffi::Record)]
pub struct Assertion {
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
}

#[uniffi::export]
pub fn register_passkey(key: Vec<u8>, rp: String) -> Result<Registration, CacheError> {
    let key = Zeroizing::new(key);
    let key = SymmetricKey::from_bytes(
        key.as_slice()
            .try_into()
            .map_err(|_| CacheError::InvalidKey)?,
    );
    let result = melon_crypto::create_passkey(&key, &rp).map_err(|_| CacheError::InvalidCache)?;
    Ok(Registration {
        credential_id: result.credential_id,
        encrypted_key: result.encrypted_key,
        attestation: result.attestation,
    })
}

#[uniffi::export]
pub fn sign_passkey(
    key: Vec<u8>,
    rp: String,
    credential_id: Vec<u8>,
    encrypted_key: String,
    client_hash: Vec<u8>,
) -> Result<Assertion, CacheError> {
    let key = Zeroizing::new(key);
    let key = SymmetricKey::from_bytes(
        key.as_slice()
            .try_into()
            .map_err(|_| CacheError::InvalidKey)?,
    );
    let result =
        melon_crypto::assert_passkey(&key, &rp, &credential_id, &encrypted_key, &client_hash)
            .map_err(|_| CacheError::InvalidCache)?;
    Ok(Assertion {
        authenticator_data: result.authenticator_data,
        signature: result.signature,
    })
}
