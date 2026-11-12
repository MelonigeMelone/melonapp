use std::fmt;

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chacha20poly1305::{
    Key, KeyInit, XChaCha20Poly1305, XNonce,
    aead::{Aead, Payload},
};
use rand::Rng;

use crate::rng::os_rng;
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::CryptoError;

const VERSION: &str = "1";
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;

#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct SymmetricKey([u8; 32]);

impl SymmetricKey {
    pub fn generate() -> Self {
        let mut key = Self([0u8; 32]);
        os_rng().fill_bytes(&mut key.0);
        key
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn encrypt(&self, plaintext: &[u8], aad: &[u8]) -> EncString {
        let mut nonce = [0u8; NONCE_LEN];
        os_rng().fill_bytes(&mut nonce);
        let ciphertext = XChaCha20Poly1305::new(&Key::from(self.0))
            .encrypt(
                &XNonce::from(nonce),
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .expect("XChaCha20-Poly1305 encryption cannot fail for in-memory buffers");
        let mut raw = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        raw.extend_from_slice(&nonce);
        raw.extend_from_slice(&ciphertext);
        EncString { raw }
    }

    pub fn decrypt(&self, enc: &EncString, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
        let (nonce, ciphertext) = enc.raw.split_at(NONCE_LEN);
        let nonce = XNonce::try_from(nonce).map_err(|_| CryptoError::Malformed)?;
        XChaCha20Poly1305::new(&Key::from(self.0))
            .decrypt(
                &nonce,
                Payload {
                    msg: ciphertext,
                    aad,
                },
            )
            .map(Zeroizing::new)
            .map_err(|_| CryptoError::Decrypt)
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct EncString {
    raw: Vec<u8>,
}

impl EncString {
    pub fn parse(s: &str) -> Result<Self, CryptoError> {
        let (version, body) = s.split_once('.').ok_or(CryptoError::Malformed)?;
        if version != VERSION {
            return Err(CryptoError::UnsupportedVersion);
        }
        let raw = URL_SAFE_NO_PAD
            .decode(body)
            .map_err(|_| CryptoError::Malformed)?;
        if raw.len() < NONCE_LEN + TAG_LEN {
            return Err(CryptoError::Malformed);
        }
        Ok(Self { raw })
    }

    pub fn encoded_len(&self) -> usize {
        VERSION.len() + 1 + (self.raw.len() * 4).div_ceil(3)
    }
}

impl fmt::Display for EncString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{VERSION}.{}", URL_SAFE_NO_PAD.encode(&self.raw))
    }
}

impl fmt::Debug for EncString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "EncString({} bytes)", self.raw.len())
    }
}

impl TryFrom<String> for EncString {
    type Error = CryptoError;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        Self::parse(&s)
    }
}

impl From<EncString> for String {
    fn from(e: EncString) -> Self {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let key = SymmetricKey::generate();
        let enc = key.encrypt(b"geheim", b"ctx");
        assert_eq!(key.decrypt(&enc, b"ctx").unwrap().as_slice(), b"geheim");
    }

    #[test]
    fn same_plaintext_encrypts_differently() {
        let key = SymmetricKey::generate();
        assert_ne!(
            key.encrypt(b"x", b"").to_string(),
            key.encrypt(b"x", b"").to_string()
        );
    }

    #[test]
    fn wrong_key_fails() {
        let enc = SymmetricKey::generate().encrypt(b"geheim", b"ctx");
        assert_eq!(
            SymmetricKey::generate().decrypt(&enc, b"ctx").err(),
            Some(CryptoError::Decrypt)
        );
    }

    #[test]
    fn wrong_context_fails() {
        let key = SymmetricKey::generate();
        let enc = key.encrypt(b"geheim", b"context-a");
        assert_eq!(
            key.decrypt(&enc, b"context-b").err(),
            Some(CryptoError::Decrypt)
        );
    }

    #[test]
    fn tampering_is_detected() {
        let key = SymmetricKey::generate();
        let mut enc = key.encrypt(b"geheim", b"");
        let last = enc.raw.len() - 1;
        enc.raw[last] ^= 1;
        assert_eq!(key.decrypt(&enc, b"").err(), Some(CryptoError::Decrypt));
    }

    #[test]
    fn string_form_roundtrips() {
        let key = SymmetricKey::generate();
        let enc = key.encrypt(b"geheim", b"");
        let s = enc.to_string();
        assert!(s.starts_with("1."));
        assert_eq!(s.len(), enc.encoded_len());
        let parsed = EncString::parse(&s).unwrap();
        assert_eq!(key.decrypt(&parsed, b"").unwrap().as_slice(), b"geheim");
        assert_eq!(String::from(enc), s);
    }

    #[test]
    fn malformed_input_is_rejected() {
        assert_eq!(EncString::parse("nope").err(), Some(CryptoError::Malformed));
        assert_eq!(
            EncString::parse("2.AAAA").err(),
            Some(CryptoError::UnsupportedVersion)
        );
        assert_eq!(
            EncString::parse("1.!!!").err(),
            Some(CryptoError::Malformed)
        );
        assert_eq!(
            EncString::parse("1.AAAA").err(),
            Some(CryptoError::Malformed)
        );
    }
}
