use sequoia_openpgp::{
    armor::{Kind, Writer as ArmorWriter},
    cert::CertBuilder,
    crypto::Password,
    parse::{stream::DecryptorBuilder, Parse},
    policy::StandardPolicy,
    serialize::{
        stream::{Encryptor2, LiteralWriter, Message},
        SerializeInto,
    },
};
use std::fs::File;
use std::io::{Read, Write};
use tempfile::tempdir;

use crate::{
    cert_to_info, decrypt, encrypt, generate_key, import_key, list_keys, CoreError, EncryptParams,
    KeyInfo, Keyring, KeyringHelper,
};

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

/// AC#4: A file encrypted by `ops::encrypt` decrypts back via `ops::decrypt` unchanged.
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

    let fps = [cert.fingerprint().to_hex()];
    encrypt(
        &kr,
        EncryptParams {
            recipient_fingerprints: &fps,
            passphrase: None,
        },
        &mut File::open(&input_path).unwrap(),
        File::create(&encrypted_path).unwrap(),
    )
    .unwrap();

    decrypt(
        &kr,
        passphrase,
        File::open(&encrypted_path).unwrap(),
        &mut File::create(&decrypted_path).unwrap(),
    )
    .unwrap();

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
    let result = kr.find("DEADBEEFDEADBEEFDEADBEEFDEADBEEFDEADBEEF").unwrap();
    assert!(result.is_none());
}

/// AC#7: `ops::encrypt` surfaces a typed, clearly-worded error for an unknown fingerprint.
#[test]
fn encrypt_to_unknown_fingerprint_gives_clear_error() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let fp = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string();

    let err = encrypt(
        &kr,
        EncryptParams {
            recipient_fingerprints: std::slice::from_ref(&fp),
            passphrase: None,
        },
        &mut &b"plain"[..],
        Vec::new(),
    )
    .unwrap_err();

    assert!(matches!(err, CoreError::KeyNotFound(ref f) if *f == fp));
    assert_eq!(err.to_string(), format!("key not found: {fp}"));
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

// ── Symmetric passphrase encryption ───────────────────────────────────────────

/// Encrypt `plaintext` symmetrically (SKESK, no recipients) and return
/// the binary OpenPGP message. Mirrors the path in `commands::encrypt_file`
/// when `recipient_fingerprints` is empty and `passphrase` is `Some`.
fn encrypt_symmetric(plaintext: &[u8], passphrase: &str) -> Vec<u8> {
    let mut output = Vec::new();
    let msg = Message::new(&mut output);
    let recipients: Vec<sequoia_openpgp::serialize::stream::Recipient<'_>> = vec![];
    let msg = Encryptor2::for_recipients(msg, recipients)
        .add_passwords([Password::from(passphrase)])
        .build()
        .unwrap();
    let mut msg = LiteralWriter::new(msg).build().unwrap();
    msg.write_all(plaintext).unwrap();
    msg.finalize().unwrap();
    output
}

/// Feature 04 core path: symmetric-only encryption round-trips via SKESK.
#[test]
fn symmetric_encrypt_decrypt_roundtrip() {
    let passphrase = "mysecretpass";
    let original = b"Symmetric payload";

    let ciphertext = encrypt_symmetric(original, passphrase);
    // No certs needed for symmetric decryption — the SKESK carries the session key.
    let decrypted = decrypt_bytes(&ciphertext, vec![], passphrase).unwrap();
    assert_eq!(decrypted, original);
}

/// Wrong passphrase for a symmetrically-encrypted message returns an error.
#[test]
fn symmetric_wrong_passphrase_returns_error() {
    let ciphertext = encrypt_symmetric(b"secret", "correct_pass");
    let result = decrypt_bytes(&ciphertext, vec![], "wrong_pass");
    assert!(
        result.is_err(),
        "expected Err with wrong symmetric passphrase"
    );
}

/// Symmetrically-encrypted file round-trips through `ops::encrypt` / `ops::decrypt`.
#[test]
fn symmetric_encrypt_decrypt_files() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let passphrase = "filepassword";
    let original = b"File content encrypted symmetrically";

    let input_path = dir.path().join("plain.txt");
    let encrypted_path = dir.path().join("plain.txt.gpg");
    let decrypted_path = dir.path().join("plain.dec.txt");
    std::fs::write(&input_path, original).unwrap();

    encrypt(
        &kr,
        EncryptParams {
            recipient_fingerprints: &[],
            passphrase: Some(passphrase),
        },
        &mut File::open(&input_path).unwrap(),
        File::create(&encrypted_path).unwrap(),
    )
    .unwrap();

    decrypt(
        &kr,
        passphrase,
        File::open(&encrypted_path).unwrap(),
        &mut File::create(&decrypted_path).unwrap(),
    )
    .unwrap();

    assert_eq!(std::fs::read(&decrypted_path).unwrap(), original);
}

/// Mixed encryption: session key wrapped for both a recipient key and a symmetric
/// passphrase. Both methods must independently decrypt the same message.
#[test]
fn mixed_symmetric_and_recipient_both_decrypt() {
    let passphrase = "shared_pass";
    let cert = gen_cert("key_pass");
    let original = b"Mixed encryption payload";

    // Encrypt to cert AND with symmetric passphrase.
    let policy = StandardPolicy::new();
    let keys: Vec<_> = cert
        .keys()
        .with_policy(&policy, None)
        .supported()
        .alive()
        .revoked(false)
        .for_transport_encryption()
        .collect();

    let mut output = Vec::new();
    let msg = Message::new(&mut output);
    let msg = Encryptor2::for_recipients(msg, keys)
        .add_passwords([Password::from(passphrase)])
        .build()
        .unwrap();
    let mut msg = LiteralWriter::new(msg).build().unwrap();
    msg.write_all(original).unwrap();
    msg.finalize().unwrap();
    let ciphertext = output;

    // Passphrase-only decryption (no certs supplied) succeeds via SKESK.
    let dec_sym = decrypt_bytes(&ciphertext, vec![], passphrase).unwrap();
    assert_eq!(dec_sym, original);

    // Key-based decryption (correct cert + key passphrase) succeeds via PKESK.
    let dec_key = decrypt_bytes(&ciphertext, vec![cert], "key_pass").unwrap();
    assert_eq!(dec_key, original);
}

// ── cert_to_info ──────────────────────────────────────────────────────────────

/// cert_to_info extracts the fingerprint as an uppercase hex string.
#[test]
fn cert_to_info_fingerprint() {
    let cert = gen_cert("pass");
    let info = cert_to_info(&cert);
    assert_eq!(info.fingerprint, cert.fingerprint().to_hex());
    assert!(!info.fingerprint.is_empty());
}

/// cert_to_info includes at least the UID we set and marks the cert as having a secret.
#[test]
fn cert_to_info_user_ids_and_has_secret() {
    let cert = gen_cert("pass");
    let info = cert_to_info(&cert);
    assert!(
        info.user_ids
            .iter()
            .any(|uid| uid.contains("test@example.com")),
        "expected UID to contain test@example.com, got: {:?}",
        info.user_ids
    );
    assert!(
        info.has_secret,
        "generated cert must have secret key material"
    );
}

/// cert_to_info has_secret is false when only the public half is stored.
#[test]
fn cert_to_info_public_only_has_no_secret() {
    let cert = gen_cert("pass");
    // Strip secret key material to get a public-only Cert.
    let public_cert = cert.strip_secret_key_material();
    let info = cert_to_info(&public_cert);
    assert!(
        !info.has_secret,
        "public-only cert must not claim to have a secret"
    );
}

/// cert_to_info returns a non-zero created_at timestamp.
#[test]
fn cert_to_info_created_at_is_positive() {
    let cert = gen_cert("pass");
    let info = cert_to_info(&cert);
    assert!(
        info.created_at > 0,
        "created_at should be a positive Unix timestamp"
    );
}

// ── KeyInfo serde ───────────────────────────────────────────────────────────────

/// KeyInfo serialises to JSON and deserialises back to the same value.
#[test]
fn key_info_serde_roundtrip() {
    let info = KeyInfo {
        fingerprint: "AABBCCDD".to_string(),
        user_ids: vec!["Alice <alice@example.com>".to_string()],
        has_secret: true,
        created_at: 1_700_000_000,
    };
    let json = serde_json::to_string(&info).unwrap();
    let back: KeyInfo = serde_json::from_str(&json).unwrap();
    assert_eq!(back.fingerprint, info.fingerprint);
    assert_eq!(back.user_ids, info.user_ids);
    assert_eq!(back.has_secret, info.has_secret);
    assert_eq!(back.created_at, info.created_at);
}

// ── Keyring idempotency ───────────────────────────────────────────────────────

/// Storing the same cert twice does not create duplicate entries.
#[test]
fn keyring_store_same_cert_is_idempotent() {
    let dir = tempdir().unwrap();
    let cert = gen_cert("pass");
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    kr.store(&cert).unwrap();
    kr.store(&cert).unwrap(); // second store of identical cert
    let loaded = kr.load_all().unwrap();
    assert_eq!(
        loaded.len(),
        1,
        "duplicate store must not create two entries"
    );
}

// ── Stream API (ops) ──────────────────────────────────────────────────────────

/// `&[u8]` in, `Vec<u8>` out — the shape the UniFFI layer will use.
#[test]
fn encrypt_from_slice_decrypt_to_vec() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let cert = gen_cert("key_pass");
    kr.store(&cert).unwrap();
    let original: &[u8] = b"slice payload";

    let fps = [cert.fingerprint().to_hex()];
    let mut ciphertext = Vec::new();
    encrypt(
        &kr,
        EncryptParams {
            recipient_fingerprints: &fps,
            passphrase: None,
        },
        &mut &original[..],
        &mut ciphertext,
    )
    .unwrap();

    let mut plain = Vec::new();
    decrypt(&kr, "key_pass", &ciphertext[..], &mut plain).unwrap();
    assert_eq!(plain, original);
}

/// Mixed recipient + passphrase through `ops::encrypt`: either unlocks the message.
#[test]
fn ops_mixed_recipient_and_passphrase() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let cert = gen_cert("key_pass");
    kr.store(&cert).unwrap();

    let fps = [cert.fingerprint().to_hex()];
    let mut ciphertext = Vec::new();
    encrypt(
        &kr,
        EncryptParams {
            recipient_fingerprints: &fps,
            passphrase: Some("sym_pass"),
        },
        &mut &b"mixed"[..],
        &mut ciphertext,
    )
    .unwrap();

    let mut plain = Vec::new();
    decrypt(&kr, "key_pass", &ciphertext[..], &mut plain).unwrap();
    assert_eq!(plain, b"mixed");

    let empty_dir = tempdir().unwrap();
    let empty_kr = Keyring::open(empty_dir.path().to_path_buf()).unwrap();
    let mut plain = Vec::new();
    decrypt(&empty_kr, "sym_pass", &ciphertext[..], &mut plain).unwrap();
    assert_eq!(plain, b"mixed");
}

struct PanicReader;

impl Read for PanicReader {
    fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
        panic!("input must not be read when there is nothing to encrypt to");
    }
}

/// With neither recipients nor passphrase, `encrypt` fails before touching the input.
#[test]
fn encrypt_without_recipients_or_passphrase_reads_nothing() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();

    let err = encrypt(
        &kr,
        EncryptParams {
            recipient_fingerprints: &[],
            passphrase: None,
        },
        &mut PanicReader,
        Vec::new(),
    )
    .unwrap_err();

    assert!(matches!(err, CoreError::NoRecipientsOrPassphrase));
    assert_eq!(err.to_string(), "No recipients or passphrase specified");
}

/// ASCII-armored ciphertext is accepted through the streaming `from_reader` path.
#[test]
fn decrypt_ascii_armored_from_reader() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let cert = gen_cert("armor_pass");
    kr.store(&cert).unwrap();
    let original = b"armored via reader";

    let binary = encrypt_bytes(original, &[&cert]);
    let mut armored = Vec::new();
    let mut w = ArmorWriter::new(&mut armored, Kind::Message).unwrap();
    w.write_all(&binary).unwrap();
    w.finalize().unwrap();

    let mut plain = Vec::new();
    decrypt(&kr, "armor_pass", std::io::Cursor::new(armored), &mut plain).unwrap();
    assert_eq!(plain, original);
}

/// Wrong passphrase on a public-key message maps to the typed `NoMatchingSecretKey`.
#[test]
fn decrypt_wrong_passphrase_is_no_matching_secret_key() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let cert = gen_cert("right");
    kr.store(&cert).unwrap();
    let ciphertext = encrypt_bytes(b"secret", &[&cert]);

    let err = decrypt(&kr, "wrong", &ciphertext[..], &mut Vec::new()).unwrap_err();
    assert!(
        matches!(err, CoreError::NoMatchingSecretKey),
        "unexpected error: {err:?}"
    );
    assert_eq!(err.to_string(), "no matching secret key found");
    assert!(!err.to_string().contains("wrong"));
}

/// Wrong passphrase on a symmetric message also maps to `NoMatchingSecretKey`.
#[test]
fn decrypt_symmetric_wrong_passphrase_is_no_matching_secret_key() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let ciphertext = encrypt_symmetric(b"secret", "correct_pass");

    let err = decrypt(&kr, "wrong_pass", &ciphertext[..], &mut Vec::new()).unwrap_err();
    assert!(
        matches!(err, CoreError::NoMatchingSecretKey),
        "unexpected error: {err:?}"
    );
}

/// The `Display` strings are shown verbatim by the desktop UI.
#[test]
fn error_messages_match_ui_contract() {
    let cases = [
        (
            CoreError::KeyNotFound("ABCD".to_string()),
            "key not found: ABCD",
        ),
        (
            CoreError::NoRecipientsOrPassphrase,
            "No recipients or passphrase specified",
        ),
        (
            CoreError::NoMatchingSecretKey,
            "no matching secret key found",
        ),
    ];
    for (err, expected) in cases {
        assert_eq!(err.to_string(), expected);
    }
}

/// `generate_key` stores a passphrase-protected key that `list_keys` returns.
#[test]
fn generate_key_is_listed_with_secret() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();

    let info = generate_key(&kr, "Alice", "alice@example.com", "alice_pass").unwrap();
    assert_eq!(info.user_ids, vec!["Alice <alice@example.com>".to_string()]);
    assert!(info.has_secret);

    let keys = list_keys(&kr).unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].fingerprint, info.fingerprint);

    // The generated key is usable end-to-end with its passphrase.
    let fps = [info.fingerprint.clone()];
    let mut ciphertext = Vec::new();
    encrypt(
        &kr,
        EncryptParams {
            recipient_fingerprints: &fps,
            passphrase: None,
        },
        &mut &b"to alice"[..],
        &mut ciphertext,
    )
    .unwrap();
    let mut plain = Vec::new();
    decrypt(&kr, "alice_pass", &ciphertext[..], &mut plain).unwrap();
    assert_eq!(plain, b"to alice");
}

/// `import_key` stores an armored public key and returns its info.
#[test]
fn import_key_stores_public_key() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    let cert = gen_cert("pass");
    let armored = String::from_utf8(cert.armored().to_vec().unwrap()).unwrap();

    let info = import_key(&kr, &armored).unwrap();
    assert_eq!(info.fingerprint, cert.fingerprint().to_hex());
    assert!(!info.has_secret);

    let keys = list_keys(&kr).unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].fingerprint, info.fingerprint);
}

/// Garbage input to `import_key` returns an error, not a panic.
#[test]
fn import_key_rejects_garbage() {
    let dir = tempdir().unwrap();
    let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
    assert!(import_key(&kr, "not a key").is_err());
    assert!(list_keys(&kr).unwrap().is_empty());
}

// ── Interop with the gpg CLI (feature-gated) ──────────────────────────────────

/// Two-way compatibility checks against GnuPG. Enabled with
/// `--features gpg-interop-tests` so a plain `cargo test` does not need `gpg`.
#[cfg(feature = "gpg-interop-tests")]
mod interop {
    use super::*;
    use std::path::Path;
    use std::process::{Command, Stdio};

    const PASSPHRASE: &str = "correct horse battery";
    const PLAINTEXT: &[u8] = b"interop payload\nsecond line\n";

    /// Runs gpg in batch mode against an isolated home directory, feeding
    /// `stdin` and returning stdout. Panics with gpg's stderr on failure.
    fn gpg(home: &Path, args: &[&str], stdin: &[u8]) -> Vec<u8> {
        let mut child = Command::new("gpg")
            .arg("--homedir")
            .arg(home)
            .args(["--batch", "--yes", "--quiet", "--pinentry-mode", "loopback"])
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("gpg must be installed for interop tests");
        child.stdin.take().unwrap().write_all(stdin).unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(
            out.status.success(),
            "gpg {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        out.stdout
    }

    fn gpg_home() -> tempfile::TempDir {
        let home = tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(home.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        home
    }

    fn core_encrypt(kr: &Keyring, recipients: &[String], passphrase: Option<&str>) -> Vec<u8> {
        let mut out = Vec::new();
        encrypt(
            kr,
            EncryptParams {
                recipient_fingerprints: recipients,
                passphrase,
            },
            &mut &PLAINTEXT[..],
            &mut out,
        )
        .unwrap();
        out
    }

    fn core_decrypt(kr: &Keyring, ciphertext: &[u8], passphrase: &str) -> Vec<u8> {
        let mut out = Vec::new();
        decrypt(kr, passphrase, ciphertext, &mut out).unwrap();
        out
    }

    #[test]
    fn interop_gpg_symmetric_decrypts_in_core() {
        let home = gpg_home();
        let dir = tempdir().unwrap();
        let kr = Keyring::open(dir.path().to_path_buf()).unwrap();

        let ciphertext = gpg(
            home.path(),
            &[
                "--symmetric",
                "--cipher-algo",
                "AES256",
                "--passphrase",
                PASSPHRASE,
            ],
            PLAINTEXT,
        );
        assert_eq!(core_decrypt(&kr, &ciphertext, PASSPHRASE), PLAINTEXT);
    }

    #[test]
    fn interop_core_symmetric_decrypts_in_gpg() {
        let home = gpg_home();
        let dir = tempdir().unwrap();
        let kr = Keyring::open(dir.path().to_path_buf()).unwrap();

        let ciphertext = core_encrypt(&kr, &[], Some(PASSPHRASE));
        let plain = gpg(
            home.path(),
            &["--decrypt", "--passphrase", PASSPHRASE],
            &ciphertext,
        );
        assert_eq!(plain, PLAINTEXT);
    }

    #[test]
    fn interop_core_public_key_decrypts_in_gpg() {
        let home = gpg_home();
        let dir = tempdir().unwrap();
        let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
        let info = generate_key(&kr, "Interop", "interop@example.com", PASSPHRASE).unwrap();

        let tsk = kr
            .find(&info.fingerprint)
            .unwrap()
            .unwrap()
            .as_tsk()
            .armored()
            .to_vec()
            .unwrap();
        gpg(home.path(), &["--passphrase", PASSPHRASE, "--import"], &tsk);

        let ciphertext = core_encrypt(&kr, std::slice::from_ref(&info.fingerprint), None);
        let plain = gpg(
            home.path(),
            &["--decrypt", "--passphrase", PASSPHRASE],
            &ciphertext,
        );
        assert_eq!(plain, PLAINTEXT);
    }

    #[test]
    fn interop_gpg_public_key_decrypts_in_core() {
        let home = gpg_home();
        let dir = tempdir().unwrap();
        let kr = Keyring::open(dir.path().to_path_buf()).unwrap();
        let info = generate_key(&kr, "Interop", "interop@example.com", PASSPHRASE).unwrap();

        let public = kr
            .find(&info.fingerprint)
            .unwrap()
            .unwrap()
            .armored()
            .to_vec()
            .unwrap();
        gpg(home.path(), &["--import"], &public);

        let ciphertext = gpg(
            home.path(),
            &[
                "--encrypt",
                "--trust-model",
                "always",
                "--recipient",
                &info.fingerprint,
            ],
            PLAINTEXT,
        );
        assert_eq!(core_decrypt(&kr, &ciphertext, PASSPHRASE), PLAINTEXT);
    }
}
