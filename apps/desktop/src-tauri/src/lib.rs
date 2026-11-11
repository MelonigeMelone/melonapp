mod platform;
use melon_native::Session;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[tauri::command]
fn crypto_call(
    method: String,
    args: serde_json::Value,
    state: tauri::State<'_, Mutex<Session>>,
) -> Result<serde_json::Value, String> {
    state
        .lock()
        .map_err(|_| "session_unavailable".to_owned())?
        .call(&method, args)
        .map_err(str::to_owned)
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
            platform::biometric_unlock,
            platform::biometric_disable
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
            if matches!(
                event,
                tauri::WindowEvent::Focused(false) | tauri::WindowEvent::Destroyed
            ) {
                if let Ok(mut session) = window.state::<Mutex<Session>>().lock() {
                    session.lock();
                }
                let _ = window.emit("melon-locked", ());
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
