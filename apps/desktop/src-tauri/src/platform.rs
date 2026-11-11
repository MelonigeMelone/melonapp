use melon_native::Session;
use security_framework::{
    access_control::{ProtectionMode, SecAccessControl},
    passwords::{self, AccessControlOptions, PasswordOptions},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::Manager;
use zeroize::Zeroizing;

const SERVICE: &str = "de.melonapp.app.biometric.v1";

fn location(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "storage_unavailable")?;
    fs::create_dir_all(&dir).map_err(|_| "storage_unavailable")?;
    Ok(dir.join(name))
}

fn write(app: &tauri::AppHandle, name: &str, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let path = location(app, name)?;
    let temp = path.with_extension("pending");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temp)
        .map_err(|_| "storage_unavailable")?;
    file.write_all(data)
        .and_then(|()| file.sync_all())
        .map_err(|_| "storage_unavailable")?;
    fs::rename(temp, path).map_err(|_| "storage_unavailable".into())
}

fn read(app: &tauri::AppHandle, name: &str) -> Result<String, String> {
    let path = location(app, name)?;
    if fs::metadata(&path).map_err(|_| "cache_unavailable")?.len() > 48 * 1024 * 1024 {
        return Err("cache_too_large".into());
    }
    fs::read_to_string(path).map_err(|_| "cache_unavailable".into())
}

fn server(app: &tauri::AppHandle) -> Result<String, String> {
    read(app, "server.txt")
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
    Ok(server(&app).unwrap_or_default())
}

#[tauri::command]
pub fn set_server(app: tauri::AppHandle, value: String) -> Result<(), String> {
    let value = validated_server(&value)?;
    if server(&app).ok().as_ref() != Some(&value) {
        app.state::<Mutex<Session>>()
            .lock()
            .map_err(|_| "session_unavailable")?
            .lock();
    }
    write(&app, "server.txt", value.as_bytes())
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
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.contains("..")
        || path.contains('#')
        || !matches!(method.as_str(), "GET" | "POST" | "PUT" | "DELETE")
    {
        return Err("invalid_request".into());
    }
    let base = validated_server(&server(&app)?)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "network_error")?;
    let mut request = client.request(
        method.parse().map_err(|_| "invalid_request")?,
        format!("{base}/api/v1{path}"),
    );
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
        let name = format!("cache-{:x}.enc", Sha256::digest(scope.as_bytes()));
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
        let (key, snapshot) = {
            let state = app.state::<Mutex<Session>>();
            let mut session = state.lock().map_err(|_| "session_unavailable")?;
            (
                session.biometric_key().map_err(str::to_owned)?,
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
        if deletion.is_err_and(|e| e.code() != -25300) {
            return Err("biometric_unavailable".into());
        }
        passwords::set_generic_password_options(&key, config)
            .map_err(|_| "biometric_unavailable")?;
        write(&app, "biometric.enc", snapshot.as_bytes())
    })
    .await
    .map_err(|_| "biometric_unavailable")?
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
        let mut session = state.lock().map_err(|_| "session_unavailable")?;
        session
            .biometric_restore(&key, &scope, &snapshot)
            .map_err(str::to_owned)
    })
    .await
    .map_err(|_| "biometric_unavailable")?
}

#[tauri::command]
pub fn biometric_disable(app: tauri::AppHandle) -> Result<(), String> {
    let scope = format!("{}/biometric", server(&app)?);
    if passwords::delete_generic_password_options(options(&scope))
        .is_err_and(|e| e.code() != -25300)
    {
        return Err("biometric_unavailable".into());
    }
    let path = location(&app, "biometric.enc")?;
    if path.exists() {
        fs::remove_file(path).map_err(|_| "storage_unavailable")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, user_id, entries);
        Err("ios_only".into())
    }
    #[cfg(target_os = "ios")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            use objc2_foundation::{NSFileManager, NSString};
            let group = "group.de.melonapp.shared";
            let url = NSFileManager::defaultManager()
                .containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str(group))
                .ok_or("app_group_unavailable")?;
            let directory = PathBuf::from(url.path().ok_or("app_group_unavailable")?.to_string());
            let base = server(&app)?;
            let scope = format!(
                "{:x}",
                Sha256::digest(format!("{base}/{user_id}").as_bytes())
            );
            let account = format!("autofill/v1/{scope}");
            let created = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "clock_error")?
                .as_secs();
            let data = Zeroizing::new(
                serde_json::to_vec(&serde_json::json!({"createdAt":created,"passwords":entries}))
                    .map_err(|_| "invalid_request")?,
            );
            let (key, ciphertext) = {
                let state = app.state::<Mutex<Session>>();
                let mut session = state.lock().map_err(|_| "session_unavailable")?;
                (
                    session.biometric_key().map_err(str::to_owned)?,
                    session
                        .cache_seal(&format!("{account}/passwords"), &data)
                        .map_err(str::to_owned)?,
                )
            };
            let mut config =
                PasswordOptions::new_generic_password("de.melonapp.autofill.v1", &scope);
            config.use_protected_keychain();
            config.set_access_group(group);
            config.set_access_synchronized(Some(false));
            let access = SecAccessControl::create_with_protection(
                Some(ProtectionMode::AccessibleWhenPasscodeSetThisDeviceOnly),
                AccessControlOptions::BIOMETRY_CURRENT_SET.bits(),
            )
            .map_err(|_| "biometric_unavailable")?;
            config.set_access_control(access);
            passwords::set_generic_password_options(&key, config)
                .map_err(|_| "biometric_unavailable")?;
            fs::write(
                directory.join(format!("{scope}.passwords.pending")),
                ciphertext,
            )
            .map_err(|_| "storage_unavailable")?;
            fs::rename(
                directory.join(format!("{scope}.passwords.pending")),
                directory.join(format!("{scope}.passwords.enc")),
            )
            .map_err(|_| "storage_unavailable")?;
            fs::write(directory.join("active.txt"), scope).map_err(|_| "storage_unavailable")?;
            Ok(())
        })
        .await
        .map_err(|_| "autofill_unavailable")?
    }
}
