use gpg_core::{CoreError, EncryptParams, Keyring};
use tauri::Manager;

use crate::fs_io::{open_input, write_atomically};
use crate::types::{DecryptOptions, EncryptOptions, KeyInfo};

fn open_keyring(app: &tauri::AppHandle) -> Result<Keyring, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Keyring::open(data_dir).map_err(|e| e.to_string())
}

fn err(e: CoreError) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn list_keys(app: tauri::AppHandle) -> Result<Vec<KeyInfo>, String> {
    let keyring = open_keyring(&app)?;
    blocking(move || gpg_core::list_keys(&keyring).map_err(err)).await
}

#[tauri::command]
pub async fn import_key(app: tauri::AppHandle, armored: String) -> Result<KeyInfo, String> {
    let keyring = open_keyring(&app)?;
    blocking(move || gpg_core::import_key(&keyring, &armored).map_err(err)).await
}

#[tauri::command]
pub async fn generate_key(
    app: tauri::AppHandle,
    name: String,
    email: String,
    passphrase: String,
) -> Result<KeyInfo, String> {
    let keyring = open_keyring(&app)?;
    blocking(move || gpg_core::generate_key(&keyring, &name, &email, &passphrase).map_err(err))
        .await
}

#[tauri::command]
pub async fn encrypt_file(app: tauri::AppHandle, options: EncryptOptions) -> Result<(), String> {
    let keyring = open_keyring(&app)?;
    blocking(move || {
        let params = EncryptParams {
            recipient_fingerprints: &options.recipient_fingerprints,
            passphrase: options.passphrase.as_deref(),
        };
        let mut input = open_input(&options.input_path)?;
        write_atomically(&options.output_path, |out| {
            gpg_core::encrypt(&keyring, params, &mut input, out).map_err(err)
        })
    })
    .await
}

#[tauri::command]
pub async fn decrypt_file(app: tauri::AppHandle, options: DecryptOptions) -> Result<(), String> {
    let keyring = open_keyring(&app)?;
    blocking(move || {
        let input = open_input(&options.input_path)?;
        write_atomically(&options.output_path, |out| {
            gpg_core::decrypt(&keyring, &options.passphrase, input, out).map_err(err)
        })
    })
    .await
}

/// Runs blocking crypto and file I/O on Tauri's blocking thread pool so the
/// async runtime thread stays free.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}
