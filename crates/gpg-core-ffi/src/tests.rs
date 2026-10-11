use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{FromRawFd, IntoRawFd, RawFd};
use std::sync::Arc;

use crate::{GpgError, GpgKeyring};

const PASSPHRASE: &str = "correct horse battery";
const PLAINTEXT: &[u8] = b"hello from the android side";

fn keyring() -> (tempfile::TempDir, Arc<GpgKeyring>) {
    let dir = tempfile::tempdir().unwrap();
    let keyring = GpgKeyring::new(dir.path().to_str().unwrap().to_owned()).unwrap();
    (dir, keyring)
}

fn raw_fd(file: File) -> i32 {
    file.into_raw_fd()
}

/// Returns `(read_end, write_end)`.
fn pipe() -> (RawFd, RawFd) {
    let mut fds = [0; 2];
    assert_eq!(unsafe { libc::pipe(fds.as_mut_ptr()) }, 0);
    (fds[0], fds[1])
}

#[test]
fn keyring_new_creates_directory() {
    let (dir, _keyring) = keyring();
    assert!(dir.path().join("keyring").is_dir());
}

#[test]
fn generate_then_list_keys() {
    let (_dir, keyring) = keyring();
    let info = keyring
        .generate_key(
            "Alice".into(),
            "alice@example.com".into(),
            PASSPHRASE.into(),
        )
        .unwrap();
    assert!(info.has_secret);
    assert_eq!(info.user_ids, vec!["Alice <alice@example.com>".to_owned()]);
    assert!(info.created_at > 0);

    let keys = keyring.list_keys().unwrap();
    assert_eq!(keys, vec![info]);
}

#[test]
fn import_key_returns_key_info() {
    use sequoia_openpgp::serialize::SerializeInto;

    let (cert, _) =
        sequoia_openpgp::cert::CertBuilder::general_purpose(None, Some("Bob <bob@example.com>"))
            .generate()
            .unwrap();
    let armored = String::from_utf8(cert.armored().to_vec().unwrap()).unwrap();

    let (_dir, keyring) = keyring();
    let info = keyring.import_key(armored).unwrap();
    assert_eq!(info.fingerprint, cert.fingerprint().to_hex());
    assert!(!info.has_secret);
    assert_eq!(keyring.list_keys().unwrap(), vec![info]);
}

#[test]
fn import_garbage_is_openpgp_error() {
    let (_dir, keyring) = keyring();
    let err = keyring.import_key("not a key".into()).unwrap_err();
    assert!(matches!(err, GpgError::OpenPgp { .. }), "{err:?}");
}

#[test]
fn bytes_symmetric_roundtrip() {
    let (_dir, keyring) = keyring();
    let ciphertext = keyring
        .encrypt_bytes(PLAINTEXT.to_vec(), vec![], Some(PASSPHRASE.into()))
        .unwrap();
    assert_ne!(ciphertext, PLAINTEXT);
    let plaintext = keyring
        .decrypt_bytes(ciphertext, PASSPHRASE.into())
        .unwrap();
    assert_eq!(plaintext, PLAINTEXT);
}

#[test]
fn bytes_public_key_roundtrip() {
    let (_dir, keyring) = keyring();
    let info = keyring
        .generate_key(
            "Alice".into(),
            "alice@example.com".into(),
            PASSPHRASE.into(),
        )
        .unwrap();
    let ciphertext = keyring
        .encrypt_bytes(PLAINTEXT.to_vec(), vec![info.fingerprint], None)
        .unwrap();
    let plaintext = keyring
        .decrypt_bytes(ciphertext, PASSPHRASE.into())
        .unwrap();
    assert_eq!(plaintext, PLAINTEXT);
}

#[test]
fn fd_symmetric_roundtrip() {
    let (dir, keyring) = keyring();
    let plain = dir.path().join("plain.txt");
    let cipher = dir.path().join("plain.txt.gpg");
    let decrypted = dir.path().join("decrypted.txt");
    std::fs::write(&plain, PLAINTEXT).unwrap();

    keyring
        .encrypt_fd(
            raw_fd(File::open(&plain).unwrap()),
            raw_fd(File::create(&cipher).unwrap()),
            vec![],
            Some(PASSPHRASE.into()),
        )
        .unwrap();
    keyring
        .decrypt_fd(
            raw_fd(File::open(&cipher).unwrap()),
            raw_fd(File::create(&decrypted).unwrap()),
            PASSPHRASE.into(),
        )
        .unwrap();

    assert_eq!(std::fs::read(decrypted).unwrap(), PLAINTEXT);
}

#[test]
fn fd_public_key_roundtrip_through_pipes() {
    let (_dir, keyring) = keyring();
    let info = keyring
        .generate_key(
            "Alice".into(),
            "alice@example.com".into(),
            PASSPHRASE.into(),
        )
        .unwrap();

    // Pipe-backed descriptors cannot be fsync'ed; the export must still succeed.
    let (in_read, in_write) = pipe();
    let (out_read, out_write) = pipe();
    let mut feeder = unsafe { File::from_raw_fd(in_write) };
    feeder.write_all(PLAINTEXT).unwrap();
    drop(feeder);

    let collector = std::thread::spawn(move || {
        let mut out = Vec::new();
        unsafe { File::from_raw_fd(out_read) }
            .read_to_end(&mut out)
            .unwrap();
        out
    });
    keyring
        .encrypt_fd(in_read, out_write, vec![info.fingerprint], None)
        .unwrap();
    let ciphertext = collector.join().unwrap();

    let plaintext = keyring
        .decrypt_bytes(ciphertext, PASSPHRASE.into())
        .unwrap();
    assert_eq!(plaintext, PLAINTEXT);
}

#[test]
fn fd_wrong_passphrase_maps_to_no_matching_secret_key() {
    let (dir, keyring) = keyring();
    let cipher = dir.path().join("secret.gpg");
    let ciphertext = keyring
        .encrypt_bytes(PLAINTEXT.to_vec(), vec![], Some(PASSPHRASE.into()))
        .unwrap();
    std::fs::write(&cipher, ciphertext).unwrap();

    let err = keyring
        .decrypt_fd(
            raw_fd(File::open(&cipher).unwrap()),
            raw_fd(File::create(dir.path().join("out")).unwrap()),
            "wrong passphrase".into(),
        )
        .unwrap_err();
    assert!(matches!(err, GpgError::NoMatchingSecretKey), "{err:?}");
    assert_eq!(err.to_string(), "no matching secret key found");
}

#[test]
fn encrypt_unknown_fingerprint_maps_to_key_not_found() {
    let (_dir, keyring) = keyring();
    let fp = "0123456789ABCDEF0123456789ABCDEF01234567".to_owned();
    let err = keyring
        .encrypt_bytes(PLAINTEXT.to_vec(), vec![fp.clone()], None)
        .unwrap_err();
    assert!(matches!(&err, GpgError::KeyNotFound { fingerprint } if *fingerprint == fp));
    assert_eq!(err.to_string(), format!("key not found: {fp}"));
}

#[test]
fn encrypt_without_recipients_or_passphrase_errors() {
    let (_dir, keyring) = keyring();
    let err = keyring
        .encrypt_bytes(PLAINTEXT.to_vec(), vec![], None)
        .unwrap_err();
    assert!(matches!(err, GpgError::NoRecipientsOrPassphrase));
    assert_eq!(err.to_string(), "No recipients or passphrase specified");
}

/// Uses pipes instead of re-probing the raw fd numbers: a closed number can be
/// reused by another test thread, but a closed pipe end is observable from the
/// other end (EPIPE on write, EOF on read) without any race.
#[test]
fn fds_are_closed_on_error() {
    let (_dir, keyring) = keyring();
    let (in_read, in_write) = pipe();
    let (out_read, out_write) = pipe();

    let err = keyring
        .encrypt_fd(in_read, out_write, vec![], None)
        .unwrap_err();
    assert!(matches!(err, GpgError::NoRecipientsOrPassphrase));

    assert_input_closed(in_write);
    assert_output_closed(out_read);
}

#[test]
fn output_fd_is_closed_on_decrypt_error() {
    let (dir, keyring) = keyring();
    let garbage = dir.path().join("garbage.gpg");
    std::fs::write(&garbage, b"definitely not openpgp").unwrap();
    let (out_read, out_write) = pipe();

    assert!(keyring
        .decrypt_fd(
            raw_fd(File::open(&garbage).unwrap()),
            out_write,
            PASSPHRASE.into()
        )
        .is_err());

    assert_output_closed(out_read);
}

#[test]
fn valid_fd_is_closed_when_the_other_is_negative() {
    let (_dir, keyring) = keyring();
    let (in_read, in_write) = pipe();

    let err = keyring
        .encrypt_fd(in_read, -1, vec![], Some(PASSPHRASE.into()))
        .unwrap_err();
    assert!(matches!(err, GpgError::Io { .. }));
    assert_input_closed(in_write);
}

#[test]
fn negative_fd_is_rejected() {
    let (_dir, keyring) = keyring();
    let err = keyring
        .encrypt_fd(-1, -1, vec![], Some(PASSPHRASE.into()))
        .unwrap_err();
    assert!(matches!(err, GpgError::Io { .. }), "{err:?}");
    assert_eq!(err.to_string(), "invalid file descriptor: -1");
}

#[test]
fn ciphertext_compatible_with_core() {
    let (dir, keyring) = keyring();
    let core = gpg_core::Keyring::open(dir.path().to_path_buf()).unwrap();

    // FFI encrypt -> core decrypt
    let ciphertext = keyring
        .encrypt_bytes(PLAINTEXT.to_vec(), vec![], Some(PASSPHRASE.into()))
        .unwrap();
    let mut plaintext = Vec::new();
    gpg_core::decrypt(&core, PASSPHRASE, ciphertext.as_slice(), &mut plaintext).unwrap();
    assert_eq!(plaintext, PLAINTEXT);

    // core encrypt -> FFI decrypt
    let info = gpg_core::generate_key(&core, "Alice", "alice@example.com", PASSPHRASE).unwrap();
    let mut ciphertext = Vec::new();
    gpg_core::encrypt(
        &core,
        gpg_core::EncryptParams {
            recipient_fingerprints: &[info.fingerprint],
            passphrase: None,
        },
        &mut &PLAINTEXT[..],
        &mut ciphertext,
    )
    .unwrap();
    assert_eq!(
        keyring
            .decrypt_bytes(ciphertext, PASSPHRASE.into())
            .unwrap(),
        PLAINTEXT
    );
}

#[test]
fn error_messages_match_core() {
    let cases = [
        gpg_core::CoreError::KeyNotFound("ABCD".into()),
        gpg_core::CoreError::NoRecipientsOrPassphrase,
        gpg_core::CoreError::NoMatchingSecretKey,
        gpg_core::CoreError::Io(std::io::Error::other("disk full")),
    ];
    for core in cases {
        let expected = core.to_string();
        assert_eq!(GpgError::from(core).to_string(), expected);
    }
}

/// Writing to the pipe fails with EPIPE once Rust closed the read end.
fn assert_input_closed(write_end: RawFd) {
    let n = unsafe { libc::write(write_end, b"x".as_ptr().cast(), 1) };
    let errno = std::io::Error::last_os_error().raw_os_error();
    unsafe { libc::close(write_end) };
    assert_eq!(n, -1, "input fd still open");
    assert_eq!(errno, Some(libc::EPIPE));
}

/// Reading hits EOF once Rust closed the write end (and nothing was written).
fn assert_output_closed(read_end: RawFd) {
    let mut buf = [0u8; 16];
    let n = unsafe { libc::read(read_end, buf.as_mut_ptr().cast(), buf.len()) };
    unsafe { libc::close(read_end) };
    assert_eq!(n, 0, "output fd still open");
}
