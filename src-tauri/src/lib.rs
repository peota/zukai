pub mod commands;
pub mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
