use sequoia_openpgp::parse::Parse;
use sequoia_openpgp::Cert;
use tauri::Manager;

use crate::types::{DecryptOptions, EncryptOptions, KeyInfo};

fn open_keyring(app: &tauri::AppHandle) -> anyhow::Result<crate::keyring::Keyring> {
    let data_dir = app.path().app_data_dir()?;
    crate::keyring::Keyring::open(data_dir)
}

fn cert_to_info(cert: &Cert) -> KeyInfo {
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

#[tauri::command]
pub async fn list_keys(app: tauri::AppHandle) -> Result<Vec<KeyInfo>, String> {
    let keyring = open_keyring(&app).map_err(|e| e.to_string())?;
    let certs = keyring.load_all().map_err(|e| e.to_string())?;
    Ok(certs.iter().map(cert_to_info).collect())
}

#[tauri::command]
pub async fn import_key(app: tauri::AppHandle, armored: String) -> Result<KeyInfo, String> {
    let cert = Cert::from_bytes(armored.as_bytes()).map_err(|e| e.to_string())?;
    let info = cert_to_info(&cert);
    let keyring = open_keyring(&app).map_err(|e| e.to_string())?;
    keyring.store(&cert).map_err(|e| e.to_string())?;
    Ok(info)
}

#[tauri::command]
pub async fn generate_key(
    app: tauri::AppHandle,
    name: String,
    email: String,
    passphrase: String,
) -> Result<KeyInfo, String> {
    use sequoia_openpgp::cert::CertBuilder;

    let uid = format!("{name} <{email}>");
    let (cert, _revocation) = CertBuilder::new()
        .add_userid(uid)
        .add_signing_subkey()
        .add_transport_encryption_subkey()
        .set_password(Some(passphrase.into()))
        .generate()
        .map_err(|e| e.to_string())?;

    let info = cert_to_info(&cert);
    let keyring = open_keyring(&app).map_err(|e| e.to_string())?;
    keyring.store(&cert).map_err(|e| e.to_string())?;
    Ok(info)
}

#[tauri::command]
pub async fn encrypt_file(app: tauri::AppHandle, options: EncryptOptions) -> Result<(), String> {
    use sequoia_openpgp::crypto::Password;
    use sequoia_openpgp::policy::StandardPolicy;
    use sequoia_openpgp::serialize::stream::{Encryptor2, LiteralWriter, Message};
    use std::io::Write;

    let policy = &StandardPolicy::new();
    let keyring = open_keyring(&app).map_err(|e| e.to_string())?;

    let recipients: Vec<Cert> = options
        .recipient_fingerprints
        .iter()
        .map(|fp| {
            keyring
                .find(fp)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| format!("key not found: {fp}"))
        })
        .collect::<Result<_, String>>()?;

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

    if recipient_keys.is_empty() && options.passphrase.is_none() {
        return Err("No recipients or passphrase specified".to_string());
    }

    let plaintext = std::fs::read(&options.input_path).map_err(|e| e.to_string())?;
    let mut output = Vec::new();

    let message = Message::new(&mut output);
    let mut encryptor = Encryptor2::for_recipients(message, recipient_keys);
    if let Some(pw) = &options.passphrase {
        encryptor = encryptor.add_passwords([Password::from(pw.as_str())]);
    }
    let message = encryptor.build().map_err(|e| e.to_string())?;
    let mut message = LiteralWriter::new(message)
        .build()
        .map_err(|e| e.to_string())?;
    message.write_all(&plaintext).map_err(|e| e.to_string())?;
    message.finalize().map_err(|e| e.to_string())?;

    std::fs::write(&options.output_path, output).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn decrypt_file(app: tauri::AppHandle, options: DecryptOptions) -> Result<(), String> {
    use sequoia_openpgp::parse::stream::DecryptorBuilder;
    use sequoia_openpgp::policy::StandardPolicy;

    let policy = &StandardPolicy::new();
    let keyring = open_keyring(&app).map_err(|e| e.to_string())?;
    let all_certs = keyring.load_all().map_err(|e| e.to_string())?;
    let ciphertext = std::fs::read(&options.input_path).map_err(|e| e.to_string())?;

    let helper = crate::helpers::KeyringHelper {
        certs: all_certs,
        passphrase: options.passphrase.into(),
    };

    let mut decryptor = DecryptorBuilder::from_bytes(&ciphertext)
        .map_err(|e| e.to_string())?
        .with_policy(policy, None, helper)
        .map_err(|e| e.to_string())?;

    let mut plaintext = Vec::new();
    std::io::copy(&mut decryptor, &mut plaintext).map_err(|e| e.to_string())?;

    std::fs::write(&options.output_path, plaintext).map_err(|e| e.to_string())?;
    Ok(())
}
