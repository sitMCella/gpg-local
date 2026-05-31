use sequoia_openpgp::{
    crypto::{self, SessionKey},
    parse::stream::{DecryptionHelper, MessageStructure, VerificationHelper},
    types::SymmetricAlgorithm,
    Cert, Fingerprint, KeyHandle,
};

pub struct KeyringHelper {
    pub certs: Vec<Cert>,
    pub passphrase: crypto::Password,
}

impl VerificationHelper for KeyringHelper {
    fn get_certs(&mut self, _ids: &[KeyHandle]) -> sequoia_openpgp::Result<Vec<Cert>> {
        Ok(self.certs.clone())
    }
    fn check(&mut self, _structure: MessageStructure) -> sequoia_openpgp::Result<()> {
        Ok(())
    }
}

impl DecryptionHelper for KeyringHelper {
    fn decrypt<D>(
        &mut self,
        pkesks: &[sequoia_openpgp::packet::PKESK],
        skesks: &[sequoia_openpgp::packet::SKESK],
        sym_algo: Option<SymmetricAlgorithm>,
        mut decrypt: D,
    ) -> sequoia_openpgp::Result<Option<Fingerprint>>
    where
        D: FnMut(SymmetricAlgorithm, &SessionKey) -> bool,
    {
        // Try symmetric passphrase first (SKESK packets — produced by symmetric-only encryption)
        for skesk in skesks {
            if let Ok((algo, sk)) = skesk.decrypt(&self.passphrase) {
                if decrypt(algo, &sk) {
                    return Ok(None);
                }
            }
        }

        // Fall back to public-key decryption (PKESK packets)
        let policy = sequoia_openpgp::policy::StandardPolicy::new();
        for pkesk in pkesks {
            for cert in &self.certs {
                for key in cert
                    .keys()
                    .with_policy(&policy, None)
                    .supported()
                    .alive()
                    .revoked(false)
                    .for_transport_encryption()
                    .secret()
                {
                    let mut key = key.key().clone();
                    if key.secret().is_encrypted() {
                        let pk_algo = key.pk_algo();
                        let _ = key.secret_mut().decrypt_in_place(pk_algo, &self.passphrase);
                    }
                    if let Ok(mut keypair) = key.into_keypair() {
                        if let Some((algo, sk)) = pkesk.decrypt(&mut keypair, sym_algo) {
                            if decrypt(algo, &sk) {
                                return Ok(Some(cert.fingerprint()));
                            }
                        }
                    }
                }
            }
        }
        Err(anyhow::anyhow!("no matching secret key found").into())
    }
}
