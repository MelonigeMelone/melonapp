use base64::{Engine, engine::general_purpose::STANDARD};
use melon_crypto::*;
use p256::ecdsa::{Signature, VerifyingKey, signature::Verifier};

const PASSWORD: &str = "Melonen-Kompatibilität 1";
const SALT: &[u8] = b"melon-compat-salt";
const AUTH: &str = "GtbFjmlAKAbvgBWVp7itnlNd/OCAa5EHpgs/dmzWXDE=";
const WRAP: &str = "Z3rR128jrbZMU2iRYZiYwDLJVoDJ9eZ0QABS3DW6jRE=";
const WRAPPED_ACCOUNT: &str = "1.tWpH77ishlUuX7hACHm4rUuFWflEnVovPZypgftmltQ9z8JmnNQ-ZX2xUo0IxJ55Ma4kDIMRgAkm0RCAvRtbLi45nSof4e2c";
const ITEM: &str = "1.mXVJ-9E-s9F5aC8v94LoZrte6FWX2DhqVtXzu6u5rl8_2DuQqgvAL-Vuq8jKaIVA1gDY6MdjJjOE";
const META: &str =
    "1.ZdTTdV3ia3URAWCq-0BFQtazrlBWhpff5V3HafwSXdYvo31MjFT6qPUBv0WEBPiXQxbw52D9k09CZA";
const RECOVERY: &str = "XHN3-KUNR-QP3B-4ZGO-PM2J-JKW7-Q5BR-TA7A-U2B3-62QH-VZLT-FLXE-HVBQ";
const RECOVERY_AUTH: &str = "OCfCYrwRByX9NFhz/cEz+RiKbuSbzCKah2kB+cONPjU=";
const RECOVERY_WRAPPED: &str = "1.LgTH2mA8FAkyMc-SUtfjewq1Oiuy_a884wHR-qdrJUJvMLB-UVifC4HuXmTD3x3owRUxkSVrkaBm42ickLBRt-AeFtHM8HV2";
const PRIVATE_SEALED: &str = "1.le7Bu4FdIov-f-gIjgG54vWZGAcWp4tgm_6neURlCJpzZVYx8EeijJ_zbzUzKCICCGXaPT_4G_g-_wbsNIoBwW2IBAUIDhmz";
const PRIVATE_DATA: &str =
    "1.0vOJva6fx5IQsGhDMTFu6AifPpIIGup1KOyZo6IMgkrhFcKRUH4E9ZtUjjoeXfLZ-6HOAmZYkCSBXS4KxwhbcA";
const PUBLIC: &str = "ZIMEglqPgGRIi0sAvM+5AeX+inAU6wv4p0hCOfAQjR4=";
const FINGERPRINT: &str = "99914 21060 17345 32630 54970 30777";
const SEALED_VAULT_KEY: &str = "h1.LK_MzopzpzCIQGJ9fXY4pWjtDypDKFeZcQR3dMYTfzqSwWYOQdCf0j_PUAeOdxMD45jJ2PPFijVSoIKD60ejhpRWtq8S4bT26vXWWTBgcNQ";
const PASSKEY_ID: &str = "ulCkIQaohC8MSqsT2kGBan01i13zKV4m1AgMLDHbMQs=";
const PASSKEY_KEY: &str = "1.SfFTMabVs9mEMfOzOhSI5uv87cVOZ8UwkOrmELhhTpfhodDqlUWPZlc0JomIUXyurAASa5rsz6q98JMbx8cvxvsM-4wj_7Wh";
const PASSKEY_ATTESTATION: &str = "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YViko3mm9u6vuaVeN4wRgDTidR5oL6ufLTCrE9ISVYbOGUdFAAAAAAAAAAAAAAAAAAAAAAAAAAAAILpQpCEGqIQvDEqrE9pBgWp9NYtd8yleJtQIDCwx2zELpQECAyYgASFYIKwcRy4KkMmIzakuMa6qw7rKC7am4FzYqL19D9vNYWG+Ilgg8GBJ0urGWh4DKM8zZQNhiBosoHwaArhTLXIgJxjwr9A=";
const PASSKEY_AUTHDATA: &str = "o3mm9u6vuaVeN4wRgDTidR5oL6ufLTCrE9ISVYbOGUcdAAAAAA==";
const PASSKEY_SIG: &str = "MEYCIQD84x45kYkOc8RwfQL+gkq9NkDeAtmb9RlR6wDY8hMATAIhALqT5IBp1KZ1NlBY3jI8AGp151wji2oLnGac7SNKJeAd";

fn account_key() -> SymmetricKey {
    SymmetricKey::from_bytes([9u8; 32])
}

fn enc(s: &str) -> EncString {
    EncString::parse(s).unwrap()
}

fn b64(s: &str) -> Vec<u8> {
    STANDARD.decode(s).unwrap()
}

#[test]
fn master_password_derives_the_same_keys() {
    let mk = derive_master_key(PASSWORD, SALT, &KdfParams::minimum()).unwrap();
    assert_eq!(mk.auth_key().to_base64(), AUTH);
    assert_eq!(STANDARD.encode(mk.wrapping_key().as_bytes()), WRAP);
}

#[test]
fn stored_account_key_still_unwraps() {
    let wrap = SymmetricKey::from_bytes(b64(WRAP).try_into().unwrap());
    let account = unwrap_account_key(&wrap, &enc(WRAPPED_ACCOUNT)).unwrap();
    assert_eq!(account.as_bytes(), account_key().as_bytes());
}

#[test]
fn stored_items_and_vault_names_still_decrypt() {
    let key = SymmetricKey::from_bytes([7u8; 32]);
    let item = key
        .decrypt(&enc(ITEM), &item_aad("vault-1", "item-1", 1))
        .unwrap();
    assert_eq!(item.as_slice(), b"geheimes Passwort");
    let meta = key
        .decrypt(&enc(META), &vault_meta_aad("vault-1", 1))
        .unwrap();
    assert_eq!(meta.as_slice(), br#"{"name":"Familie"}"#);
    assert!(
        key.decrypt(&enc(ITEM), &item_aad("vault-1", "item-2", 1))
            .is_err()
    );
}

#[test]
fn printed_recovery_kit_still_works() {
    let rk = RecoveryKey::parse(RECOVERY).unwrap();
    assert_eq!(rk.display().as_str(), RECOVERY);
    assert_eq!(rk.auth_key().to_base64(), RECOVERY_AUTH);
    let account = rk.unwrap_account_key(&enc(RECOVERY_WRAPPED)).unwrap();
    assert_eq!(account.as_bytes(), account_key().as_bytes());
}

#[test]
fn stored_key_pair_and_shared_vault_keys_still_open() {
    let kp = KeyPair::open_with(&account_key(), &enc(PRIVATE_SEALED)).unwrap();
    assert_eq!(kp.public_key().to_base64(), PUBLIC);
    assert_eq!(fingerprint(kp.public_key()), FINGERPRINT);
    let ctx = VaultKeyContext {
        vault_id: "vault-1",
        user_id: "user-1",
        key_version: 1,
    };
    let sealed = SealedKey::parse(SEALED_VAULT_KEY).unwrap();
    let vault_key = kp.open_vault_key(&sealed, &ctx).unwrap();
    assert_eq!(vault_key.as_bytes(), &[5u8; 32]);
    let other = VaultKeyContext {
        key_version: 2,
        ..ctx
    };
    assert!(kp.open_vault_key(&sealed, &other).is_err());
}

#[test]
fn stored_passkey_signs_identically_and_verifies_with_the_registered_key() {
    let cache = SymmetricKey::from_bytes([3u8; 32]);
    let id = b64(PASSKEY_ID);
    let a = assert_passkey(&cache, "example.com", &id, PASSKEY_KEY, &[1u8; 32]).unwrap();
    assert_eq!(STANDARD.encode(&a.authenticator_data), PASSKEY_AUTHDATA);
    assert_eq!(STANDARD.encode(&a.signature), PASSKEY_SIG);

    let attestation = b64(PASSKEY_ATTESTATION);
    let cose_start = attestation.len() - 77;
    let cose = &attestation[cose_start..];
    let x = &cose[10..42];
    let y = &cose[45..77];
    let mut sec1 = vec![4u8];
    sec1.extend_from_slice(x);
    sec1.extend_from_slice(y);
    let verifying = VerifyingKey::from_sec1_bytes(&sec1).unwrap();
    let mut message = a.authenticator_data.clone();
    message.extend_from_slice(&[1u8; 32]);
    let signature = Signature::from_der(&a.signature).unwrap();
    assert!(verifying.verify(&message, &signature).is_ok());
}

#[test]
fn private_data_from_older_versions_still_opens() {
    let key = PrivateDataKey::derive(&account_key());
    let plain = key
        .open("compat-user", "verified-codes", &enc(PRIVATE_DATA))
        .unwrap();
    assert_eq!(&*plain, br#"{"counter":1,"marks":{}}"#);
}
