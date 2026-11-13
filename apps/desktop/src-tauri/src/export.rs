use std::sync::atomic::{AtomicBool, Ordering};

pub const MAX_EXPORT_BYTES: usize = 128 * 1024 * 1024;

#[derive(Default)]
pub struct SaveDialog(AtomicBool);

impl SaveDialog {
    pub fn is_open(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    #[cfg(any(desktop, test))]
    fn set(&self, open: bool) {
        self.0.store(open, Ordering::SeqCst);
    }
}

pub fn valid_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("melonapp-export-") else {
        return false;
    };
    let kind_ok = rest.ends_with(".melon.json") || rest.ends_with("-UNVERSCHLUESSELT.csv");
    name.len() <= 80
        && kind_ok
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.')
        && !name.contains("..")
}

pub fn validate(name: &str, content: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("invalid_request".into());
    }
    if content.is_empty() || content.len() > MAX_EXPORT_BYTES {
        return Err("invalid_request".into());
    }
    Ok(())
}

#[cfg(desktop)]
fn write_private(path: &std::path::Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    #[cfg(unix)]
    file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    file.write_all(content.as_bytes())?;
    file.sync_all()
}

#[cfg(desktop)]
fn relock_unless_focused(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    use std::sync::Mutex;
    use tauri::{Emitter, Manager};
    for _ in 0..10 {
        if window.is_focused().unwrap_or(false) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if let Ok(mut session) = app.state::<Mutex<melon_native::Session>>().lock() {
        session.set_active(false);
    }
    let _ = window.emit("melon-locked", ());
}

#[cfg(desktop)]
#[tauri::command]
pub async fn save_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    name: String,
    content: String,
) -> Result<Option<String>, String> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;
    validate(&name, &content)?;
    let csv = name.ends_with(".csv");
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.state::<SaveDialog>();
        dialog.set(true);
        let picked = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(&name)
            .add_filter(
                if csv { "CSV" } else { "MelonApp-Export" },
                &[if csv { "csv" } else { "json" }],
            )
            .blocking_save_file();
        dialog.set(false);
        relock_unless_focused(&app, &window);
        let Some(picked) = picked else {
            return Ok(None);
        };
        let path = picked.into_path().map_err(|_| "export_failed".to_owned())?;
        write_private(&path, &content).map_err(|_| "export_failed".to_owned())?;
        Ok(path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .or(Some(name)))
    })
    .await
    .map_err(|_| "export_failed".to_owned())?
}

#[cfg(mobile)]
#[tauri::command]
pub async fn save_export(name: String, content: String) -> Result<Option<String>, String> {
    validate(&name, &content)?;
    Err("export_unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_export_file_names() {
        assert!(valid_name("melonapp-export-2026-11-13.melon.json"));
        assert!(valid_name(
            "melonapp-export-2026-11-13-UNVERSCHLUESSELT.csv"
        ));
        for name in [
            "",
            "export.melon.json",
            "melonapp-export-../../.ssh/authorized_keys.melon.json",
            "melonapp-export-2026/11.melon.json",
            "melonapp-export-2026-11-13.melon.json.sh",
            "melonapp-export-2026-11-13.csv",
            "melonapp-export-2026 11.melon.json",
            "melonapp-export-\u{0}.melon.json",
        ] {
            assert!(!valid_name(name), "{name:?}");
        }
        assert!(!valid_name(&format!(
            "melonapp-export-{}.melon.json",
            "a".repeat(80)
        )));
    }

    #[test]
    fn rejects_empty_and_oversized_content() {
        let name = "melonapp-export-2026-11-13.melon.json";
        assert!(validate(name, "{}").is_ok());
        assert!(validate(name, "").is_err());
        assert!(validate(name, &"a".repeat(MAX_EXPORT_BYTES + 1)).is_err());
        assert!(validate("evil.sh", "{}").is_err());
    }

    #[test]
    fn save_dialog_flag_toggles() {
        let dialog = SaveDialog::default();
        assert!(!dialog.is_open());
        dialog.set(true);
        assert!(dialog.is_open());
        dialog.set(false);
        assert!(!dialog.is_open());
    }
}
