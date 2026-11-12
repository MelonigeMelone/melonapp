use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{CryptoError, EncString, KdfParams, derive_master_key, generate_salt};

const FORMAT: &str = "melonapp-export";
const VERSION: u32 = 1;
const AAD: &[u8] = b"melon/export/v1";
const MAX_FILE: usize = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct ExportFile {
    format: String,
    version: u32,
    kdf: KdfParams,
    salt: String,
    data: EncString,
}

pub fn seal_export(password: &str, plaintext: &[u8]) -> Result<String, CryptoError> {
    if password.chars().count() < 12 {
        return Err(CryptoError::WeakExportPassword);
    }
    let kdf = KdfParams::default();
    let salt = generate_salt();
    let key = derive_master_key(password, &salt, &kdf)?.wrapping_key();
    let file = ExportFile {
        format: FORMAT.into(),
        version: VERSION,
        kdf,
        salt: STANDARD.encode(salt),
        data: key.encrypt(plaintext, AAD),
    };
    serde_json::to_string_pretty(&file).map_err(|_| CryptoError::Malformed)
}

pub fn is_export(file: &str) -> bool {
    file.len() <= MAX_FILE
        && serde_json::from_str::<ExportFile>(file).is_ok_and(|f| f.format == FORMAT)
}

pub fn open_export(password: &str, file: &str) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    if file.len() > MAX_FILE {
        return Err(CryptoError::Malformed);
    }
    let file: ExportFile = serde_json::from_str(file).map_err(|_| CryptoError::Malformed)?;
    if file.format != FORMAT {
        return Err(CryptoError::Malformed);
    }
    if file.version != VERSION {
        return Err(CryptoError::UnsupportedVersion);
    }
    if file.kdf != KdfParams::default() {
        return Err(CryptoError::InvalidKdfParams);
    }
    let salt = STANDARD
        .decode(&file.salt)
        .map_err(|_| CryptoError::InvalidSalt)?;
    let key = derive_master_key(password, &salt, &file.kdf)?.wrapping_key();
    key.decrypt(&file.data, AAD)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "Export-Passwort 2026!";

    #[test]
    fn roundtrip_and_only_the_right_password_opens_it() {
        let file = seal_export(PASSWORD, br#"{"items":[]}"#).unwrap();
        assert!(is_export(&file));
        assert_eq!(
            open_export(PASSWORD, &file).unwrap().as_slice(),
            br#"{"items":[]}"#
        );
        assert_eq!(
            open_export("Export-Passwort 2027!", &file).err(),
            Some(CryptoError::Decrypt)
        );
    }

    #[test]
    fn short_export_passwords_are_refused() {
        assert_eq!(
            seal_export("zu-kurz", b"x").err(),
            Some(CryptoError::WeakExportPassword)
        );
    }

    #[test]
    fn tampered_or_weakened_files_are_rejected() {
        let file = seal_export(PASSWORD, b"geheim").unwrap();
        let mut parsed: serde_json::Value = serde_json::from_str(&file).unwrap();
        parsed["kdf"]["memory_kib"] = 8.into();
        assert_eq!(
            open_export(PASSWORD, &parsed.to_string()).err(),
            Some(CryptoError::InvalidKdfParams)
        );

        let mut parsed: serde_json::Value = serde_json::from_str(&file).unwrap();
        parsed["kdf"]["memory_kib"] = (1024 * 1024).into();
        assert_eq!(
            open_export(PASSWORD, &parsed.to_string()).err(),
            Some(CryptoError::InvalidKdfParams),
            "a file must not force an expensive Argon2 run"
        );

        let mut parsed: serde_json::Value = serde_json::from_str(&file).unwrap();
        parsed["salt"] = STANDARD.encode([7u8; 16]).into();
        assert_eq!(
            open_export(PASSWORD, &parsed.to_string()).err(),
            Some(CryptoError::Decrypt)
        );

        let mut parsed: serde_json::Value = serde_json::from_str(&file).unwrap();
        parsed["version"] = 2.into();
        assert_eq!(
            open_export(PASSWORD, &parsed.to_string()).err(),
            Some(CryptoError::UnsupportedVersion)
        );

        assert!(!is_export(r#"{"format":"other"}"#));
        assert!(open_export(PASSWORD, "not json").is_err());
    }
}
