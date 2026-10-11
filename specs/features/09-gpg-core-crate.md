# Feature: Extract Shared GPG Core Crate

Move the OpenPGP logic (keyring, encryption, decryption, key generation/import, decryption helper) from `src-tauri/src/` into a new standalone Rust library crate, `gpg-core`, that has **no dependency on Tauri** and works on byte streams instead of filesystem paths. The crate is the single source of truth for cryptographic behaviour, shared by the desktop app (feature 10) and the Android app (features 11+).

---

## Motivation

The Android version of GPG Local will be a native Kotlin / Jetpack Compose app that calls the existing Rust backend through UniFFI. The current backend cannot be reused as-is:

- Every command takes `tauri::AppHandle` to resolve the keyring directory (`open_keyring` in `commands.rs` calls `app.path().app_data_dir()`).
- `encrypt_file` / `decrypt_file` read and write POSIX paths with `std::fs::read` / `std::fs::write`. On Android, user files arrive as `content://` URIs through the Storage Access Framework and are only accessible as streams or file descriptors from `ContentResolver`.
- Pure OpenPGP logic (`helpers.rs`, `keyring.rs`, `cert_to_info`) is mixed with Tauri command plumbing in the same crate, so it cannot be compiled for Android without pulling in Tauri.

Extracting a Tauri-free, stream-based core crate fixes all three and keeps one tested implementation of the crypto for both platforms.

---

## Goals

1. Create `crates/gpg-core/`, a library crate with no `tauri*` dependencies.
2. Move `KeyringHelper` (`helpers.rs`), `Keyring` (`keyring.rs`), `KeyInfo` (`types.rs`) and `cert_to_info` (`commands.rs`) into it with unchanged behaviour.
3. Expose encryption and decryption as functions over `std::io::Read` / `std::io::Write`, not file paths.
4. `Keyring::open` keeps taking the base data directory explicitly. Callers decide where it lives (desktop: Tauri app-data dir; Android: `Context.filesDir`).
5. Replace stringly-typed errors with a typed `CoreError` enum whose `Display` output exactly matches the error strings the UI shows today.
6. Move the Rust unit tests from `src-tauri/src/tests.rs` into the core crate; they all pass.
7. The crate cross-compiles for `aarch64-linux-android`, `armv7-linux-androideabi` and `x86_64-linux-android`, as well as the existing desktop targets.

---

## Out of Scope

- Changing `src-tauri` to depend on `gpg-core` (feature 10). In this feature `src-tauri` is untouched and keeps its own copy of the code. The duplication goes away in feature 10.
- UniFFI annotations, Kotlin bindings and `cargo-ndk` packaging (feature 11).
- Any change to cryptographic behaviour, algorithms, policy or on-disk keyring format.
- Streaming progress callbacks, cancellation.
- Key revocation / expiry handling (still out of scope as in feature 02).

---

## Prerequisites

| Requirement         | Notes                                                                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Feature 02 complete | `sequoia-openpgp` backend with keyring, encrypt, decrypt                                                                                                                           |
| Feature 04 complete | Symmetric passphrase branch in `encrypt_file`                                                                                                                                      |
| Rust ≥ 1.77.2       | Same `rust-version` as `src-tauri/Cargo.toml`                                                                                                                                      |
| Android targets     | Only for the cross-compile check: `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android` plus the Android NDK (r26+) and `cargo install cargo-ndk` |

---

## Current State

```
src-tauri/src/
├── commands.rs   # Tauri commands + open_keyring(AppHandle) + cert_to_info
├── helpers.rs    # KeyringHelper: DecryptionHelper + VerificationHelper
├── keyring.rs    # Keyring: <dir>/keyring/<FINGERPRINT>.pgp armored TSKs
├── types.rs      # KeyInfo, EncryptOptions, DecryptOptions (serde)
└── tests.rs      # ~30 tests covering keyring, roundtrips, errors, serde
```

Error strings the frontend currently depends on (shown verbatim in dialogs, see feature 05 §6):

| Source                         | Message                                 |
| ------------------------------ | --------------------------------------- |
| `encrypt_file`, unknown key    | `key not found: <fingerprint>`          |
| `encrypt_file`, nothing to use | `No recipients or passphrase specified` |
| `KeyringHelper::decrypt`       | `no matching secret key found`          |

---

## Implementation Plan

### 1. Create the crate

```
crates/gpg-core/
├── Cargo.toml
└── src/
    ├── lib.rs        # public API re-exports
    ├── error.rs      # CoreError
    ├── keyring.rs    # moved from src-tauri (unchanged logic)
    ├── helpers.rs    # moved from src-tauri (unchanged logic)
    ├── info.rs       # KeyInfo + cert_to_info
    ├── ops.rs        # encrypt / decrypt / generate_key / import_key / list_keys
    └── tests.rs      # moved from src-tauri/src/tests.rs, adapted to new API
```

`crates/gpg-core/Cargo.toml`:

```toml
[package]
name = "gpg-core"
version = "0.1.0"
edition = "2021"
rust-version = "1.77.2"
license = "MIT"
publish = false

[lib]
crate-type = ["rlib"]

[dependencies]
sequoia-openpgp = { version = "1", default-features = false, features = [
    "crypto-rust",
    "allow-experimental-crypto",
    "allow-variable-time-crypto",
    "compression",
    "compression-deflate",
    "compression-bzip2",
] }
anyhow = "1"
thiserror = "1"
serde = { version = "1.0", features = ["derive"] }

[dev-dependencies]
tempfile = "3"
```

The `sequoia-openpgp` feature set must be identical to `src-tauri/Cargo.toml`, so both builds produce the same output.

**No root Cargo workspace.** `src-tauri` will reference the crate as a path dependency in feature 10 (`gpg-core = { path = "../crates/gpg-core" }`). That keeps `src-tauri/target/` as the build output dir (spec 01, `.gitignore`), and keeps the release workflow's version check, which greps `src-tauri/Cargo.toml`, working unchanged. `gpg-core` has its own version and is not part of the app's release-version consistency check.

Add `crates/gpg-core/target/` to `.gitignore`.

### 2. Error type

`src/error.rs`:

```rust
#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("key not found: {0}")]
    KeyNotFound(String),
    #[error("No recipients or passphrase specified")]
    NoRecipientsOrPassphrase,
    #[error("no matching secret key found")]
    NoMatchingSecretKey,
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    OpenPgp(#[from] anyhow::Error),
}

pub type Result<T> = std::result::Result<T, CoreError>;
```

The `Display` strings are part of the contract: the desktop UI shows them verbatim. `KeyringHelper::decrypt` must keep returning an error whose message is `no matching secret key found`. Sequoia surfaces it through the `std::io::Error` from the decryptor's `read`, so `ops::decrypt` maps it back to `CoreError::NoMatchingSecretKey` when the inner error matches.

### 3. Public API

`src/lib.rs` re-exports:

```rust
pub use error::{CoreError, Result};
pub use info::{cert_to_info, KeyInfo};
pub use keyring::Keyring;
pub use ops::{decrypt, encrypt, generate_key, import_key, list_keys, EncryptParams};
```

`src/ops.rs`:

```rust
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
) -> Result<()>;

/// Decrypts an OpenPGP message (binary or ASCII-armored) from `input` into `output`.
/// Tries SKESK with `passphrase` first, then PKESK with every secret key in the keyring.
pub fn decrypt<R: Read + Send + Sync, W: Write>(
    keyring: &Keyring,
    passphrase: &str,
    input: R,
    output: &mut W,
) -> Result<()>;

pub fn list_keys(keyring: &Keyring) -> Result<Vec<KeyInfo>>;
pub fn import_key(keyring: &Keyring, armored: &str) -> Result<KeyInfo>;
pub fn generate_key(keyring: &Keyring, name: &str, email: &str, passphrase: &str) -> Result<KeyInfo>;
```

Behaviour rules carried over from `commands.rs` without change:

- `encrypt`: resolve each fingerprint with `Keyring::find`; a missing one gives `KeyNotFound(fp)`. Collect keys via `with_policy(StandardPolicy).supported().alive().revoked(false).for_transport_encryption()`. If there are no keys and no passphrase, return `NoRecipientsOrPassphrase` **before reading any input**. Build `Message -> Encryptor2::for_recipients(..).add_passwords(..) -> LiteralWriter`, then `std::io::copy(input, writer)` and `finalize()`.
- `decrypt`: `DecryptorBuilder::from_reader(input).with_policy(&StandardPolicy::new(), None, KeyringHelper { certs: keyring.load_all()?, passphrase })`, then `std::io::copy(&mut decryptor, output)`.
- `generate_key`: user ID `"{name} <{email}>"`, `CertBuilder` with signing and transport-encryption subkeys, password set. Store it and return `KeyInfo`.
- `import_key`: `Cert::from_bytes`, store, return `KeyInfo`.

Notes:

- Stream input replaces `std::fs::read` of the whole file. Callers pass `File`, a `ParcelFileDescriptor`-backed `File` (Android) or `&[u8]`. The core never opens user file paths itself. The keyring directory is the only filesystem location it touches.
- Sequoia's decryptor buffers the whole plaintext until verification completes, so decryption memory use is unchanged from today. Encryption memory improves (it streams).
- Passphrases stay in memory only: converted to `sequoia_openpgp::crypto::Password` (which zeroizes) and never logged or included in error text.

### 4. Move `KeyInfo` without the path option types

`KeyInfo` (with serde derives) moves to `info.rs` together with `cert_to_info`. `EncryptOptions` / `DecryptOptions` contain file paths, so they are Tauri-command DTOs and **stay in `src-tauri/src/types.rs`**. They are not part of the core.

### 5. Move and adapt tests

Move `src-tauri/src/tests.rs` to `crates/gpg-core/src/tests.rs` (`#[cfg(test)] mod tests;` in `lib.rs`).

- Tests already using `Keyring`, `KeyringHelper` and `cert_to_info` move unchanged.
- File-roundtrip tests (`encrypt_decrypt_roundtrip_files`, `symmetric_encrypt_decrypt_files`) call `ops::encrypt` / `ops::decrypt` with `std::fs::File` handles in a `tempdir`.
- Error tests assert both the variant **and** the `to_string()` text, e.g. `encrypt_to_unknown_fingerprint_gives_clear_error` checks `CoreError::KeyNotFound(_)` and `"key not found: <fp>"`.
- Serde tests for `EncryptOptions` / `DecryptOptions` stay in `src-tauri` (they move with the types in feature 10). Until then, `src-tauri/src/tests.rs` is left as-is.

New tests:

- `encrypt_from_slice_decrypt_to_vec`: `&[u8]` input, `Vec<u8>` output roundtrip (the shape UniFFI will use).
- `encrypt_without_recipients_or_passphrase_reads_nothing`: input reader that panics on `read` is never touched.
- `decrypt_ascii_armored_from_reader`: armored ciphertext through `from_reader`.
- `error_messages_match_ui_contract`: table-driven check of the three `Display` strings above.
- `core_crate_has_no_tauri_dependency`: a `cargo tree` check in CI (§6), not a unit test.

### 6. Verification commands

```bash
# Unit tests
cargo test --manifest-path crates/gpg-core/Cargo.toml

# Lint
cargo clippy --manifest-path crates/gpg-core/Cargo.toml --all-targets -- -D warnings

# No Tauri in the dependency graph (must print nothing)
cargo tree --manifest-path crates/gpg-core/Cargo.toml | grep -i tauri

# Android cross-compile (requires NDK + cargo-ndk)
cd crates/gpg-core && cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 build --release
```

Add a `gpg-core` job to CI (on pull requests) that runs the test, clippy and `cargo tree` checks on `ubuntu-22.04`, plus `cargo ndk build` for `arm64-v8a`.

### 7. Documentation

- `CLAUDE.md`: add `crates/gpg-core/` to the Architecture tree and the `cargo test --manifest-path crates/gpg-core/Cargo.toml` command to Commands.
- Add `@specs/features/09-gpg-core-crate.md` to the `CLAUDE.md` spec list.

---

## File Tree After This Feature

```
gpg-local/
├── crates/
│   └── gpg-core/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs
│           ├── error.rs
│           ├── info.rs
│           ├── keyring.rs
│           ├── helpers.rs
│           ├── ops.rs
│           └── tests.rs
├── src-tauri/          # unchanged in this feature (switched to gpg-core in feature 10)
└── ...
```

---

## Security Considerations

- **No behaviour change.** Same sequoia version, features, `StandardPolicy`, key selection and on-disk keyring format (`<dir>/keyring/<FINGERPRINT>.pgp`, armored TSK). Keys created by the desktop app load in the core and vice versa.
- **Passphrases are never persisted or logged.** They exist only as `&str` arguments and `Password` values, which zeroize on drop. No `CoreError` variant formats a passphrase.
- **The core never opens arbitrary user paths.** Path handling and permission scoping stay with the platform layer (Tauri capabilities on desktop, SAF on Android). That makes the core's file access surface just the keyring directory.
- **Secret keys on disk are unchanged.** They stay protected only by their passphrase and OS file permissions. Android Keystore wrapping is a later feature.

---

## Acceptance Criteria

- [ ] `crates/gpg-core` builds with no `tauri*` crate anywhere in `cargo tree`.
- [ ] Public API exposes `Keyring`, `KeyInfo`, `cert_to_info`, `encrypt`, `decrypt`, `list_keys`, `import_key`, `generate_key`, `CoreError`.
- [ ] `encrypt` / `decrypt` accept `Read` / `Write` and never take a user file path.
- [ ] All tests moved from `src-tauri/src/tests.rs` (except the path-DTO serde tests) pass in `gpg-core`, plus the new tests in §5.
- [ ] Error `Display` strings are exactly `key not found: <fp>`, `No recipients or passphrase specified`, `no matching secret key found`.
- [ ] Ciphertext produced by `gpg-core` decrypts with the current desktop build and with `gpg --decrypt`, and vice versa (symmetric and public-key).
- [ ] A keyring directory created by the desktop app is readable by `gpg-core` with no migration.
- [ ] `cargo ndk` builds the crate for `arm64-v8a`, `armeabi-v7a` and `x86_64` without native C dependencies.
- [ ] `src-tauri`, `pnpm test`, `pnpm test:e2e` and `pnpm build:tauri` are unaffected.
