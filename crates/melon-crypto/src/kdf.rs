use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine, engine::general_purpose::STANDARD};
use hkdf::Hkdf;
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use unicode_normalization::UnicodeNormalization;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::{CryptoError, SymmetricKey};

pub const SALT_LEN: usize = 16;

const MIN_MEMORY_KIB: u32 = 19 * 1024;
const MIN_ITERATIONS: u32 = 2;
const MAX_MEMORY_KIB: u32 = 1024 * 1024;
const MAX_ITERATIONS: u32 = 32;
const MAX_PARALLELISM: u32 = 16;

const INFO_AUTH: &[u8] = b"melon/v1/auth";
const INFO_WRAP: &[u8] = b"melon/v1/wrap";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KdfParams {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self {
            memory_kib: 64 * 1024,
            iterations: 3,
            parallelism: 4,
        }
    }
}

impl KdfParams {
    pub const fn minimum() -> Self {
        Self {
            memory_kib: MIN_MEMORY_KIB,
            iterations: MIN_ITERATIONS,
            parallelism: 1,
        }
    }

    pub fn validate(&self) -> Result<(), CryptoError> {
        let ok = (MIN_MEMORY_KIB..=MAX_MEMORY_KIB).contains(&self.memory_kib)
            && (MIN_ITERATIONS..=MAX_ITERATIONS).contains(&self.iterations)
            && (1..=MAX_PARALLELISM).contains(&self.parallelism);
        if ok {
            Ok(())
        } else {
            Err(CryptoError::InvalidKdfParams)
        }
    }
}

pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct MasterKey([u8; 32]);

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct AuthKey([u8; 32]);

impl AuthKey {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn to_base64(&self) -> String {
        STANDARD.encode(self.0)
    }
}

pub fn derive_master_key(
    password: &str,
    salt: &[u8],
    params: &KdfParams,
) -> Result<MasterKey, CryptoError> {
    params.validate()?;
    if !(16..=64).contains(&salt.len()) {
        return Err(CryptoError::InvalidSalt);
    }
    let normalized: Zeroizing<String> = Zeroizing::new(password.nfkc().collect());
    let argon_params = Params::new(
        params.memory_kib,
        params.iterations,
        params.parallelism,
        Some(32),
    )
    .map_err(|_| CryptoError::Kdf)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon_params);

    let mut key = MasterKey([0u8; 32]);
    argon
        .hash_password_into(normalized.as_bytes(), salt, &mut key.0)
        .map_err(|_| CryptoError::Kdf)?;
    Ok(key)
}

impl MasterKey {
    fn expand(&self, info: &[u8]) -> Zeroizing<[u8; 32]> {
        let hk = Hkdf::<Sha256>::from_prk(&self.0).expect("32-byte PRK is always valid");
        let mut out = Zeroizing::new([0u8; 32]);
        hk.expand(info, out.as_mut())
            .expect("32 bytes is a valid HKDF output length");
        out
    }

    pub fn auth_key(&self) -> AuthKey {
        AuthKey(*self.expand(INFO_AUTH))
    }

    pub fn wrapping_key(&self) -> SymmetricKey {
        SymmetricKey::from_bytes(*self.expand(INFO_WRAP))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SALT: &[u8] = b"0123456789abcdef";

    fn auth(password: &str, salt: &[u8]) -> [u8; 32] {
        *derive_master_key(password, salt, &KdfParams::minimum())
            .unwrap()
            .auth_key()
            .as_bytes()
    }

    #[test]
    fn derivation_is_deterministic() {
        assert_eq!(auth("hunter2", SALT), auth("hunter2", SALT));
    }

    #[test]
    fn different_password_or_salt_gives_different_keys() {
        let base = auth("hunter2", SALT);
        assert_ne!(base, auth("hunter3", SALT));
        assert_ne!(base, auth("hunter2", b"fedcba9876543210"));
    }

    #[test]
    fn auth_and_wrap_keys_are_independent() {
        let mk = derive_master_key("hunter2", SALT, &KdfParams::minimum()).unwrap();
        assert_ne!(mk.auth_key().as_bytes(), mk.wrapping_key().as_bytes());
    }

    #[test]
    fn unicode_is_normalized() {
        assert_eq!(auth("gr\u{00fc}n", SALT), auth("gru\u{0308}n", SALT));
    }

    #[test]
    fn weak_or_absurd_params_are_rejected() {
        let weak = KdfParams {
            memory_kib: 1024,
            iterations: 1,
            parallelism: 1,
        };
        let absurd = KdfParams {
            memory_kib: 64 * 1024,
            iterations: 1000,
            parallelism: 1,
        };
        assert_eq!(
            derive_master_key("x", SALT, &weak).err(),
            Some(CryptoError::InvalidKdfParams)
        );
        assert_eq!(
            derive_master_key("x", SALT, &absurd).err(),
            Some(CryptoError::InvalidKdfParams)
        );
        assert!(KdfParams::default().validate().is_ok());
    }

    #[test]
    fn short_salt_is_rejected() {
        assert_eq!(
            derive_master_key("x", b"short", &KdfParams::minimum()).err(),
            Some(CryptoError::InvalidSalt)
        );
    }
}
