pub mod commands;
pub mod storage;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{Emitter, Manager, RunEvent};

/// Set once the frontend has flushed pending writes and asked to exit.
static FLUSHED: AtomicBool = AtomicBool::new(false);

/// True while an exit watchdog thread is pending.
static WATCHDOG_PENDING: AtomicBool = AtomicBool::new(false);

/// If the frontend never answers `before-exit`, force the exit after this long.
pub const EXIT_FLUSH_TIMEOUT: Duration = Duration::from_secs(5);

pub const BEFORE_EXIT_EVENT: &str = "zukai://before-exit";

#[tauri::command]
fn app_exit_after_flush(app: tauri::AppHandle) {
    FLUSHED.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::scratchpad_read,
            commands::scratchpad_write,
            commands::scratchpad_delete,
            commands::scratchpad_close,
            commands::scratchpad_reopen,
            commands::scratchpad_list,
            commands::scratchpad_purge_closed,
            commands::session_read,
            commands::session_write,
            app_exit_after_flush,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, code, .. } = event
                && code.is_none()
                && !FLUSHED.load(Ordering::SeqCst)
            {
                api.prevent_exit();
                let _ = app.emit(BEFORE_EXIT_EVENT, ());
                if !WATCHDOG_PENDING.swap(true, Ordering::SeqCst) {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(EXIT_FLUSH_TIMEOUT);
                        FLUSHED.store(true, Ordering::SeqCst);
                        app.exit(0);
                    });
                }
            }
        });
}
