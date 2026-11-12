use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use melon_native::Session;
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, path::Path};

const OUTBOX_LIMIT: u64 = 64 * 1024;
const LEGACY_LIMIT: u64 = 8 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    id: String,
    rp: String,
    user_name: String,
    user_handle: String,
    encrypted_key: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub file: String,
    pub rp: String,
    pub user_name: String,
    pub credential_id: String,
    pub user_handle: String,
    pub private_key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Synced {
    pub rp: String,
    pub user_name: String,
    pub credential_id: String,
    pub user_handle: String,
    pub private_key: String,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
fn outbox_name(scope: &str, id: &[u8]) -> String {
    format!("{scope}.outbox.{}.enc", hex(id))
}

pub fn synced_name(scope: &str) -> String {
    format!("{scope}.synced.enc")
}

pub fn synced_scope(scope: &str) -> String {
    format!("autofill/v1/{scope}/synced")
}

enum Source {
    Outbox(String),
    Legacy,
}

fn source(scope: &str, name: &str) -> Option<Source> {
    if name == format!("{scope}.passkeys.enc") {
        return Some(Source::Legacy);
    }
    let id = name
        .strip_prefix(&format!("{scope}.outbox."))?
        .strip_suffix(".enc")?;
    (id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
    .then(|| Source::Outbox(id.to_owned()))
}

fn open_stored(session: &mut Session, file: &str, stored: &Stored) -> Option<Pending> {
    let id = STANDARD.decode(&stored.id).ok()?;
    let handle = STANDARD.decode(&stored.user_handle).ok()?;
    if handle.is_empty() || handle.len() > 64 {
        return None;
    }
    let private = session
        .passkey_open(&stored.rp, &id, &stored.encrypted_key)
        .ok()?;
    Some(Pending {
        file: file.to_owned(),
        rp: stored.rp.clone(),
        user_name: stored.user_name.clone(),
        credential_id: URL_SAFE_NO_PAD.encode(&id),
        user_handle: URL_SAFE_NO_PAD.encode(&handle),
        private_key: URL_SAFE_NO_PAD.encode(&*private),
    })
}

fn read_file(
    session: &mut Session,
    directory: &Path,
    scope: &str,
    name: &str,
    source: &Source,
) -> Option<Vec<Pending>> {
    let path = directory.join(name);
    let limit = match source {
        Source::Outbox(_) => OUTBOX_LIMIT,
        Source::Legacy => LEGACY_LIMIT,
    };
    if fs::symlink_metadata(&path).ok()?.len() > limit || !path.is_file() {
        return None;
    }
    let ciphertext = fs::read_to_string(&path).ok()?;
    match source {
        Source::Outbox(id) => {
            let plaintext = session
                .cache_open(&format!("autofill/v1/{scope}/outbox/{id}"), &ciphertext)
                .ok()?;
            let stored: Stored = serde_json::from_slice(&plaintext).ok()?;
            if hex(&STANDARD.decode(&stored.id).ok()?) != *id {
                return None;
            }
            open_stored(session, name, &stored).map(|p| vec![p])
        }
        Source::Legacy => {
            let plaintext = session
                .cache_open(&format!("autofill/v1/{scope}/passkeys"), &ciphertext)
                .ok()?;
            let stored: Vec<Stored> = serde_json::from_slice(&plaintext).ok()?;
            Some(
                stored
                    .iter()
                    .filter_map(|s| open_stored(session, name, s))
                    .collect(),
            )
        }
    }
}

pub fn pending(
    session: &mut Session,
    directory: &Path,
    scope: &str,
) -> Result<Vec<Pending>, String> {
    if session.is_locked() {
        return Err("locked".into());
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return Ok(Vec::new());
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .collect();
    names.sort();
    let mut result = Vec::new();
    for name in names {
        if let Some(source) = source(scope, &name)
            && let Some(found) = read_file(session, directory, scope, &name, &source)
        {
            result.extend(found);
        }
    }
    Ok(result)
}

pub fn acknowledge(directory: &Path, scope: &str, files: &[String]) -> Result<(), String> {
    for name in files {
        if source(scope, name).is_none() {
            return Err("invalid_request".into());
        }
        let path = directory.join(name);
        if fs::symlink_metadata(&path).is_ok() {
            fs::remove_file(path).map_err(|_| "storage_unavailable")?;
        }
    }
    Ok(())
}

pub fn seal_synced(
    session: &mut Session,
    scope: &str,
    passkeys: &[Synced],
) -> Result<String, String> {
    if session.is_locked() {
        return Err("locked".into());
    }
    let mut seen = HashSet::new();
    let mut stored = Vec::new();
    for passkey in passkeys {
        let (Ok(id), Ok(handle), Ok(private)) = (
            URL_SAFE_NO_PAD.decode(&passkey.credential_id),
            URL_SAFE_NO_PAD.decode(&passkey.user_handle),
            URL_SAFE_NO_PAD
                .decode(&passkey.private_key)
                .map(zeroize::Zeroizing::new),
        ) else {
            continue;
        };
        if handle.is_empty() || handle.len() > 64 || !seen.insert(id.clone()) {
            continue;
        }
        let Ok(encrypted_key) = session.passkey_seal(&passkey.rp, &id, &private) else {
            continue;
        };
        stored.push(Stored {
            id: STANDARD.encode(&id),
            rp: passkey.rp.clone(),
            user_name: passkey.user_name.clone(),
            user_handle: STANDARD.encode(&handle),
            encrypted_key,
        });
    }
    let plaintext =
        zeroize::Zeroizing::new(serde_json::to_vec(&stored).map_err(|_| "invalid_request")?);
    session
        .cache_seal(&synced_scope(scope), &plaintext)
        .map_err(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use melon_crypto::{KdfParams, SymmetricKey, assert_passkey, create_passkey};
    use serde_json::json;

    const SCOPE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const OTHER: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn account() -> Session {
        let mut session = Session::default();
        session
            .call(
                "derive",
                json!({"password":"test-password","salt":STANDARD.encode(b"0123456789abcdef"),"kdf":KdfParams::minimum()}),
            )
            .unwrap();
        session
            .call(
                "createAccount",
                json!({"userId":"user","personalVaultId":"vault","meta":"name"}),
            )
            .unwrap();
        session
    }

    fn device_key(session: &mut Session) -> SymmetricKey {
        SymmetricKey::from_bytes(
            session
                .biometric_key()
                .unwrap()
                .as_slice()
                .try_into()
                .unwrap(),
        )
    }

    fn extension_registers(session: &mut Session, dir: &Path, scope: &str, rp: &str) -> Vec<u8> {
        let created = create_passkey(&device_key(session), rp).unwrap();
        let stored = Stored {
            id: STANDARD.encode(&created.credential_id),
            rp: rp.to_owned(),
            user_name: "alice".into(),
            user_handle: STANDARD.encode(b"user-1"),
            encrypted_key: created.encrypted_key,
        };
        let id_hex = hex(&created.credential_id);
        let sealed = session
            .cache_seal(
                &format!("autofill/v1/{scope}/outbox/{id_hex}"),
                &serde_json::to_vec(&stored).unwrap(),
            )
            .unwrap();
        fs::write(dir.join(outbox_name(scope, &created.credential_id)), sealed).unwrap();
        created.credential_id
    }

    #[test]
    fn outbox_passkey_moves_to_synced_copy_and_signs_identically() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = account();
        let id = extension_registers(&mut session, dir.path(), SCOPE, "example.com");
        let found = pending(&mut session, dir.path(), SCOPE).unwrap();
        assert_eq!(found.len(), 1);
        let p = &found[0];
        assert_eq!(p.file, outbox_name(SCOPE, &id));
        assert_eq!(
            (p.rp.as_str(), p.user_name.as_str()),
            ("example.com", "alice")
        );
        assert_eq!(URL_SAFE_NO_PAD.decode(&p.credential_id).unwrap(), id);
        assert_eq!(URL_SAFE_NO_PAD.decode(&p.user_handle).unwrap(), b"user-1");

        let sealed = seal_synced(
            &mut session,
            SCOPE,
            &[Synced {
                rp: p.rp.clone(),
                user_name: p.user_name.clone(),
                credential_id: p.credential_id.clone(),
                user_handle: p.user_handle.clone(),
                private_key: p.private_key.clone(),
            }],
        )
        .unwrap();
        let plaintext = session.cache_open(&synced_scope(SCOPE), &sealed).unwrap();
        let stored: Vec<Stored> = serde_json::from_slice(&plaintext).unwrap();
        assert_eq!(stored.len(), 1);
        let key = device_key(&mut session);
        assert!(
            assert_passkey(&key, "example.com", &id, &stored[0].encrypted_key, &[3; 32]).is_ok()
        );

        acknowledge(dir.path(), SCOPE, std::slice::from_ref(&p.file)).unwrap();
        assert!(pending(&mut session, dir.path(), SCOPE).unwrap().is_empty());
    }

    #[test]
    fn foreign_renamed_or_tampered_outbox_files_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = account();
        let id = extension_registers(&mut session, dir.path(), OTHER, "example.com");
        fs::rename(
            dir.path().join(outbox_name(OTHER, &id)),
            dir.path().join(outbox_name(SCOPE, &id)),
        )
        .unwrap();
        let mut other_account = account();
        let foreign = extension_registers(&mut other_account, dir.path(), SCOPE, "example.com");
        let mine = extension_registers(&mut session, dir.path(), SCOPE, "example.com");
        fs::rename(
            dir.path().join(outbox_name(SCOPE, &mine)),
            dir.path().join(outbox_name(SCOPE, &[7; 32])),
        )
        .unwrap();
        let tampered = extension_registers(&mut session, dir.path(), SCOPE, "example.com");
        let path = dir.path().join(outbox_name(SCOPE, &tampered));
        let mut text = fs::read_to_string(&path).unwrap();
        text.replace_range(text.len() - 2.., "AA");
        fs::write(&path, text).unwrap();
        let _ = foreign;
        assert!(pending(&mut session, dir.path(), SCOPE).unwrap().is_empty());
    }

    #[test]
    fn legacy_device_file_is_imported() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = account();
        let created = create_passkey(&device_key(&mut session), "example.com").unwrap();
        let stored = vec![Stored {
            id: STANDARD.encode(&created.credential_id),
            rp: "example.com".into(),
            user_name: "bob".into(),
            user_handle: STANDARD.encode(b"h"),
            encrypted_key: created.encrypted_key,
        }];
        let sealed = session
            .cache_seal(
                &format!("autofill/v1/{SCOPE}/passkeys"),
                &serde_json::to_vec(&stored).unwrap(),
            )
            .unwrap();
        fs::write(dir.path().join(format!("{SCOPE}.passkeys.enc")), sealed).unwrap();
        let found = pending(&mut session, dir.path(), SCOPE).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].file, format!("{SCOPE}.passkeys.enc"));
        assert_eq!(found[0].user_name, "bob");
    }

    #[test]
    fn acknowledge_only_deletes_this_scopes_outbox_files() {
        let dir = tempfile::tempdir().unwrap();
        for name in [
            format!("{SCOPE}.passwords.enc"),
            "active.txt".into(),
            synced_name(SCOPE),
        ] {
            fs::write(dir.path().join(&name), "x").unwrap();
            assert!(acknowledge(dir.path(), SCOPE, std::slice::from_ref(&name)).is_err());
            assert!(dir.path().join(&name).exists());
        }
        for name in [
            format!("../{SCOPE}.outbox.{}.enc", "a".repeat(64)),
            format!("{OTHER}.outbox.{}.enc", "a".repeat(64)),
            format!("{SCOPE}.outbox.{}.enc", "A".repeat(64)),
        ] {
            assert!(acknowledge(dir.path(), SCOPE, &[name]).is_err());
        }
        let ok = format!("{SCOPE}.outbox.{}.enc", "a".repeat(64));
        fs::write(dir.path().join(&ok), "x").unwrap();
        acknowledge(dir.path(), SCOPE, &[ok.clone(), ok.clone()]).unwrap();
        assert!(!dir.path().join(&ok).exists());
    }

    #[test]
    fn locked_session_reads_and_publishes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let mut session = account();
        extension_registers(&mut session, dir.path(), SCOPE, "example.com");
        session.lock();
        assert_eq!(
            pending(&mut session, dir.path(), SCOPE).err(),
            Some("locked".into())
        );
        assert_eq!(
            seal_synced(&mut session, SCOPE, &[]).err(),
            Some("locked".into())
        );
    }

    #[test]
    fn invalid_or_duplicate_vault_passkeys_are_skipped() {
        let mut session = account();
        let valid = Synced {
            rp: "example.com".into(),
            user_name: "a".into(),
            credential_id: URL_SAFE_NO_PAD.encode([1; 32]),
            user_handle: URL_SAFE_NO_PAD.encode(b"h"),
            private_key: URL_SAFE_NO_PAD.encode([1; 32]),
        };
        let bad = |rp: &str, id: &[u8], key: &[u8]| Synced {
            rp: rp.into(),
            user_name: "x".into(),
            credential_id: URL_SAFE_NO_PAD.encode(id),
            user_handle: URL_SAFE_NO_PAD.encode(b"h"),
            private_key: URL_SAFE_NO_PAD.encode(key),
        };
        let duplicate = bad("example.com", &[1; 32], &[2; 32]);
        let sealed = seal_synced(
            &mut session,
            SCOPE,
            &[
                valid,
                duplicate,
                bad("Bad RP", &[2; 32], &[1; 32]),
                bad("example.com", &[3; 31], &[1; 32]),
                bad("example.com", &[4; 32], &[0; 32]),
            ],
        )
        .unwrap();
        let stored: Vec<Stored> =
            serde_json::from_slice(&session.cache_open(&synced_scope(SCOPE), &sealed).unwrap())
                .unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(STANDARD.decode(&stored[0].id).unwrap(), vec![1; 32]);
    }
}
