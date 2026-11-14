use melon_native::Session;
use security_framework::{
    access_control::{ProtectionMode, SecAccessControl},
    passwords::{self, AccessControlOptions, PasswordOptions},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, MutexGuard},
    thread,
    time::Duration,
};
use tauri::Manager;
use zeroize::Zeroizing;

const SERVICE: &str = "de.melonigemelone.app.biometric.v1";
const SERVER_SERVICE: &str = "de.melonigemelone.app.server.v1";
const NOT_FOUND: i32 = -25300;

static SERVER: Mutex<Option<String>> = Mutex::new(None);
const ACTIVE_ATTEMPTS: u32 = 20;
const ACTIVE_DELAY: Duration = Duration::from_millis(100);

fn wait_until_active(
    state: &Mutex<Session>,
    attempts: u32,
    delay: Duration,
) -> Result<MutexGuard<'_, Session>, String> {
    for attempt in 0..=attempts {
        let session = state.lock().map_err(|_| "session_unavailable")?;
        if session.is_active() {
            return Ok(session);
        }
        drop(session);
        if attempt < attempts {
            thread::sleep(delay);
        }
    }
    Err("background_locked".into())
}

fn sha256_hex(input: &[u8]) -> String {
    Sha256::digest(input)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn location(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "storage_unavailable")?;
    fs::create_dir_all(&dir).map_err(|_| "storage_unavailable")?;
    Ok(dir.join(name))
}

fn atomic_write(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let parent = path.parent().ok_or("storage_unavailable")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "storage_unavailable")?;
    temporary
        .write_all(data)
        .and_then(|()| temporary.as_file().sync_all())
        .map_err(|_| "storage_unavailable")?;
    temporary.persist(path).map_err(|_| "storage_unavailable")?;
    Ok(())
}

fn write(app: &tauri::AppHandle, name: &str, data: &[u8]) -> Result<(), String> {
    atomic_write(&location(app, name)?, data)
}

fn read(app: &tauri::AppHandle, name: &str) -> Result<String, String> {
    let path = location(app, name)?;
    if fs::metadata(&path).map_err(|_| "cache_unavailable")?.len() > 48 * 1024 * 1024 {
        return Err("cache_too_large".into());
    }
    fs::read_to_string(path).map_err(|_| "cache_unavailable".into())
}

fn server_item() -> PasswordOptions {
    PasswordOptions::new_generic_password(SERVER_SERVICE, "server")
}

fn server(_app: &tauri::AppHandle) -> Result<String, String> {
    let mut cached = SERVER.lock().map_err(|_| "server_unavailable")?;
    if let Some(value) = cached.as_ref() {
        return Ok(value.clone());
    }
    let stored = passwords::generic_password(server_item()).map_err(|_| "server_not_set")?;
    let value = validated_server(std::str::from_utf8(&stored).map_err(|_| "invalid_server")?)?;
    *cached = Some(value.clone());
    Ok(value)
}

fn store_server(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
    let mut cached = SERVER.lock().map_err(|_| "server_unavailable")?;
    if passwords::delete_generic_password_options(server_item())
        .is_err_and(|e| e.code() != NOT_FOUND)
    {
        return Err("server_unavailable".into());
    }
    *cached = None;
    passwords::set_generic_password_options(value.as_bytes(), server_item())
        .map_err(|_| "server_unavailable")?;
    *cached = Some(value.to_owned());
    let legacy = location(app, "server.txt")?;
    if legacy.exists() {
        fs::remove_file(legacy).map_err(|_| "storage_unavailable")?;
    }
    Ok(())
}

fn request_url(base: &str, path: &str) -> Result<reqwest::Url, String> {
    let route = path.split('?').next().unwrap_or_default();
    let dot_segment = route.split('/').any(|segment| {
        let decoded = segment.to_ascii_lowercase().replace("%2e", ".");
        decoded == "." || decoded == ".."
    });
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.contains('#')
        || path.contains('\\')
        || dot_segment
    {
        return Err("invalid_request".into());
    }
    let origin = reqwest::Url::parse(base).map_err(|_| "invalid_server")?;
    let url =
        reqwest::Url::parse(&format!("{base}/api/v1{path}")).map_err(|_| "invalid_request")?;
    if url.origin() != origin.origin() || !url.path().starts_with("/api/v1/") {
        return Err("invalid_request".into());
    }
    Ok(url)
}

fn validated_server(input: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(input).map_err(|_| "invalid_server")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if !(url.scheme() == "https" || url.scheme() == "http" && local)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("invalid_server".into());
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

#[tauri::command]
pub fn get_server(app: tauri::AppHandle) -> Result<String, String> {
    Ok(server(&app)
        .or_else(|_| read(&app, "server.txt").and_then(|legacy| validated_server(legacy.trim())))
        .unwrap_or_default())
}

#[tauri::command]
pub fn set_server(app: tauri::AppHandle, value: String) -> Result<(), String> {
    let value = validated_server(&value)?;
    let state = app.state::<Mutex<Session>>();
    let mut session = state.lock().map_err(|_| "session_unavailable")?;
    if server(&app).ok().as_ref() == Some(&value) {
        return Ok(());
    }
    session.prepare_server_change().map_err(str::to_owned)?;
    store_server(&app, &value)
}

#[derive(Deserialize)]
pub struct RequestOptions {
    token: Option<String>,
    body: Option<Value>,
}

#[derive(Serialize)]
pub struct Response {
    status: u16,
    body: String,
}

#[tauri::command]
pub async fn api_request(
    app: tauri::AppHandle,
    method: String,
    path: String,
    opts: RequestOptions,
) -> Result<Response, String> {
    if !matches!(method.as_str(), "GET" | "POST" | "PUT" | "DELETE") {
        return Err("invalid_request".into());
    }
    let base = validated_server(&server(&app)?)?;
    let url = request_url(&base, &path)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "network_error")?;
    let mut request = client.request(method.parse().map_err(|_| "invalid_request")?, url);
    if let Some(token) = opts.token {
        request = request.bearer_auth(token);
    }
    if let Some(mut body) = opts.body {
        app.state::<Mutex<Session>>()
            .lock()
            .map_err(|_| "session_unavailable")?
            .resolve_auth_proofs(&mut body)
            .map_err(str::to_owned)?;
        request = request.json(&body);
    }
    let mut response = request.send().await.map_err(|_| "network_error")?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "network_error")? {
        if bytes.len() + chunk.len() > 32 * 1024 * 1024 {
            return Err("response_too_large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(bytes).map_err(|_| "invalid_response")?;
    if method == "GET" && status == 200 {
        let scope = format!("{base}{path}");
        let name = format!("cache-{}.enc", sha256_hex(scope.as_bytes()));
        let mut session = app
            .state::<Mutex<Session>>()
            .inner()
            .lock()
            .map_err(|_| "session_unavailable")?;
        if let Ok(ciphertext) = session.cache_seal(&scope, body.as_bytes()) {
            write(&app, &name, ciphertext.as_bytes())?;
        }
    }
    Ok(Response { status, body })
}

fn options(scope: &str) -> PasswordOptions {
    let mut options = PasswordOptions::new_generic_password(SERVICE, scope);
    options.use_protected_keychain();
    options.set_access_synchronized(Some(false));
    options
}

#[tauri::command]
pub async fn biometric_enable(app: tauri::AppHandle, metadata: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = server(&app)?;
        let scope = format!("{base}/biometric");
        let token = metadata
            .get("token")
            .and_then(Value::as_str)
            .ok_or("invalid_request")?
            .to_owned();
        let (key, snapshot) = {
            let state = app.state::<Mutex<Session>>();
            let mut session = state.lock().map_err(|_| "session_unavailable")?;
            (
                session.biometric_key(&scope).map_err(str::to_owned)?,
                session
                    .biometric_snapshot(&scope, metadata)
                    .map_err(str::to_owned)?,
            )
        };
        let access = SecAccessControl::create_with_protection(
            Some(ProtectionMode::AccessibleWhenPasscodeSetThisDeviceOnly),
            AccessControlOptions::BIOMETRY_CURRENT_SET.bits(),
        )
        .map_err(|_| "biometric_unavailable")?;
        let mut config = options(&scope);
        config.set_access_control(access);
        let deletion = passwords::delete_generic_password_options(options(&scope));
        if deletion.is_err_and(|e| e.code() != NOT_FOUND) {
            return Err("biometric_unavailable".into());
        }
        passwords::set_generic_password_options(&key, config)
            .map_err(|_| "biometric_unavailable")?;
        write(
            &app,
            "biometric.token",
            token_marker(&base, &token).as_bytes(),
        )?;
        write(&app, "biometric.enc", snapshot.as_bytes())
    })
    .await
    .map_err(|_| "biometric_unavailable")?
}

#[tauri::command]
pub async fn biometric_status(app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = server(&app)?;
        let scope = format!("{base}/biometric");
        let mut snapshot = None;
        for name in ["biometric.enc", "biometric.token"] {
            match fs::metadata(location(&app, name)?) {
                Ok(_) => {
                    let value = read(&app, name)?;
                    if name == "biometric.enc" {
                        snapshot = Some(value);
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    snapshot = None;
                    break;
                }
                Err(_) => return Err("storage_unavailable".into()),
            }
        }
        let state = app.state::<Mutex<Session>>();
        let mut session = state.lock().map_err(|_| "session_unavailable")?;
        if server(&app)? != base {
            return Err("server_changed".into());
        }
        if let Some(old) = snapshot.as_deref()
            && session
                .biometric_outdated(&scope, old)
                .map_err(str::to_owned)?
        {
            remove_biometric(&app, &scope)?;
            return Ok(false);
        }
        session
            .biometric_configured(&scope, snapshot.as_deref())
            .map_err(str::to_owned)
    })
    .await
    .map_err(|_| "status_unavailable")?
}

#[tauri::command]
pub async fn biometric_unlock(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scope = format!("{}/biometric", server(&app)?);
        let snapshot = read(&app, "biometric.enc")?;
        let key = Zeroizing::new(
            passwords::generic_password(options(&scope)).map_err(|_| "biometric_unavailable")?,
        );
        let state = app.state::<Mutex<Session>>();
        let mut session = wait_until_active(&state, ACTIVE_ATTEMPTS, ACTIVE_DELAY)?;
        if format!("{}/biometric", server(&app)?) != scope {
            return Err("server_changed".into());
        }
        session
            .biometric_restore(&key, &scope, &snapshot)
            .map_err(str::to_owned)
    })
    .await
    .map_err(|_| "biometric_unavailable")?
}

fn token_marker(base: &str, token: &str) -> String {
    sha256_hex(format!("melon/biometric-token\0{base}\0{token}").as_bytes())
}

#[tauri::command]
pub fn biometric_keeps_token(app: tauri::AppHandle, token: String) -> bool {
    let (Ok(base), Ok(marker)) = (server(&app), read(&app, "biometric.token")) else {
        return false;
    };
    location(&app, "biometric.enc").is_ok_and(|path| path.exists())
        && marker.trim() == token_marker(&base, &token)
}

#[tauri::command]
pub fn biometric_disable(app: tauri::AppHandle) -> Result<(), String> {
    let scope = format!("{}/biometric", server(&app)?);
    remove_biometric(&app, &scope)?;
    autofill_remove()
}

fn remove_biometric(app: &tauri::AppHandle, scope: &str) -> Result<(), String> {
    if passwords::delete_generic_password_options(options(scope))
        .is_err_and(|e| e.code() != NOT_FOUND)
    {
        return Err("biometric_unavailable".into());
    }
    for name in ["biometric.enc", "biometric.token"] {
        let path = location(app, name)?;
        if path.exists() {
            fs::remove_file(path).map_err(|_| "storage_unavailable")?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "ios"))]
fn autofill_remove() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "ios")]
fn autofill_remove() -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString};
    let group = "group.de.melonigemelone.app";
    let Some(url) = NSFileManager::defaultManager()
        .containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str(group))
    else {
        return Ok(());
    };
    let directory = PathBuf::from(url.path().ok_or("app_group_unavailable")?.to_string());
    let active = directory.join("active.txt");
    let Ok(scope) = fs::read_to_string(&active) else {
        return Ok(());
    };
    let mut config = PasswordOptions::new_generic_password("de.melonapp.autofill.v1", scope.trim());
    config.use_protected_keychain();
    config.set_access_group(group);
    if passwords::delete_generic_password_options(config).is_err_and(|e| e.code() != NOT_FOUND) {
        return Err("autofill_unavailable".into());
    }
    for name in [
        format!("{}.passwords.enc", scope.trim()),
        crate::passkeys::synced_name(scope.trim()),
        "active.txt".to_owned(),
    ] {
        let path = directory.join(name);
        if path.exists() {
            fs::remove_file(path).map_err(|_| "storage_unavailable")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use melon_native::Session;
    use std::{
        sync::{Arc, Mutex},
        thread,
        time::Duration,
    };

    #[test]
    fn unlock_waits_for_foreground_after_biometric_prompt() {
        let state = Arc::new(Mutex::new(Session::default()));
        state.lock().unwrap().set_active(false);
        let other = Arc::clone(&state);
        let resume = thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            other.lock().unwrap().set_active(true);
        });
        let session = super::wait_until_active(&state, 50, Duration::from_millis(10)).unwrap();
        assert!(session.is_active());
        drop(session);
        resume.join().unwrap();
    }

    #[test]
    fn unlock_stays_rejected_while_app_remains_in_background() {
        let state = Mutex::new(Session::default());
        state.lock().unwrap().set_active(false);
        assert_eq!(
            super::wait_until_active(&state, 3, Duration::from_millis(1)).err(),
            Some("background_locked".to_owned())
        );
        let session = state.lock().unwrap();
        assert!(!session.is_active());
        assert!(session.is_locked());
    }

    #[test]
    fn biometric_token_marker_is_bound_to_server_and_token() {
        let marker = super::token_marker("https://a.example", "t1");
        assert_eq!(marker, super::token_marker("https://a.example", "t1"));
        assert_ne!(marker, super::token_marker("https://b.example", "t1"));
        assert_ne!(marker, super::token_marker("https://a.example", "t2"));
    }

    #[test]
    fn cache_and_autofill_names_keep_their_hex_form() {
        assert_eq!(
            super::sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    use super::*;

    #[test]
    fn cache_files_are_private_and_atomically_replaced() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cache.enc");
        atomic_write(&path, b"first ciphertext").unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        atomic_write(&path, b"replacement ciphertext").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"replacement ciphertext");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn server_requires_tls_except_loopback_and_rejects_credentials() {
        for input in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/path",
            "file:///etc/passwd",
            "https://example.com?token=x",
        ] {
            assert!(validated_server(input).is_err());
        }
        assert_eq!(
            validated_server("https://example.com/").unwrap(),
            "https://example.com"
        );
        assert!(validated_server("http://127.0.0.1:8080").is_ok());
    }

    #[test]
    fn api_paths_cannot_leave_the_api_prefix() {
        let base = "https://melon.example";
        for path in [
            "/../health",
            "/%2e%2e/%2e%2e/health",
            "/%2E%2E/health",
            "/.%2e/health",
            "/%2e./health",
            "/vaults/%2e/../../health",
            "/vaults/./x",
            "/..\\..\\health",
            "//evil.example/x",
            "/x#y",
            "health",
            "@evil.example/x",
        ] {
            assert!(request_url(base, path).is_err(), "{path}");
        }
        assert_eq!(
            request_url(base, "/vaults/abc/items?since=1")
                .unwrap()
                .as_str(),
            "https://melon.example/api/v1/vaults/abc/items?since=1"
        );
        assert_eq!(
            request_url(base, "/users/lookup?email=a%40b.de")
                .unwrap()
                .path(),
            "/api/v1/users/lookup"
        );
        assert!(request_url("http://127.0.0.1:8080", "/auth/prelogin").is_ok());
    }
}

#[cfg(target_os = "ios")]
const APP_GROUP: &str = "group.de.melonigemelone.app";

#[cfg(target_os = "ios")]
fn app_group() -> Result<PathBuf, String> {
    use objc2_foundation::{NSFileManager, NSString};
    let url = NSFileManager::defaultManager()
        .containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str(APP_GROUP))
        .ok_or("app_group_unavailable")?;
    Ok(PathBuf::from(
        url.path().ok_or("app_group_unavailable")?.to_string(),
    ))
}

#[cfg(target_os = "ios")]
fn autofill_scope(app: &tauri::AppHandle, user_id: &str) -> Result<String, String> {
    Ok(sha256_hex(format!("{}/{user_id}", server(app)?).as_bytes()))
}

#[tauri::command]
pub async fn passkeys_pending(
    app: tauri::AppHandle,
    user_id: String,
) -> Result<Vec<crate::passkeys::Pending>, String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, user_id);
        Err("ios_only".into())
    }
    #[cfg(target_os = "ios")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let directory = app_group()?;
            let scope = autofill_scope(&app, &user_id)?;
            let state = app.state::<Mutex<Session>>();
            let mut session = state.lock().map_err(|_| "session_unavailable")?;
            crate::passkeys::pending(&mut session, &directory, &scope)
        })
        .await
        .map_err(|_| "storage_unavailable")?
    }
}

#[tauri::command]
pub fn passkeys_acknowledge(
    app: tauri::AppHandle,
    user_id: String,
    files: Vec<String>,
) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, user_id, files);
        Err("ios_only".into())
    }
    #[cfg(target_os = "ios")]
    {
        let scope = autofill_scope(&app, &user_id)?;
        crate::passkeys::acknowledge(&app_group()?, &scope, &files)
    }
}

#[tauri::command]
pub fn autofill_active(app: tauri::AppHandle, user_id: String) -> bool {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, user_id);
        false
    }
    #[cfg(target_os = "ios")]
    {
        let (Ok(directory), Ok(scope)) = (app_group(), autofill_scope(&app, &user_id)) else {
            return false;
        };
        fs::read_to_string(directory.join("active.txt")).is_ok_and(|active| active.trim() == scope)
    }
}

#[tauri::command]
pub fn is_ios() -> bool {
    cfg!(target_os = "ios")
}

#[tauri::command]
pub async fn autofill_publish(
    app: tauri::AppHandle,
    user_id: String,
    entries: Value,
    passkeys: Vec<crate::passkeys::Synced>,
) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, user_id, entries, passkeys);
        Err("ios_only".into())
    }
    #[cfg(target_os = "ios")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let group = APP_GROUP;
            let directory = app_group()?;
            let scope = autofill_scope(&app, &user_id)?;
            let created = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "clock_error")?
                .as_secs();
            let data = Zeroizing::new(
                serde_json::to_vec(&serde_json::json!({"createdAt":created,"passwords":entries}))
                    .map_err(|_| "invalid_request")?,
            );
            let (key, ciphertext, synced) = {
                let state = app.state::<Mutex<Session>>();
                let mut session = state.lock().map_err(|_| "session_unavailable")?;
                (
                    session.autofill_key(&scope).map_err(str::to_owned)?,
                    session
                        .autofill_seal(&scope, "passwords", &data)
                        .map_err(str::to_owned)?,
                    crate::passkeys::seal_synced(&mut session, &scope, &passkeys)?,
                )
            };
            let item = || {
                let mut config =
                    PasswordOptions::new_generic_password("de.melonapp.autofill.v1", &scope);
                config.use_protected_keychain();
                config.set_access_group(group);
                config.set_access_synchronized(Some(false));
                config
            };
            if passwords::delete_generic_password_options(item())
                .is_err_and(|e| e.code() != NOT_FOUND)
            {
                return Err("biometric_unavailable".into());
            }
            let mut config = item();
            let access = SecAccessControl::create_with_protection(
                Some(ProtectionMode::AccessibleWhenPasscodeSetThisDeviceOnly),
                AccessControlOptions::BIOMETRY_CURRENT_SET.bits(),
            )
            .map_err(|_| "biometric_unavailable")?;
            config.set_access_control(access);
            passwords::set_generic_password_options(&key, config)
                .map_err(|_| "biometric_unavailable")?;
            atomic_write(
                &directory.join(format!("{scope}.passwords.enc")),
                ciphertext.as_bytes(),
            )?;
            atomic_write(
                &directory.join(crate::passkeys::synced_name(&scope)),
                synced.as_bytes(),
            )?;
            atomic_write(&directory.join("active.txt"), scope.as_bytes())?;
            Ok(())
        })
        .await
        .map_err(|_| "autofill_unavailable")?
    }
}
