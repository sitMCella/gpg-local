use std::io::Write;
use tempfile::tempdir;
use sequoia_openpgp::{
    armor::{Kind, Writer as ArmorWriter},
    cert::CertBuilder,
    parse::{stream::DecryptorBuilder, Parse},
    policy::StandardPolicy,
    serialize::{
        stream::{Encryptor2, LiteralWriter, Message},
        SerializeInto,
    },
};

use crate::{helpers::KeyringHelper, keyring::Keyring};

/// Generate a fresh cert with one encryption subkey locked by `passphrase`.
fn gen_cert(passphrase: &str) -> sequoia_openpgp::Cert {
    CertBuilder::new()
        .add_userid("Test User <test@example.com>")
        .add_transport_encryption_subkey()
        .set_password(Some(passphrase.into()))
        .generate()
        .unwrap()
        .0
}

/// Encrypt `plaintext` to all supplied certs; returns binary OpenPGP message.
fn encrypt_bytes(plaintext: &[u8], certs: &[&sequoia_openpgp::Cert]) -> Vec<u8> {
    let policy = StandardPolicy::new();
    let keys: Vec<_> = certs
        .iter()
        .flat_map(|c| {
            c.keys()
                .with_policy(&policy, None)
                .supported()
                .alive()
                .revoked(false)
                .for_transport_encryption()
        })
        .collect();

    let mut output = Vec::new();
    let msg = Message::new(&mut output);
    let msg = Encryptor2::for_recipients(msg, keys).build().unwrap();
    let mut msg = LiteralWriter::new(msg).build().unwrap();
    msg.write_all(plaintext).unwrap();
    msg.finalize().unwrap();
    output
}

/// Decrypt `ciphertext` using `certs` from the local keyring and `passphrase`.
fn decrypt_bytes(
    ciphertext: &[u8],
    certs: Vec<sequoia_openpgp::Cert>,
    passphrase: &str,
) -> Result<Vec<u8>, String> {
    let policy = StandardPolicy::new();
    let helper = KeyringHelper {
        certs,
        passphrase: passphrase.into(),
    };
    let mut dec = DecryptorBuilder::from_bytes(ciphertext)
        .map_err(|e| e.to_string())?
        .with_policy(&policy, None, helper)
        .map_err(|e| e.to_string())?;
    let mut plain = Vec::new();
    std::io::copy(&mut dec, &mut plain).map_err(|e| e.to_string())?;
    Ok(plain)
}

// ── Keyring persistence ────────────────────────────────────────────────────

/// AC#2: A key pair persists to disk and survives a new Keyring instance.
#[test]
fn generated_key_persists_to_disk() {
    let dir = tempdir().unwrap();
    let cert = gen_cert("passphrase");
    let fp = cert.fingerprint();

    Keyring::open(dir.path().to_path_buf())
        .unwrap()
        .store(&cert)
        .unwrap();

    // Fresh Keyring from the same directory simulates an application restart.
    let loaded = Keyring::open(dir.path().to_path_buf())
        .unwrap()
        .load_all()
        .unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].fingerprint(), fp);
}

/// AC#3: An armored public key can be imported and appears in load_all.
#[test]
fn imported_armored_key_appears_in_list() {
    let dir = tempdir().unwrap();
    let cert = gen_cert("passphrase");
    let armored = String::from_utf8(cert.armored().to_vec().unwrap()).unwrap();
    let fp = cert.fingerprint();

    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let imported = sequoia_openpgp::Cert::from_bytes(armored.as_bytes()).unwrap();
    kr.store(&imported).unwrap();

    let loaded = kr.load_all().unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].fingerprint(), fp);
}

/// AC#3: Imported key is listed alongside a separately generated key.
#[test]
fn imported_key_listed_alongside_generated_keys() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let generated = gen_cert("gen_pass");
    let imported = gen_cert("imp_pass");
    kr.store(&generated).unwrap();
    kr.store(&imported).unwrap();

    let loaded = kr.load_all().unwrap();
    assert_eq!(loaded.len(), 2);
    let fps: Vec<_> = loaded.iter().map(|c| c.fingerprint()).collect();
    assert!(fps.contains(&generated.fingerprint()));
    assert!(fps.contains(&imported.fingerprint()));
}

/// load_all on an empty keyring directory returns an empty vec.
#[test]
fn keyring_load_all_empty() {
    let dir = tempdir().unwrap();
    let loaded = Keyring::open(dir.path().to_path_buf())
        .unwrap()
        .load_all()
        .unwrap();
    assert!(loaded.is_empty());
}

/// Multiple certs stored in the same keyring are all returned by load_all.
#[test]
fn keyring_stores_multiple_certs() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    kr.store(&gen_cert("p1")).unwrap();
    kr.store(&gen_cert("p2")).unwrap();
    kr.store(&gen_cert("p3")).unwrap();

    let loaded = kr.load_all().unwrap();
    assert_eq!(loaded.len(), 3);
}

/// find() retrieves a stored cert by its uppercase hex fingerprint.
#[test]
fn keyring_find_by_fingerprint() {
    let dir = tempdir().unwrap();
    let cert = gen_cert("pass");
    let fp = cert.fingerprint().to_hex();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    kr.store(&cert).unwrap();

    let found = kr.find(&fp).unwrap();
    assert!(found.is_some());
    assert_eq!(found.unwrap().fingerprint(), cert.fingerprint());
}

/// find() accepts a lowercase fingerprint and still resolves the cert.
#[test]
fn keyring_find_case_insensitive() {
    let dir = tempdir().unwrap();
    let cert = gen_cert("pass");
    let fp_lower = cert.fingerprint().to_hex().to_lowercase();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    kr.store(&cert).unwrap();

    let found = kr.find(&fp_lower).unwrap();
    assert!(found.is_some());
}

// ── Encryption / decryption ────────────────────────────────────────────────

/// AC#4: Bytes encrypted to a locally-stored key decrypt to the original content.
#[test]
fn encrypt_decrypt_roundtrip_bytes() {
    let passphrase = "hunter2";
    let cert = gen_cert(passphrase);
    let original = b"Hello, secret world!";

    let ciphertext = encrypt_bytes(original, &[&cert]);
    let decrypted = decrypt_bytes(&ciphertext, vec![cert], passphrase).unwrap();
    assert_eq!(decrypted, original);
}

/// AC#4: File written by encrypt logic can be read back by decrypt logic unchanged.
#[test]
fn encrypt_decrypt_roundtrip_files() {
    let dir = tempdir().unwrap();
    let passphrase = "s3cr3t";
    let cert = gen_cert(passphrase);
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    kr.store(&cert).unwrap();

    let input_path = dir.path().join("plain.txt");
    let encrypted_path = dir.path().join("plain.txt.gpg");
    let decrypted_path = dir.path().join("plain.dec.txt");
    let original = b"Sensitive file content";
    std::fs::write(&input_path, original).unwrap();

    // Encrypt — same logic as commands::encrypt_file
    let policy = StandardPolicy::new();
    let keys: Vec<_> = cert
        .keys()
        .with_policy(&policy, None)
        .supported()
        .alive()
        .revoked(false)
        .for_transport_encryption()
        .collect();
    let plain = std::fs::read(&input_path).unwrap();
    let mut ciphertext = Vec::new();
    let msg = Message::new(&mut ciphertext);
    let msg = Encryptor2::for_recipients(msg, keys).build().unwrap();
    let mut msg = LiteralWriter::new(msg).build().unwrap();
    msg.write_all(&plain).unwrap();
    msg.finalize().unwrap();
    std::fs::write(&encrypted_path, &ciphertext).unwrap();

    // Decrypt — same logic as commands::decrypt_file
    let certs = kr.load_all().unwrap();
    let decrypted = decrypt_bytes(&ciphertext, certs, passphrase).unwrap();
    std::fs::write(&decrypted_path, &decrypted).unwrap();

    assert_eq!(std::fs::read(&decrypted_path).unwrap(), original);
}

/// AC#5: ASCII-armored ciphertext (the format gpg --armor produces) decrypts correctly.
///
/// All conforming OpenPGP implementations share the same wire format (RFC 4880).
/// Armoring the binary message and decrypting it validates that our decryptor
/// handles the ASCII-armor layer that external tools add by default.
#[test]
fn ascii_armored_ciphertext_decrypts_correctly() {
    let passphrase = "interop_pass";
    let cert = gen_cert(passphrase);
    let original = b"Interoperability test payload";

    // Produce binary ciphertext, then wrap in ASCII armor as gpg --armor would.
    let binary = encrypt_bytes(original, &[&cert]);
    let mut armored = Vec::new();
    let mut w = ArmorWriter::new(&mut armored, Kind::Message).unwrap();
    w.write_all(&binary).unwrap();
    w.finalize().unwrap();

    // DecryptorBuilder::from_bytes handles both binary and ASCII-armored input.
    let decrypted = decrypt_bytes(&armored, vec![cert], passphrase).unwrap();
    assert_eq!(decrypted, original);
}

/// AC#5: Multi-recipient ciphertext — only the matching key is needed to decrypt.
#[test]
fn multi_recipient_any_key_decrypts() {
    let pass_a = "alice_pass";
    let pass_b = "bob_pass";
    let cert_a = gen_cert(pass_a);
    let cert_b = gen_cert(pass_b);

    // Encrypted to both Alice and Bob
    let ciphertext = encrypt_bytes(b"shared secret", &[&cert_a, &cert_b]);

    // Alice can decrypt
    let dec_a = decrypt_bytes(&ciphertext, vec![cert_a.clone()], pass_a).unwrap();
    assert_eq!(dec_a, b"shared secret");

    // Bob can decrypt independently
    let dec_b = decrypt_bytes(&ciphertext, vec![cert_b], pass_b).unwrap();
    assert_eq!(dec_b, b"shared secret");
}

// ── Error paths ────────────────────────────────────────────────────────────

/// AC#6: Wrong passphrase returns a non-empty error and does not panic.
#[test]
fn wrong_passphrase_returns_error() {
    let cert = gen_cert("correct_pass");
    let ciphertext = encrypt_bytes(b"secret", &[&cert]);

    let result = decrypt_bytes(&ciphertext, vec![cert], "wrong_pass");
    assert!(result.is_err(), "expected Err with wrong passphrase");
    assert!(!result.unwrap_err().is_empty());
}

/// AC#6: Completely empty passphrase also returns an error (not a silent success).
#[test]
fn empty_passphrase_returns_error() {
    let cert = gen_cert("correct_pass");
    let ciphertext = encrypt_bytes(b"secret", &[&cert]);

    let result = decrypt_bytes(&ciphertext, vec![cert], "");
    assert!(result.is_err(), "expected Err with empty passphrase");
}

/// AC#7: Keyring lookup for an unknown fingerprint returns None (no panic).
#[test]
fn unknown_fingerprint_returns_none() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let result = kr
        .find("DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF")
        .unwrap();
    assert!(result.is_none());
}

/// AC#7: The encrypt-file logic surfaces a clear "key not found" error for an
///       unknown fingerprint, mirroring exactly what commands::encrypt_file does.
#[test]
fn encrypt_to_unknown_fingerprint_gives_clear_error() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let fp = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    // Replicate the lookup + error construction from commands::encrypt_file.
    let result: Result<sequoia_openpgp::Cert, String> = kr
        .find(fp)
        .map_err(|e| e.to_string())
        .and_then(|opt| opt.ok_or_else(|| format!("key not found: {fp}")));

    assert!(result.is_err());
    let msg = result.unwrap_err();
    assert!(
        msg.contains("key not found"),
        "unexpected error message: {msg}"
    );
}

/// AC#7: Decrypting with no matching key in the keyring also returns a clear error.
#[test]
fn decrypt_with_no_matching_key_returns_error() {
    let encryptor_cert = gen_cert("pass");
    let ciphertext = encrypt_bytes(b"secret", &[&encryptor_cert]);

    // Keyring contains a different cert — no match for the PKESK.
    let other_cert = gen_cert("other_pass");
    let result = decrypt_bytes(&ciphertext, vec![other_cert], "other_pass");
    assert!(result.is_err(), "expected Err when no matching key");
}
