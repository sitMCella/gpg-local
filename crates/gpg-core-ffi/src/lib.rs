//! UniFFI bindings over `gpg-core` for the Android app.
//!
//! All exports are blocking: Kotlin callers must run them on `Dispatchers.IO`.
//! File I/O goes through file descriptors (`ParcelFileDescriptor.detachFd()`),
//! so Rust never resolves `content://` URIs or user paths itself.

uniffi::setup_scaffolding!();

mod error;
mod fd;
mod types;

#[cfg(test)]
mod tests;

pub use error::GpgError;
pub use types::KeyInfo;

use std::fs::File;
use std::io::{BufReader, BufWriter};
use std::sync::Arc;

/// A keyring stored in `<data_dir>/keyring/`, same on-disk format as the desktop app.
#[derive(uniffi::Object)]
pub struct GpgKeyring {
    inner: gpg_core::Keyring,
}

#[uniffi::export]
impl GpgKeyring {
    /// Opens (creating if needed) `<data_dir>/keyring/`. On Android pass `context.filesDir.absolutePath`.
    #[uniffi::constructor]
    pub fn new(data_dir: String) -> Result<Arc<Self>, GpgError> {
        let inner = gpg_core::Keyring::open(data_dir.into()).map_err(GpgError::io)?;
        Ok(Arc::new(Self { inner }))
    }

    pub fn list_keys(&self) -> Result<Vec<KeyInfo>, GpgError> {
        Ok(gpg_core::list_keys(&self.inner)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    pub fn import_key(&self, armored: String) -> Result<KeyInfo, GpgError> {
        Ok(gpg_core::import_key(&self.inner, &armored)?.into())
    }

    pub fn generate_key(
        &self,
        name: String,
        email: String,
        passphrase: String,
    ) -> Result<KeyInfo, GpgError> {
        Ok(gpg_core::generate_key(&self.inner, &name, &email, &passphrase)?.into())
    }

    /// Encrypts `input_fd` into `output_fd` (binary OpenPGP).
    ///
    /// Takes ownership of both descriptors and closes them before returning, on
    /// success and on error. Pass `ParcelFileDescriptor.detachFd()` values and do
    /// not use them afterwards. On error the output may hold partial data; the
    /// caller must discard it.
    pub fn encrypt_fd(
        &self,
        input_fd: i32,
        output_fd: i32,
        recipient_fingerprints: Vec<String>,
        passphrase: Option<String>,
    ) -> Result<(), GpgError> {
        let (input, output) = owned_fd_pair(input_fd, output_fd)?;
        let mut reader = BufReader::new(input);
        let mut writer = BufWriter::new(output);
        gpg_core::encrypt(
            &self.inner,
            gpg_core::EncryptParams {
                recipient_fingerprints: &recipient_fingerprints,
                passphrase: passphrase.as_deref(),
            },
            &mut reader,
            &mut writer,
        )?;
        finish(writer)
    }

    /// Decrypts `input_fd` (binary or ASCII-armored) into `output_fd`.
    ///
    /// Same descriptor ownership contract as [`GpgKeyring::encrypt_fd`].
    pub fn decrypt_fd(
        &self,
        input_fd: i32,
        output_fd: i32,
        passphrase: String,
    ) -> Result<(), GpgError> {
        let (input, output) = owned_fd_pair(input_fd, output_fd)?;
        let mut writer = BufWriter::new(output);
        gpg_core::decrypt(&self.inner, &passphrase, BufReader::new(input), &mut writer)?;
        finish(writer)
    }

    /// In-memory variant of [`GpgKeyring::encrypt_fd`] for small payloads, previews and tests.
    pub fn encrypt_bytes(
        &self,
        plaintext: Vec<u8>,
        recipient_fingerprints: Vec<String>,
        passphrase: Option<String>,
    ) -> Result<Vec<u8>, GpgError> {
        let mut ciphertext = Vec::new();
        gpg_core::encrypt(
            &self.inner,
            gpg_core::EncryptParams {
                recipient_fingerprints: &recipient_fingerprints,
                passphrase: passphrase.as_deref(),
            },
            &mut plaintext.as_slice(),
            &mut ciphertext,
        )?;
        Ok(ciphertext)
    }

    /// In-memory variant of [`GpgKeyring::decrypt_fd`].
    pub fn decrypt_bytes(
        &self,
        ciphertext: Vec<u8>,
        passphrase: String,
    ) -> Result<Vec<u8>, GpgError> {
        let mut plaintext = Vec::new();
        gpg_core::decrypt(
            &self.inner,
            &passphrase,
            ciphertext.as_slice(),
            &mut plaintext,
        )?;
        Ok(plaintext)
    }
}

/// Takes ownership of both descriptors before any other work, so each one is
/// closed on every return path, including when the other one is invalid.
fn owned_fd_pair(input_fd: i32, output_fd: i32) -> Result<(File, File), GpgError> {
    let input = fd::file_from_owned_fd(input_fd);
    let output = fd::file_from_owned_fd(output_fd);
    Ok((input?, output?))
}

/// Flushes buffered output and syncs it to storage. Only regular files are
/// synced: some DocumentsProviders hand out pipe- or socket-backed descriptors,
/// where `fsync` fails (EINVAL on Linux, EBADF on macOS) although every byte
/// was delivered.
fn finish(writer: BufWriter<File>) -> Result<(), GpgError> {
    let file = writer.into_inner().map_err(|e| GpgError::io(e.error()))?;
    if file.metadata().map_err(GpgError::io)?.is_file() {
        file.sync_all().map_err(GpgError::io)?;
    }
    Ok(())
}
