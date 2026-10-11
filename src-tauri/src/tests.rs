use std::fs;
use std::io::Write;
use std::path::Path;

use gpg_core::{EncryptParams, Keyring};
use tempfile::tempdir;

use crate::fs_io::{open_input, write_atomically};
use crate::types::{DecryptOptions, EncryptOptions, KeyInfo};

fn leftover_temp_files(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(".gpg-local-") && n.ends_with(".tmp"))
        .collect()
}

// ── Types serde ───────────────────────────────────────────────────────────────

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

/// EncryptOptions with an optional passphrase round-trips through JSON.
#[test]
fn encrypt_options_serde_roundtrip() {
    let opts = EncryptOptions {
        input_path: "/tmp/plain.txt".to_string(),
        output_path: "/tmp/plain.txt.gpg".to_string(),
        recipient_fingerprints: vec!["FP1".to_string(), "FP2".to_string()],
        passphrase: Some("hunter2".to_string()),
    };
    let json = serde_json::to_string(&opts).unwrap();
    let back: EncryptOptions = serde_json::from_str(&json).unwrap();
    assert_eq!(back.input_path, opts.input_path);
    assert_eq!(back.output_path, opts.output_path);
    assert_eq!(back.recipient_fingerprints, opts.recipient_fingerprints);
    assert_eq!(back.passphrase, opts.passphrase);
}

/// EncryptOptions with passphrase=None also round-trips correctly.
#[test]
fn encrypt_options_no_passphrase_serde() {
    let opts = EncryptOptions {
        input_path: "/tmp/a".to_string(),
        output_path: "/tmp/a.gpg".to_string(),
        recipient_fingerprints: vec![],
        passphrase: None,
    };
    let json = serde_json::to_string(&opts).unwrap();
    let back: EncryptOptions = serde_json::from_str(&json).unwrap();
    assert!(back.passphrase.is_none());
}

/// DecryptOptions serialises and deserialises correctly.
#[test]
fn decrypt_options_serde_roundtrip() {
    let opts = DecryptOptions {
        input_path: "/tmp/plain.txt.gpg".to_string(),
        output_path: "/tmp/plain.txt".to_string(),
        passphrase: "mypass".to_string(),
    };
    let json = serde_json::to_string(&opts).unwrap();
    let back: DecryptOptions = serde_json::from_str(&json).unwrap();
    assert_eq!(back.input_path, opts.input_path);
    assert_eq!(back.output_path, opts.output_path);
    assert_eq!(back.passphrase, opts.passphrase);
}

// ── fs_io ───────────────────────────────────────────────────────────────────

/// A successful op produces the output file with the bytes it wrote.
#[test]
fn write_atomically_creates_file_on_success() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("out.bin");
    write_atomically(out.to_str().unwrap(), |w| {
        w.write_all(b"hello").map_err(|e| e.to_string())
    })
    .unwrap();
    assert_eq!(fs::read(&out).unwrap(), b"hello");
    assert!(leftover_temp_files(dir.path()).is_empty());
}

/// A failing op leaves an existing output file untouched and cleans up.
#[test]
fn write_atomically_leaves_existing_file_on_error() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("out.txt");
    fs::write(&out, "original").unwrap();
    let res = write_atomically(out.to_str().unwrap(), |w| {
        w.write_all(b"partial").map_err(|e| e.to_string())?;
        Err("boom".to_string())
    });
    assert_eq!(res.unwrap_err(), "boom");
    assert_eq!(fs::read_to_string(&out).unwrap(), "original");
    assert!(leftover_temp_files(dir.path()).is_empty());
}

/// A failing op does not create the output file.
#[test]
fn write_atomically_does_not_create_file_on_error() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("absent.txt");
    let res = write_atomically(out.to_str().unwrap(), |_| Err("boom".to_string()));
    assert!(res.is_err());
    assert!(!out.exists());
    assert!(leftover_temp_files(dir.path()).is_empty());
}

/// A successful op silently overwrites an existing output (specs 04/05).
#[test]
fn write_atomically_overwrites_existing_on_success() {
    let dir = tempdir().unwrap();
    let out = dir.path().join("out.txt");
    fs::write(&out, "old contents that are longer").unwrap();
    write_atomically(out.to_str().unwrap(), |w| {
        w.write_all(b"new").map_err(|e| e.to_string())
    })
    .unwrap();
    assert_eq!(fs::read_to_string(&out).unwrap(), "new");
    assert!(leftover_temp_files(dir.path()).is_empty());
}

/// New output files get the same 0644 mode std::fs::write produced.
#[cfg(unix)]
#[test]
fn write_atomically_sets_default_permissions() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempdir().unwrap();
    let out = dir.path().join("out.txt");
    write_atomically(out.to_str().unwrap(), |w| {
        w.write_all(b"x").map_err(|e| e.to_string())
    })
    .unwrap();
    let mode = fs::metadata(&out).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o644);
}

/// Decrypting with a wrong passphrase reports the UI error string and does
/// not touch an existing file at the output path.
#[test]
fn wrong_passphrase_preserves_existing_output() {
    let dir = tempdir().unwrap();
    let keyring = Keyring::open(dir.path().join("data")).unwrap();

    let plain = dir.path().join("secret.txt");
    fs::write(&plain, "top secret").unwrap();
    let cipher = dir.path().join("secret.txt.gpg");
    let mut input = open_input(plain.to_str().unwrap()).unwrap();
    write_atomically(cipher.to_str().unwrap(), |out| {
        gpg_core::encrypt(
            &keyring,
            EncryptParams {
                recipient_fingerprints: &[],
                passphrase: Some("correct horse"),
            },
            &mut input,
            out,
        )
        .map_err(|e| e.to_string())
    })
    .unwrap();

    let output = dir.path().join("decrypted.txt");
    fs::write(&output, "keep me").unwrap();
    let input = open_input(cipher.to_str().unwrap()).unwrap();
    let err = write_atomically(output.to_str().unwrap(), |out| {
        gpg_core::decrypt(&keyring, "wrong passphrase", input, out).map_err(|e| e.to_string())
    })
    .unwrap_err();

    assert!(
        err.contains("no matching secret key found"),
        "unexpected error: {err}"
    );
    assert_eq!(fs::read_to_string(&output).unwrap(), "keep me");
    assert!(leftover_temp_files(dir.path()).is_empty());

    // Sanity check: the right passphrase still decrypts through the same path.
    let input = open_input(cipher.to_str().unwrap()).unwrap();
    write_atomically(output.to_str().unwrap(), |out| {
        gpg_core::decrypt(&keyring, "correct horse", input, out).map_err(|e| e.to_string())
    })
    .unwrap();
    assert_eq!(fs::read_to_string(&output).unwrap(), "top secret");
}

/// Opening a missing input file returns the OS "not found" message.
#[test]
fn open_input_missing_file_errors() {
    let dir = tempdir().unwrap();
    let missing = dir.path().join("nope.txt");
    let err = open_input(missing.to_str().unwrap()).unwrap_err();
    let os_err = fs::File::open(&missing).unwrap_err();
    assert_eq!(os_err.kind(), std::io::ErrorKind::NotFound);
    assert_eq!(err, os_err.to_string());
}
