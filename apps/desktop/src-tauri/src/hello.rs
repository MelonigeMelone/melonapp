use base64::{Engine, engine::general_purpose::STANDARD};
use melon_crypto::{EncString, SymmetricKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

#[derive(Serialize, Deserialize)]
struct Sealed {
    challenge: String,
    key: String,
}

fn aad(scope: &str) -> Vec<u8> {
    format!("melon/windows-hello/v1/{scope}").into_bytes()
}

fn challenge(scope: &str, nonce: &[u8]) -> Vec<u8> {
    let mut hash = Sha256::new();
    hash.update(b"melon/windows-hello/challenge/v1\0");
    hash.update(scope.as_bytes());
    hash.update([0]);
    hash.update(nonce);
    hash.finalize().to_vec()
}

fn wrapping_key(scope: &str, signature: &[u8]) -> Result<SymmetricKey, String> {
    if signature.len() < 64 {
        return Err("biometric_unavailable".into());
    }
    let mut hash = Sha256::new();
    hash.update(b"melon/windows-hello/key/v1\0");
    hash.update(scope.as_bytes());
    hash.update([0]);
    hash.update(signature);
    SymmetricKey::from_slice(&hash.finalize()).map_err(|_| "biometric_unavailable".into())
}

pub fn seal(
    scope: &str,
    key: &[u8],
    sign: impl FnOnce(&[u8]) -> Result<Zeroizing<Vec<u8>>, String>,
) -> Result<String, String> {
    let nonce = melon_crypto::generate_salt();
    let signature = sign(&challenge(scope, &nonce))?;
    let sealed = Sealed {
        challenge: STANDARD.encode(nonce),
        key: wrapping_key(scope, &signature)?
            .encrypt(key, &aad(scope))
            .to_string(),
    };
    serde_json::to_string(&sealed).map_err(|_| "biometric_unavailable".into())
}

pub fn open(
    scope: &str,
    file: &str,
    sign: impl FnOnce(&[u8]) -> Result<Zeroizing<Vec<u8>>, String>,
) -> Result<Zeroizing<Vec<u8>>, String> {
    let sealed: Sealed = serde_json::from_str(file).map_err(|_| "biometric_unavailable")?;
    let nonce = STANDARD
        .decode(&sealed.challenge)
        .map_err(|_| "biometric_unavailable")?;
    let key = EncString::parse(&sealed.key).map_err(|_| "biometric_unavailable")?;
    let signature = sign(&challenge(scope, &nonce))?;
    wrapping_key(scope, &signature)?
        .decrypt(&key, &aad(scope))
        .map_err(|_| "biometric_unavailable".into())
}

#[cfg(windows)]
pub mod system {
    use windows::{
        Security::{
            Credentials::{
                KeyCredential, KeyCredentialCreationOption, KeyCredentialManager,
                KeyCredentialStatus,
            },
            Cryptography::CryptographicBuffer,
        },
        core::{Array, HSTRING},
    };
    use zeroize::Zeroizing;

    const NAME: &str = "de.melonigemelone.app.biometric.v1";

    fn unavailable<T>(_: T) -> String {
        "biometric_unavailable".into()
    }

    pub fn available() -> bool {
        KeyCredentialManager::IsSupportedAsync()
            .and_then(|operation| operation.join())
            .unwrap_or(false)
    }

    fn credential(create: bool) -> Result<KeyCredential, String> {
        let name = HSTRING::from(NAME);
        let opened = KeyCredentialManager::OpenAsync(&name)
            .and_then(|operation| operation.join())
            .map_err(unavailable)?;
        if opened.Status().map_err(unavailable)? == KeyCredentialStatus::Success {
            return opened.Credential().map_err(unavailable);
        }
        if !create {
            return Err("biometric_unavailable".into());
        }
        let created = KeyCredentialManager::RequestCreateAsync(
            &name,
            KeyCredentialCreationOption::ReplaceExisting,
        )
        .and_then(|operation| operation.join())
        .map_err(unavailable)?;
        if created.Status().map_err(unavailable)? != KeyCredentialStatus::Success {
            return Err("biometric_unavailable".into());
        }
        created.Credential().map_err(unavailable)
    }

    pub fn sign(data: &[u8], create: bool) -> Result<Zeroizing<Vec<u8>>, String> {
        let buffer = CryptographicBuffer::CreateFromByteArray(data).map_err(unavailable)?;
        let result = credential(create)?
            .RequestSignAsync(&buffer)
            .and_then(|operation| operation.join())
            .map_err(unavailable)?;
        if result.Status().map_err(unavailable)? != KeyCredentialStatus::Success {
            return Err("biometric_unavailable".into());
        }
        let mut signature = Array::<u8>::new();
        CryptographicBuffer::CopyToByteArray(
            &result.Result().map_err(unavailable)?,
            &mut signature,
        )
        .map_err(unavailable)?;
        Ok(Zeroizing::new(signature.to_vec()))
    }

    pub fn delete() {
        let _ = KeyCredentialManager::DeleteAsync(&HSTRING::from(NAME))
            .and_then(|operation| operation.join());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signer(secret: u8) -> impl Fn(&[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
        move |data: &[u8]| {
            let mut signature = vec![secret; 256];
            signature[..32].copy_from_slice(&Sha256::digest(data));
            Ok(Zeroizing::new(signature))
        }
    }

    #[test]
    fn the_same_hello_signature_opens_the_key() {
        let file = seal("https://melon.example/biometric", b"device key", signer(1)).unwrap();
        assert!(!file.contains("device key"));
        assert_eq!(
            &*open("https://melon.example/biometric", &file, signer(1)).unwrap(),
            b"device key"
        );
    }

    #[test]
    fn another_hello_key_scope_or_tampering_cannot_open_it() {
        let scope = "https://melon.example/biometric";
        let file = seal(scope, b"device key", signer(1)).unwrap();
        assert!(open(scope, &file, signer(2)).is_err());
        assert!(open("https://evil.example/biometric", &file, signer(1)).is_err());
        let mut sealed: Sealed = serde_json::from_str(&file).unwrap();
        sealed.challenge = STANDARD.encode([9; 16]);
        assert!(open(scope, &serde_json::to_string(&sealed).unwrap(), signer(1)).is_err());
        let mut tampered = file.into_bytes();
        let at = tampered.len() - 10;
        tampered[at] = if tampered[at] == b'A' { b'B' } else { b'A' };
        assert!(open(scope, std::str::from_utf8(&tampered).unwrap(), signer(1)).is_err());
    }

    #[test]
    fn a_refused_or_short_signature_opens_nothing() {
        let scope = "https://melon.example/biometric";
        let file = seal(scope, b"device key", signer(1)).unwrap();
        assert!(open(scope, &file, |_| Err("biometric_unavailable".into())).is_err());
        assert!(open(scope, &file, |_| Ok(Zeroizing::new(vec![1; 16]))).is_err());
        assert!(seal(scope, b"device key", |_| Ok(Zeroizing::new(vec![1; 16]))).is_err());
    }

    #[test]
    fn each_setup_signs_a_new_challenge() {
        let scope = "https://melon.example/biometric";
        let seen = std::cell::RefCell::new(Vec::new());
        let record = |data: &[u8]| {
            seen.borrow_mut().push(data.to_vec());
            signer(1)(data)
        };
        seal(scope, b"k", record).unwrap();
        seal(scope, b"k", record).unwrap();
        let seen = seen.borrow();
        assert_ne!(seen[0], seen[1]);
    }
}
