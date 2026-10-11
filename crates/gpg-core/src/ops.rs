use std::io::{Read, Write};

use sequoia_openpgp::cert::CertBuilder;
use sequoia_openpgp::crypto::Password;
use sequoia_openpgp::parse::stream::DecryptorBuilder;
use sequoia_openpgp::parse::Parse;
use sequoia_openpgp::policy::StandardPolicy;
use sequoia_openpgp::serialize::stream::{Encryptor2, LiteralWriter, Message};
use sequoia_openpgp::Cert;

use crate::error::{CoreError, Result};
use crate::helpers::KeyringHelper;
use crate::info::{cert_to_info, KeyInfo};
use crate::keyring::Keyring;

/// What to encrypt to: recipient keys from the keyring, a symmetric passphrase, or both.
pub struct EncryptParams<'a> {
    pub recipient_fingerprints: &'a [String],
    pub passphrase: Option<&'a str>,
}

/// Encrypts everything read from `input` and writes binary OpenPGP to `output`.
pub fn encrypt<R: Read, W: Write + Send + Sync>(
    keyring: &Keyring,
    params: EncryptParams<'_>,
    input: &mut R,
    output: W,
) -> Result<()> {
    let policy = &StandardPolicy::new();

    let recipients: Vec<Cert> = params
        .recipient_fingerprints
        .iter()
        .map(|fp| {
            keyring
                .find(fp)?
                .ok_or_else(|| CoreError::KeyNotFound(fp.clone()))
        })
        .collect::<Result<_>>()?;

    let recipient_keys: Vec<_> = recipients
        .iter()
        .flat_map(|cert| {
            cert.keys()
                .with_policy(policy, None)
                .supported()
                .alive()
                .revoked(false)
                .for_transport_encryption()
        })
        .collect();

    if recipient_keys.is_empty() && params.passphrase.is_none() {
        return Err(CoreError::NoRecipientsOrPassphrase);
    }

    let message = Message::new(output);
    let mut encryptor = Encryptor2::for_recipients(message, recipient_keys);
    if let Some(pw) = params.passphrase {
        encryptor = encryptor.add_passwords([Password::from(pw)]);
    }
    let message = encryptor.build()?;
    let mut message = LiteralWriter::new(message).build()?;
    std::io::copy(input, &mut message)?;
    message.finalize()?;
    Ok(())
}

/// Decrypts an OpenPGP message (binary or ASCII-armored) from `input` into `output`.
/// Tries SKESK with `passphrase` first, then PKESK with every secret key in the keyring.
pub fn decrypt<R: Read + Send + Sync, W: Write>(
    keyring: &Keyring,
    passphrase: &str,
    input: R,
    output: &mut W,
) -> Result<()> {
    let policy = &StandardPolicy::new();
    let helper = KeyringHelper {
        certs: keyring.load_all()?,
        passphrase: passphrase.into(),
    };

    let mut decryptor = DecryptorBuilder::from_reader(input)
        .map_err(map_decrypt_anyhow)?
        .with_policy(policy, None, helper)
        .map_err(map_decrypt_anyhow)?;

    std::io::copy(&mut decryptor, output).map_err(map_decrypt_io)?;
    Ok(())
}

pub fn list_keys(keyring: &Keyring) -> Result<Vec<KeyInfo>> {
    Ok(keyring.load_all()?.iter().map(cert_to_info).collect())
}

pub fn import_key(keyring: &Keyring, armored: &str) -> Result<KeyInfo> {
    let cert = Cert::from_bytes(armored.as_bytes())?;
    let info = cert_to_info(&cert);
    keyring.store(&cert)?;
    Ok(info)
}

pub fn generate_key(
    keyring: &Keyring,
    name: &str,
    email: &str,
    passphrase: &str,
) -> Result<KeyInfo> {
    let uid = format!("{name} <{email}>");
    let (cert, _revocation) = CertBuilder::new()
        .add_userid(uid)
        .add_signing_subkey()
        .add_transport_encryption_subkey()
        .set_password(Some(passphrase.into()))
        .generate()?;

    let info = cert_to_info(&cert);
    keyring.store(&cert)?;
    Ok(info)
}

/// `KeyringHelper::decrypt` fails with `CoreError::NoMatchingSecretKey` wrapped in
/// `anyhow`. Sequoia may surface it as-is, or re-wrapped in an `io::Error`; both
/// paths are mapped back to the typed variant so callers can match on it.
fn map_decrypt_anyhow(err: anyhow::Error) -> CoreError {
    let no_key = err.chain().any(|cause| {
        matches!(
            cause.downcast_ref::<CoreError>(),
            Some(CoreError::NoMatchingSecretKey)
        )
    });
    if no_key || is_no_matching_key_message(&err.to_string()) {
        return CoreError::NoMatchingSecretKey;
    }
    if let Some(io) = err.downcast_ref::<std::io::Error>() {
        if io
            .get_ref()
            .is_some_and(|inner| is_no_matching_key_message(&inner.to_string()))
        {
            return CoreError::NoMatchingSecretKey;
        }
    }
    CoreError::OpenPgp(err)
}

fn map_decrypt_io(err: std::io::Error) -> CoreError {
    if let Some(inner) = err.get_ref() {
        if matches!(
            inner.downcast_ref::<CoreError>(),
            Some(CoreError::NoMatchingSecretKey)
        ) || is_no_matching_key_message(&inner.to_string())
        {
            return CoreError::NoMatchingSecretKey;
        }
    }
    CoreError::Io(err)
}

fn is_no_matching_key_message(msg: &str) -> bool {
    msg == CoreError::NoMatchingSecretKey.to_string()
}
