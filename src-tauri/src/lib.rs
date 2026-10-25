pub mod commands;
pub mod storage;

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_window_state::StateFlags;

/// Set once the frontend has flushed pending writes and asked to exit.
static FLUSHED: AtomicBool = AtomicBool::new(false);

/// True while an exit watchdog thread is pending.
static WATCHDOG_PENDING: AtomicBool = AtomicBool::new(false);

/// If the frontend never answers `before-exit`, force the exit after this long.
pub const EXIT_FLUSH_TIMEOUT: Duration = Duration::from_secs(5);

/// If the frontend hasn't shown the window by then, Rust shows it.
pub const SHOW_FALLBACK_DELAY: Duration = Duration::from_secs(3);

pub const BEFORE_EXIT_EVENT: &str = "zukai://before-exit";

#[tauri::command]
fn app_exit_after_flush(app: AppHandle) {
    FLUSHED.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// Record a startup milestone reached in the frontend (restore, show).
#[tauri::command]
async fn app_startup_mark(app: AppHandle, event: String) {
    log_startup(&app, &format!("js: {event}"));
}

/// Best effort: a failed diagnostic write must never affect the app.
fn log_startup(app: &AppHandle, message: &str) {
    if let Ok(base) = storage::data_dir(app) {
        let _ = storage::startup_log::append(&base, message);
    }
}

/// Ask the frontend to flush and exit; force the exit if it never answers.
fn request_exit(app: &AppHandle) {
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

/// Show the main window if the frontend never did (e.g. a script failed).
fn spawn_show_fallback(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_FALLBACK_DELAY);
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        if window.is_visible().unwrap_or(false) {
            return;
        }
        let shown = window.show().is_ok();
        let _ = window.set_focus();
        log_startup(
            &app,
            if shown {
                "fallback-show"
            } else {
                "fallback-show failed"
            },
        );
    });
}

/// macOS: the default menu's Quit terminates before the webview sees Cmd+Q.
/// Our Quit goes through the same flush handshake as every other platform,
/// and the standard Edit items keep text editing shortcuts working.
#[cfg(target_os = "macos")]
fn install_mac_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    const QUIT_ID: &str = "zukai-quit";
    let quit = MenuItemBuilder::with_id(QUIT_ID, "Quit Zukai")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "Zukai")
        .about(None)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    // No Close Window item: Cmd+W closes a Tab, handled by the webview.
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .fullscreen()
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == QUIT_ID {
            request_exit(app);
        }
    });
    Ok(())
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
        // The frontend shows the window once restored; the plugin must not
        // show it early (that would flash a blank frame).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .setup(|app| {
            log_startup(app.handle(), "launch");
            #[cfg(target_os = "macos")]
            install_mac_menu(app)?;
            spawn_show_fallback(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scratchpad_read,
            commands::scratchpad_write,
            commands::scratchpad_delete,
            commands::scratchpad_close,
            commands::scratchpad_reopen,
            commands::scratchpad_list,
            commands::scratchpad_list_closed,
            commands::scratchpad_purge_closed,
            commands::session_read,
            commands::session_write,
            commands::session_backup,
            app_exit_after_flush,
            app_startup_mark,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, code, .. } = event
                && code.is_none()
                && !FLUSHED.load(Ordering::SeqCst)
            {
                api.prevent_exit();
                request_exit(app);
            }
        });
}
