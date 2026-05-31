mod commands;
mod helpers;
mod keyring;
mod types;

use commands::{decrypt_file, encrypt_file, generate_key, import_key, list_keys};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_keys,
            import_key,
            generate_key,
            encrypt_file,
            decrypt_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
