use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

use crate::{CryptoError, EncString, SymmetricKey};

const SALT: &[u8] = b"melon/v2/private-data";
const AAD_PREFIX: &[u8] = b"melon/v2/private\0";
const DEVICE_SALT: &[u8] = b"melon/v2/device-key";

pub struct PrivateDataKey(SymmetricKey);

fn aad(user_id: &str, purpose: &str) -> Vec<u8> {
    let mut aad = AAD_PREFIX.to_vec();
    aad.extend_from_slice(user_id.as_bytes());
    aad.push(0);
    aad.extend_from_slice(purpose.as_bytes());
    aad
}

impl PrivateDataKey {
    pub fn derive(account_key: &SymmetricKey) -> Self {
        let hk = Hkdf::<Sha256>::new(Some(SALT), account_key.as_bytes());
        let mut out = Zeroizing::new([0u8; 32]);
        hk.expand(b"key", out.as_mut())
            .expect("32 bytes is a valid HKDF output length");
        Self(SymmetricKey::from_bytes(*out))
    }

    pub fn seal(&self, user_id: &str, purpose: &str, plaintext: &[u8]) -> EncString {
        self.0.encrypt(plaintext, &aad(user_id, purpose))
    }

    pub fn open(
        &self,
        user_id: &str,
        purpose: &str,
        sealed: &EncString,
    ) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
        self.0.decrypt(sealed, &aad(user_id, purpose))
    }
}

pub fn derive_device_key(account_key: &SymmetricKey, purpose: &str, scope: &str) -> SymmetricKey {
    let hk = Hkdf::<Sha256>::new(Some(DEVICE_SALT), account_key.as_bytes());
    let mut info = purpose.as_bytes().to_vec();
    info.push(0);
    info.extend_from_slice(scope.as_bytes());
    let mut out = Zeroizing::new([0u8; 32]);
    hk.expand(&info, out.as_mut())
        .expect("32 bytes is a valid HKDF output length");
    SymmetricKey::from_bytes(*out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(byte: u8) -> PrivateDataKey {
        PrivateDataKey::derive(&SymmetricKey::from_bytes([byte; 32]))
    }

    #[test]
    fn only_the_same_account_user_and_purpose_open_it() {
        let sealed = key(1).seal("me", "verified", b"{}");
        assert_eq!(&*key(1).open("me", "verified", &sealed).unwrap(), b"{}");
        assert!(key(2).open("me", "verified", &sealed).is_err());
        assert!(key(1).open("other", "verified", &sealed).is_err());
        assert!(key(1).open("me", "other", &sealed).is_err());
        assert!(key(1).open("mev", "erified", &sealed).is_err());
    }

    #[test]
    fn differs_from_the_account_key_itself() {
        let account = SymmetricKey::from_bytes([7; 32]);
        let sealed = PrivateDataKey::derive(&account).seal("me", "verified", b"x");
        assert!(account.decrypt(&sealed, &aad("me", "verified")).is_err());
    }

    #[test]
    fn device_keys_are_separate_from_the_account_and_each_other() {
        let account = SymmetricKey::from_bytes([7; 32]);
        let autofill = derive_device_key(&account, "autofill", "scope");
        assert_ne!(autofill.as_bytes(), account.as_bytes());
        assert_eq!(
            autofill.as_bytes(),
            derive_device_key(&account, "autofill", "scope").as_bytes()
        );
        for (purpose, scope) in [("biometric", "scope"), ("autofill", "other")] {
            assert_ne!(
                autofill.as_bytes(),
                derive_device_key(&account, purpose, scope).as_bytes()
            );
        }
        let other = SymmetricKey::from_bytes([8; 32]);
        assert_ne!(
            autofill.as_bytes(),
            derive_device_key(&other, "autofill", "scope").as_bytes()
        );
        let sealed = account.encrypt(b"x", b"aad");
        assert!(autofill.decrypt(&sealed, b"aad").is_err());
    }
}
