use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeyInfo {
    pub fingerprint: String,
    pub user_ids: Vec<String>,
    pub has_secret: bool,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub recipient_fingerprints: Vec<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DecryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub passphrase: String,
}
