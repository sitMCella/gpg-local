use std::path::PathBuf;
use anyhow::{Context, Result};
use sequoia_openpgp::Cert;
use sequoia_openpgp::parse::Parse;
use sequoia_openpgp::serialize::SerializeInto;

pub struct Keyring {
    dir: PathBuf,
}

impl Keyring {
    pub fn open(app_data_dir: PathBuf) -> Result<Self> {
        let dir = app_data_dir.join("keyring");
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn store(&self, cert: &Cert) -> Result<()> {
        let fp = cert.fingerprint().to_hex();
        let path = self.dir.join(format!("{fp}.pgp"));
        let armored = cert.armored().to_vec()?;
        std::fs::write(&path, armored)?;
        Ok(())
    }

    pub fn load_all(&self) -> Result<Vec<Cert>> {
        let mut certs = Vec::new();
        for entry in std::fs::read_dir(&self.dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) == Some("pgp") {
                let data = std::fs::read(&path)?;
                let cert = Cert::from_bytes(&data)
                    .with_context(|| format!("parsing {}", path.display()))?;
                certs.push(cert);
            }
        }
        Ok(certs)
    }

    pub fn find(&self, fingerprint: &str) -> Result<Option<Cert>> {
        let path = self.dir.join(format!("{}.pgp", fingerprint.to_uppercase()));
        if !path.exists() {
            return Ok(None);
        }
        let data = std::fs::read(path)?;
        Ok(Some(Cert::from_bytes(&data)?))
    }
}
