/// Errors returned by the core.
///
/// The `Display` strings are part of the UI contract: the desktop app shows
/// them verbatim. No variant ever formats a passphrase.
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("key not found: {0}")]
    KeyNotFound(String),
    #[error("No recipients or passphrase specified")]
    NoRecipientsOrPassphrase,
    #[error("no matching secret key found")]
    NoMatchingSecretKey,
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    OpenPgp(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, CoreError>;
