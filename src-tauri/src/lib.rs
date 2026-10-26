pub mod commands;
mod files;
pub mod storage;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_window_state::StateFlags;

/// Set once the frontend has flushed pending writes and asked to exit.
static FLUSHED: AtomicBool = AtomicBool::new(false);

/// True while an exit watchdog thread is pending.
static WATCHDOG_PENDING: AtomicBool = AtomicBool::new(false);

/// Watchdog generation. Each watchdog fires only if the generation is still
/// the one it captured at spawn; cancelling bumps it, invalidating sleepers.
static WATCHDOG_GENERATION: AtomicU64 = AtomicU64::new(0);

/// A watchdog captured at `captured` may force the exit only if no cancel
/// happened since.
fn should_fire(captured: u64, current: u64) -> bool {
    captured == current
}

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

/// The first flush failed and the app stays open: cancel the pending watchdog
/// and re-arm so the next quit request starts a fresh one.
#[tauri::command]
fn exit_flush_failed() {
    cancel_watchdog();
}

fn cancel_watchdog() {
    WATCHDOG_GENERATION.fetch_add(1, Ordering::SeqCst);
    WATCHDOG_PENDING.store(false, Ordering::SeqCst);
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
        let generation = WATCHDOG_GENERATION.load(Ordering::SeqCst);
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(EXIT_FLUSH_TIMEOUT);
            if !should_fire(generation, WATCHDOG_GENERATION.load(Ordering::SeqCst)) {
                return;
            }
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
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            files::open_paths::emit(app, &args, std::path::Path::new(&cwd));
        }))
        // The frontend shows the window once restored; the plugin must not
        // show it early (that would flash a blank frame).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(files::grants::Grants::default())
        .manage(files::watch::Watcher::default())
        .manage(files::open_paths::LaunchPaths::default())
        .on_window_event(|window, event| {
            // Rust needs the drop (it grants the paths), so the webview's own
            // drag and drop stays disabled by Tauri while this is enabled.
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                files::open_paths::emit_dropped(window.app_handle(), paths.clone());
            }
        })
        .setup(|app| {
            // This process's own argv waits for the UI (`take_launch_paths`).
            let argv: Vec<String> = std::env::args().collect();
            if let Ok(cwd) = std::env::current_dir() {
                app.state::<files::open_paths::LaunchPaths>()
                    .set(files::open_paths::argv_paths(&argv, &cwd));
            }
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
            commands::shadow_write,
            commands::shadow_read,
            commands::shadow_delete,
            commands::shadow_list,
            files::commands::file_read,
            files::commands::file_reread_as,
            files::commands::file_write,
            files::commands::file_save_as,
            files::commands::file_rename,
            files::commands::file_fingerprint,
            files::commands::file_pick_open,
            files::commands::file_pick_save,
            files::watch::file_watch,
            files::open_paths::take_launch_paths,
            app_exit_after_flush,
            exit_flush_failed,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_watchdog_is_stale_and_rearmed_one_is_current() {
        let first = WATCHDOG_GENERATION.load(Ordering::SeqCst);
        WATCHDOG_GENERATION.fetch_add(1, Ordering::SeqCst); // cancel
        let second = WATCHDOG_GENERATION.load(Ordering::SeqCst); // re-arm
        let now = WATCHDOG_GENERATION.load(Ordering::SeqCst);
        assert!(!should_fire(first, now));
        assert!(should_fire(second, now));
    }
}
