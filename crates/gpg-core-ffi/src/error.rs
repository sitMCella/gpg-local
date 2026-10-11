/// Errors crossing the FFI boundary. Becomes the `GpgException` sealed class in Kotlin.
///
/// `flat_error` makes the Kotlin exception `message` the Rust `Display` string, so it
/// matches the desktop UI strings exactly. No variant ever formats a passphrase.
#[derive(Debug, thiserror::Error, uniffi::Error)]
#[uniffi(flat_error)]
pub enum GpgError {
    #[error("key not found: {fingerprint}")]
    KeyNotFound { fingerprint: String },
    #[error("No recipients or passphrase specified")]
    NoRecipientsOrPassphrase,
    #[error("no matching secret key found")]
    NoMatchingSecretKey,
    #[error("{message}")]
    Io { message: String },
    #[error("{message}")]
    OpenPgp { message: String },
}

impl GpgError {
    pub(crate) fn io(e: impl std::fmt::Display) -> Self {
        Self::Io {
            message: e.to_string(),
        }
    }
}

impl From<gpg_core::CoreError> for GpgError {
    fn from(e: gpg_core::CoreError) -> Self {
        use gpg_core::CoreError as C;
        match e {
            C::KeyNotFound(fingerprint) => Self::KeyNotFound { fingerprint },
            C::NoRecipientsOrPassphrase => Self::NoRecipientsOrPassphrase,
            C::NoMatchingSecretKey => Self::NoMatchingSecretKey,
            C::Io(e) => Self::io(e),
            C::OpenPgp(e) => Self::OpenPgp {
                message: e.to_string(),
            },
        }
    }
}
