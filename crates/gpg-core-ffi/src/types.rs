/// Mirror of `gpg_core::KeyInfo`: UniFFI can only derive on types defined in this crate.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct KeyInfo {
    pub fingerprint: String,
    pub user_ids: Vec<String>,
    pub has_secret: bool,
    /// Unix timestamp (seconds).
    pub created_at: i64,
}

impl From<gpg_core::KeyInfo> for KeyInfo {
    fn from(k: gpg_core::KeyInfo) -> Self {
        Self {
            fingerprint: k.fingerprint,
            user_ids: k.user_ids,
            has_secret: k.has_secret,
            created_at: k.created_at,
        }
    }
}
