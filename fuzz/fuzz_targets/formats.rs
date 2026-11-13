#![no_main]

use libfuzzer_sys::fuzz_target;
use melon_crypto::{
    EncString, KeyPair, PublicKey, RecoveryKey, SealedKey, SymmetricKey, VaultKeyContext,
    unwrap_account_key,
};

fuzz_target!(|data: &[u8]| {
    let text = String::from_utf8_lossy(data);
    let key = SymmetricKey::from_bytes([7u8; 32]);
    if let Ok(enc) = EncString::parse(&text) {
        assert_eq!(EncString::parse(&enc.to_string()).ok().as_ref(), Some(&enc));
        assert!(key.decrypt(&enc, b"melon/fuzz").is_err());
        let _ = unwrap_account_key(&key, &enc);
        let _ = KeyPair::open_with(&key, &enc);
    }
    if let Ok(sealed) = SealedKey::parse(&text) {
        assert_eq!(
            sealed.to_string(),
            SealedKey::parse(&sealed.to_string()).unwrap().to_string()
        );
        let pair = KeyPair::generate();
        let context = VaultKeyContext {
            vault_id: "vault",
            user_id: "user",
            key_version: 1,
        };
        let _ = pair.open_vault_key(&sealed, &context, &[pair.public_key().clone()]);
    }
    if let Ok(recovery) = RecoveryKey::parse(&text) {
        assert!(RecoveryKey::parse(&recovery.display()).is_ok());
    }
    if let Ok(public) = PublicKey::from_base64(&text) {
        assert_eq!(
            PublicKey::from_base64(&public.to_base64()).ok(),
            Some(public)
        );
    }
});
