use std::sync::Mutex;
use zeroize::Zeroizing;

static COPIED: Mutex<Option<Zeroizing<String>>> = Mutex::new(None);

#[cfg_attr(not(any(target_os = "macos", windows)), allow(dead_code))]
pub fn should_clear(copied: Option<&str>, current: Option<&str>) -> bool {
    matches!((copied, current), (Some(copied), Some(current)) if copied == current)
}

#[cfg(any(target_os = "macos", windows))]
fn board() -> Result<arboard::Clipboard, String> {
    arboard::Clipboard::new().map_err(|_| "clipboard_unavailable".into())
}

#[tauri::command]
pub fn native_clipboard() -> bool {
    cfg!(any(target_os = "macos", windows))
}

#[tauri::command]
pub fn clipboard_copy(secret: String) -> Result<(), String> {
    let secret = Zeroizing::new(secret);
    #[cfg(any(target_os = "macos", windows))]
    {
        #[cfg(target_os = "macos")]
        use arboard::SetExtApple as _;
        #[cfg(windows)]
        use arboard::SetExtWindows as _;
        let mut board = board()?;
        #[cfg(target_os = "macos")]
        let request = board.set().exclude_from_history();
        #[cfg(windows)]
        let request = board.set().exclude_from_monitoring();
        request
            .text(secret.as_str())
            .map_err(|_| "clipboard_unavailable")?;
        *COPIED.lock().map_err(|_| "clipboard_unavailable")? = Some(secret);
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = secret;
        Err("unsupported".into())
    }
}

#[tauri::command]
pub fn clipboard_clear() -> Result<(), String> {
    let copied = COPIED.lock().map_err(|_| "clipboard_unavailable")?.take();
    #[cfg(any(target_os = "macos", windows))]
    {
        let mut board = board()?;
        let current = board.get_text().ok().map(Zeroizing::new);
        if should_clear(
            copied.as_deref().map(String::as_str),
            current.as_deref().map(String::as_str),
        ) {
            board.clear().map_err(|_| "clipboard_unavailable")?;
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = copied;
        Err("unsupported".into())
    }
}

#[cfg(test)]
mod tests {
    use super::should_clear;

    #[test]
    fn clears_only_the_secret_it_copied() {
        assert!(should_clear(Some("geheim"), Some("geheim")));
        assert!(!should_clear(Some("geheim"), Some("Einkaufsliste")));
        assert!(!should_clear(Some("geheim"), None));
        assert!(!should_clear(None, Some("geheim")));
        assert!(!should_clear(None, None));
    }
}
