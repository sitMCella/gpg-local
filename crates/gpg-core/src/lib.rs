//! Tauri-free OpenPGP core for GPG Local.
//!
//! Works on byte streams (`Read` / `Write`) instead of file paths so it can be
//! shared by the desktop app and the Android app. The only filesystem location
//! it touches is the keyring directory passed to [`Keyring::open`].

mod error;
mod helpers;
mod info;
mod keyring;
mod ops;

pub use error::{CoreError, Result};
pub use helpers::KeyringHelper;
pub use info::{cert_to_info, KeyInfo};
pub use keyring::Keyring;
pub use ops::{decrypt, encrypt, generate_key, import_key, list_keys, EncryptParams};

#[cfg(test)]
mod tests;
