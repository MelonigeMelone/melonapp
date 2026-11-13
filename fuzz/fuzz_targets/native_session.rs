#![no_main]

use std::sync::{Mutex, OnceLock};

use base64::{Engine, engine::general_purpose::STANDARD};
use libfuzzer_sys::fuzz_target;
use melon_native::Session;
use serde_json::{Value, json};

const METHODS: &[&str] = &[
    "activity",
    "generateSalt",
    "generatePassword",
    "openVault",
    "newVault",
    "hasVault",
    "ownPublicKey",
    "fingerprint",
    "encryptMeta",
    "decryptMeta",
    "encryptItem",
    "decryptItems",
    "sealFor",
    "rotate",
    "unknown",
];

fn unlocked() -> Session {
    let mut session = Session::default();
    let kdf = json!({"memory_kib": 19456, "iterations": 2, "parallelism": 1});
    session
        .call(
            "derive",
            json!({"password": "fuzz", "salt": STANDARD.encode(b"0123456789abcdef"), "kdf": kdf}),
        )
        .expect("derive");
    session
        .call(
            "createAccount",
            json!({"personalVaultId": "vault", "meta": "{}", "userId": "user"}),
        )
        .expect("create account");
    session
}

fn session() -> &'static Mutex<Session> {
    static SESSION: OnceLock<Mutex<Session>> = OnceLock::new();
    SESSION.get_or_init(|| Mutex::new(unlocked()))
}

fuzz_target!(|data: &[u8]| {
    let Some((&selector, rest)) = data.split_first() else {
        return;
    };
    let Ok(args) = serde_json::from_slice::<Value>(rest) else {
        return;
    };
    let mut session = session().lock().unwrap_or_else(|e| e.into_inner());
    if session.is_locked() {
        *session = unlocked();
    }
    match selector % 4 {
        0 => {
            let mut body = args;
            let _ = session.resolve_auth_proofs(&mut body);
        }
        1 => {
            let _ = session.cache_open("fuzz", &String::from_utf8_lossy(rest));
        }
        2 => {
            let mut fresh = Session::default();
            let restored =
                fresh.biometric_restore(&[9u8; 32], "fuzz", &String::from_utf8_lossy(rest));
            assert!(restored.is_err());
        }
        _ => {
            let method = METHODS[usize::from(selector / 4) % METHODS.len()];
            if let Ok(Value::Object(out)) = session.call(method, args) {
                for name in ["authKey", "currentAuthKey", "recoveryAuthKey"] {
                    if let Some(value) = out.get(name) {
                        assert!(
                            value
                                .as_str()
                                .is_some_and(|v| v.starts_with("native-proof:"))
                        );
                    }
                }
            }
        }
    }
});
