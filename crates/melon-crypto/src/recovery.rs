use data_encoding::BASE32_NOPAD;
use hkdf::Hkdf;
use rand::{RngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::{AuthKey, CryptoError, EncString, PublicKey, SymmetricKey};

const SECRET_LEN: usize = 30;
const CHECK_LEN: usize = 2;
const GROUP: usize = 4;
const SALT: &[u8] = b"melon/v2/recovery";
const INFO_AUTH: &[u8] = b"melon/v2/recovery-auth";
const INFO_WRAP: &[u8] = b"melon/v2/recovery-wrap";
const AAD_ACCOUNT_KEY: &[u8] = b"melon/v2/account-key-recovery";

pub struct RecoveryKey {
    secret: Zeroizing<[u8; SECRET_LEN]>,
}

fn checksum(secret: &[u8]) -> [u8; CHECK_LEN] {
    let digest = Sha256::digest(secret);
    [digest[0], digest[1]]
}

impl RecoveryKey {
    pub fn generate() -> Self {
        let mut secret = Zeroizing::new([0u8; SECRET_LEN]);
        OsRng.fill_bytes(secret.as_mut());
        Self { secret }
    }

    pub fn parse(input: &str) -> Result<Self, CryptoError> {
        let normalized: Zeroizing<String> = Zeroizing::new(
            input
                .chars()
                .filter(|c| !c.is_whitespace() && *c != '-')
                .map(|c| match c.to_ascii_uppercase() {
                    '0' => 'O',
                    '1' => 'I',
                    '8' => 'B',
                    other => other,
                })
                .collect(),
        );
        let raw = Zeroizing::new(
            BASE32_NOPAD
                .decode(normalized.as_bytes())
                .map_err(|_| CryptoError::InvalidRecoveryKey)?,
        );
        if raw.len() != SECRET_LEN + CHECK_LEN {
            return Err(CryptoError::InvalidRecoveryKey);
        }
        let (secret, check) = raw.split_at(SECRET_LEN);
        if checksum(secret) != check {
            return Err(CryptoError::InvalidRecoveryKey);
        }
        let mut out = Zeroizing::new([0u8; SECRET_LEN]);
        out.copy_from_slice(secret);
        Ok(Self { secret: out })
    }

    pub fn display(&self) -> Zeroizing<String> {
        let mut raw = Zeroizing::new(Vec::with_capacity(SECRET_LEN + CHECK_LEN));
        raw.extend_from_slice(self.secret.as_ref());
        raw.extend_from_slice(&checksum(self.secret.as_ref()));
        let encoded = Zeroizing::new(BASE32_NOPAD.encode(&raw));
        let groups: Vec<&str> = encoded
            .as_bytes()
            .chunks(GROUP)
            .map(|c| std::str::from_utf8(c).expect("base32 is ASCII"))
            .collect();
        Zeroizing::new(groups.join("-"))
    }

    fn expand(&self, info: &[u8]) -> Zeroizing<[u8; 32]> {
        let hk = Hkdf::<Sha256>::new(Some(SALT), self.secret.as_ref());
        let mut out = Zeroizing::new([0u8; 32]);
        hk.expand(info, out.as_mut())
            .expect("32 bytes is a valid HKDF output length");
        out
    }

    pub fn auth_key(&self) -> AuthKey {
        AuthKey::from_bytes(*self.expand(INFO_AUTH))
    }

    fn wrapping_key(&self) -> SymmetricKey {
        SymmetricKey::from_bytes(*self.expand(INFO_WRAP))
    }

    pub fn wrap_account_key(&self, account_key: &SymmetricKey) -> EncString {
        self.wrapping_key()
            .encrypt(account_key.as_bytes(), AAD_ACCOUNT_KEY)
    }

    pub fn unwrap_account_key(&self, wrapped: &EncString) -> Result<SymmetricKey, CryptoError> {
        let bytes = self.wrapping_key().decrypt(wrapped, AAD_ACCOUNT_KEY)?;
        let arr: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| CryptoError::InvalidKey)?;
        Ok(SymmetricKey::from_bytes(arr))
    }
}

pub fn fingerprint(public_key: &PublicKey) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"melon/v2/fingerprint\0");
    hasher.update(public_key.bytes());
    let digest = hasher.finalize();
    digest[..30]
        .chunks(5)
        .map(|chunk| {
            let n = chunk.iter().fold(0u64, |acc, b| (acc << 8) | u64::from(*b));
            format!("{:05}", n % 100_000)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::KeyPair;

    #[test]
    fn display_roundtrips_and_is_grouped() {
        let key = RecoveryKey::generate();
        let shown = key.display();
        assert_eq!(shown.len(), 13 * 4 + 12);
        assert!(shown.split('-').all(|g| g.len() == 4));
        let parsed = RecoveryKey::parse(&shown).unwrap();
        assert_eq!(parsed.auth_key().as_bytes(), key.auth_key().as_bytes());
    }

    #[test]
    fn parsing_forgives_case_spaces_and_lookalikes() {
        let key = RecoveryKey::generate();
        let shown = key
            .display()
            .replace('O', "0")
            .replace('I', "1")
            .replace('B', "8");
        let messy = format!("  {} ", shown.to_lowercase().replace('-', " "));
        assert!(RecoveryKey::parse(&messy).is_ok());
    }

    #[test]
    fn typos_are_detected_by_the_checksum() {
        let shown = RecoveryKey::generate().display();
        let mut chars: Vec<char> = shown.chars().collect();
        chars[0] = if chars[0] == 'A' { 'C' } else { 'A' };
        let typo: String = chars.into_iter().collect();
        assert_eq!(
            RecoveryKey::parse(&typo).err(),
            Some(CryptoError::InvalidRecoveryKey)
        );
        assert_eq!(
            RecoveryKey::parse("AAAA-BBBB").err(),
            Some(CryptoError::InvalidRecoveryKey)
        );
        assert_eq!(
            RecoveryKey::parse("").err(),
            Some(CryptoError::InvalidRecoveryKey)
        );
    }

    #[test]
    fn account_key_roundtrips_only_with_the_right_recovery_key() {
        let key = RecoveryKey::generate();
        let account = SymmetricKey::generate();
        let wrapped = key.wrap_account_key(&account);
        let again = RecoveryKey::parse(&key.display()).unwrap();
        assert_eq!(
            again.unwrap_account_key(&wrapped).unwrap().as_bytes(),
            account.as_bytes()
        );
        assert!(
            RecoveryKey::generate()
                .unwrap_account_key(&wrapped)
                .is_err()
        );
    }

    #[test]
    fn recovery_and_password_wrapping_are_not_interchangeable() {
        let key = RecoveryKey::generate();
        let account = SymmetricKey::generate();
        let by_recovery = key.wrap_account_key(&account);
        assert!(crate::unwrap_account_key(&key.wrapping_key(), &by_recovery).is_err());
        assert_ne!(key.auth_key().as_bytes(), key.wrapping_key().as_bytes());
    }

    #[test]
    fn fingerprints_are_stable_and_distinct() {
        let a = KeyPair::generate();
        let b = KeyPair::generate();
        let fa = fingerprint(a.public_key());
        assert_eq!(fa, fingerprint(a.public_key()));
        assert_ne!(fa, fingerprint(b.public_key()));
        assert_eq!(fa.len(), 6 * 5 + 5);
        assert!(
            fa.split(' ')
                .all(|g| g.len() == 5 && g.chars().all(|c| c.is_ascii_digit()))
        );
    }
}
