#![no_main]

use libfuzzer_sys::fuzz_target;
use melon_crypto::{SymmetricKey, assert_passkey};

fuzz_target!(|data: &[u8]| {
    let mut parts = data.split(|b| *b == 0);
    let rp = String::from_utf8_lossy(parts.next().unwrap_or_default());
    let id = parts.next().unwrap_or_default();
    let encrypted = String::from_utf8_lossy(parts.next().unwrap_or_default());
    let client_hash = parts.next().unwrap_or_default();
    let cache = SymmetricKey::from_bytes([3u8; 32]);
    assert!(assert_passkey(&cache, &rp, id, &encrypted, client_hash).is_err());
});
