use sequoia_openpgp::Cert;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeyInfo {
    pub fingerprint: String,
    pub user_ids: Vec<String>,
    pub has_secret: bool,
    pub created_at: i64,
}

pub fn cert_to_info(cert: &Cert) -> KeyInfo {
    KeyInfo {
        fingerprint: cert.fingerprint().to_hex(),
        user_ids: cert
            .userids()
            .map(|u| String::from_utf8_lossy(u.value()).into_owned())
            .collect(),
        has_secret: cert.is_tsk(),
        created_at: cert
            .primary_key()
            .creation_time()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
    }
}
