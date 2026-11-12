#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
mod passkeys;
mod platform;
use melon_native::Session;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[tauri::command]
async fn crypto_call(
    method: String,
    args: serde_json::Value,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Mutex<Session>>()
            .lock()
            .map_err(|_| "session_unavailable".to_owned())?
            .call(&method, args)
            .map_err(str::to_owned)
    })
    .await
    .map_err(|_| "session_unavailable".to_owned())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(Mutex::new(Session::default()))
        .invoke_handler(tauri::generate_handler![
            crypto_call,
            platform::get_server,
            platform::set_server,
            platform::api_request,
            platform::biometric_enable,
            platform::biometric_status,
            platform::biometric_unlock,
            platform::biometric_keeps_token,
            platform::biometric_disable,
            platform::autofill_publish,
            platform::autofill_active,
            platform::passkeys_pending,
            platform::passkeys_acknowledge,
            platform::is_ios
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    let expired = handle
                        .state::<Mutex<Session>>()
                        .lock()
                        .map(|mut session| session.expire())
                        .unwrap_or(true);
                    if expired {
                        let _ = handle.emit("melon-locked", ());
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            let active = match event {
                tauri::WindowEvent::Focused(active) => Some(*active),
                tauri::WindowEvent::Destroyed => Some(false),
                #[cfg(mobile)]
                tauri::WindowEvent::Suspended => Some(false),
                #[cfg(mobile)]
                tauri::WindowEvent::Resumed => Some(true),
                _ => None,
            };
            if let Some(active) = active {
                if let Ok(mut session) = window.state::<Mutex<Session>>().lock() {
                    session.set_active(active);
                }
                if !active {
                    let _ = window.emit("melon-locked", ());
                }
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_shortcut("CommandOrControl+Shift+M")
            .expect("valid shortcut")
            .with_handler(|app, _, event| {
                if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            })
            .build(),
    );
    builder
        .run(tauri::generate_context!())
        .expect("application failed");
}
