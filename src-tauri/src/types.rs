use serde::{Deserialize, Serialize};

pub use gpg_core::KeyInfo;

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
