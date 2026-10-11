# Feature: Kotlin Bindings for GPG Core via UniFFI

Expose the shared `gpg-core` crate (feature 09) to Kotlin through [UniFFI](https://mozilla.github.io/uniffi-rs/). The feature adds a thin FFI crate that compiles to a native Android shared library (`libgpg_core_ffi.so`) for every supported ABI and generates the matching Kotlin API. The Android app (feature 12+) calls encryption, decryption and key management through this API without writing any JNI by hand.

---

## Motivation

The Android app is a native Kotlin / Jetpack Compose application that must reuse the Rust OpenPGP implementation, so ciphertext and keyrings stay compatible with the desktop app. Calling Rust from Kotlin needs:

- a C-ABI shared library built for Android's CPU architectures,
- Kotlin glue code that loads it and converts types and errors, and
- an I/O contract that fits Android's Storage Access Framework, where user files are reachable only as `content://` URIs and file descriptors, not POSIX paths.

Writing JNI by hand for this is error-prone (memory ownership, exceptions, string encoding). UniFFI generates both sides from annotated Rust and is widely used in production Android apps. Keeping the annotations in a separate crate keeps `gpg-core` free of FFI concerns, so the desktop build (feature 10) is unaffected.

---

## Goals

1. Add `crates/gpg-core-ffi/`, a `cdylib` crate that depends on `gpg-core` and exports a UniFFI API using proc-macros only (no UDL file).
2. Expose a `GpgKeyring` object with: `listKeys`, `importKey`, `generateKey`, `encryptFd`, `decryptFd`, `encryptBytes`, `decryptBytes`.
3. Use file descriptors as the file I/O contract, so Android can pass `ParcelFileDescriptor`s from `ContentResolver` straight to Rust without copying the file into the JVM heap.
4. Map `gpg_core::CoreError` to a typed Kotlin exception hierarchy (`GpgException`) whose messages match the desktop error strings.
5. Build `libgpg_core_ffi.so` for `arm64-v8a`, `armeabi-v7a` and `x86_64` with `cargo-ndk`, with 16 KB page alignment, and with no native dependencies beyond the Android system libraries.
6. Generate the Kotlin bindings from the compiled library with `uniffi-bindgen`, using one script that produces a ready-to-consume `jniLibs/` + Kotlin source tree.

---

## Out of Scope

- The Android app, Gradle project and UI (feature 12 consumes the artifacts produced here).
- Wiring `cargo-ndk` into Gradle (feature 12). This feature provides a standalone build script.
- iOS / Swift bindings (UniFFI supports them, but they are not planned).
- Progress callbacks, cancellation and async (`suspend`) exports. All exported functions are blocking; Kotlin callers run them on `Dispatchers.IO`.
- Android Keystore / biometric protection of passphrases or secret keys.
- Publishing the bindings as a Maven artifact.

---

## Prerequisites

| Requirement         | Notes                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| Feature 09 complete | `crates/gpg-core` with `Keyring`, `encrypt`, `decrypt`, `list_keys`, `import_key`, `generate_key`, `CoreError` |
| Rust targets        | `rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android`                         |
| Android NDK r28+    | r28 links with 16 KB page alignment by default (required for Android 15+ devices); set `ANDROID_NDK_HOME`      |
| `cargo-ndk` ≥ 3.5   | `cargo install cargo-ndk`                                                                                      |
| Host OS             | macOS or Linux. File-descriptor exports use Unix APIs, so this crate is not built on Windows                   |

---

## Current State

- `crates/gpg-core` is a Tauri-free `rlib` with a stream-based API (`encrypt<R: Read, W: Write>`, `decrypt<R: Read, W: Write>`) and a `Keyring::open(dir)` that takes the data directory explicitly.
- `CoreError` `Display` strings are a UI contract: `key not found: <fingerprint>`, `No recipients or passphrase specified`, `no matching secret key found`.
- There is no FFI layer, no Android build, and no Kotlin code in the repository.

---

## Implementation Plan

### 1. Create the FFI crate

```
crates/gpg-core-ffi/
├── Cargo.toml
├── uniffi.toml
├── build-android.sh         # cargo-ndk + bindgen → dist/
└── src/
    ├── lib.rs               # uniffi::setup_scaffolding!(), GpgKeyring object
    ├── error.rs             # GpgError ↔ CoreError
    ├── types.rs             # KeyInfo record
    ├── fd.rs                # raw fd → std::fs::File
    ├── tests.rs
    └── bin/
        └── uniffi-bindgen.rs
```

`crates/gpg-core-ffi/Cargo.toml`:

```toml
[package]
name = "gpg-core-ffi"
version = "0.1.0"
edition = "2021"
rust-version = "1.77.2"
license = "MIT"
publish = false

[lib]
name = "gpg_core_ffi"
crate-type = ["cdylib", "rlib"]   # rlib so Rust unit tests can call the exports

[[bin]]
name = "uniffi-bindgen"
path = "src/bin/uniffi-bindgen.rs"

[dependencies]
gpg-core = { path = "../gpg-core" }
uniffi = { version = "0.28", features = ["cli"] }
thiserror = "1"

[dev-dependencies]
tempfile = "3"

[profile.release]
lto = true
codegen-units = 1
strip = true
opt-level = 3
```

`src/bin/uniffi-bindgen.rs`:

```rust
fn main() {
    uniffi::uniffi_bindgen_main()
}
```

`uniffi.toml`:

```toml
[bindings.kotlin]
package_name = "com.gpglocal.core"
cdylib_name = "gpg_core_ffi"
```

This crate builds standalone (no root workspace, as in feature 09), so its `[profile.release]` applies. `gpg-core` stays an `rlib` with no `uniffi` dependency.

### 2. Records

UniFFI can only derive on types defined in the crate itself, so `KeyInfo` is mirrored in `src/types.rs`:

```rust
#[derive(Debug, Clone, uniffi::Record)]
pub struct KeyInfo {
    pub fingerprint: String,
    pub user_ids: Vec<String>,
    pub has_secret: bool,
    pub created_at: i64, // Unix seconds
}

impl From<gpg_core::KeyInfo> for KeyInfo {
    fn from(k: gpg_core::KeyInfo) -> Self {
        Self {
            fingerprint: k.fingerprint,
            user_ids: k.user_ids,
            has_secret: k.has_secret,
            created_at: k.created_at,
        }
    }
}
```

Generated Kotlin: `data class KeyInfo(val fingerprint: String, val userIds: List<String>, val hasSecret: Boolean, val createdAt: Long)`.

### 3. Errors

`src/error.rs`:

```rust
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum GpgError {
    #[error("key not found: {fingerprint}")]
    KeyNotFound { fingerprint: String },
    #[error("No recipients or passphrase specified")]
    NoRecipientsOrPassphrase,
    #[error("no matching secret key found")]
    NoMatchingSecretKey,
    #[error("{message}")]
    Io { message: String },
    #[error("{message}")]
    OpenPgp { message: String },
}

impl From<gpg_core::CoreError> for GpgError {
    fn from(e: gpg_core::CoreError) -> Self {
        use gpg_core::CoreError as C;
        match e {
            C::KeyNotFound(fingerprint) => Self::KeyNotFound { fingerprint },
            C::NoRecipientsOrPassphrase => Self::NoRecipientsOrPassphrase,
            C::NoMatchingSecretKey => Self::NoMatchingSecretKey,
            C::Io(e) => Self::Io { message: e.to_string() },
            C::OpenPgp(e) => Self::OpenPgp { message: e.to_string() },
        }
    }
}
```

Generated Kotlin: `sealed class GpgException : Exception` with subclasses `KeyNotFound`, `NoRecipientsOrPassphrase`, `NoMatchingSecretKey`, `Io`, `OpenPgp`. The Android UI can branch on the type (e.g. show "Wrong passphrase" for `NoMatchingSecretKey`) and still show `message` verbatim, the same way the desktop app does.

A Rust panic inside an export is caught by UniFFI and surfaces as `InternalException` in Kotlin; it never crashes the process through an unwind across the FFI boundary.

### 4. File-descriptor input/output

`src/fd.rs`:

```rust
use std::fs::File;
use std::os::fd::{FromRawFd, RawFd};

/// Takes ownership of `fd`. The returned File closes it on drop.
pub(crate) fn file_from_owned_fd(fd: i32) -> Result<File, crate::GpgError> {
    if fd < 0 {
        return Err(crate::GpgError::Io { message: format!("invalid file descriptor: {fd}") });
    }
    // SAFETY: the Kotlin caller transfers ownership via ParcelFileDescriptor.detachFd()
    // and must not use or close the fd afterwards.
    Ok(unsafe { File::from_raw_fd(fd as RawFd) })
}
```

**Ownership contract** (documented on each export and in the generated KDoc):

- Kotlin opens `ParcelFileDescriptor`s with `contentResolver.openFileDescriptor(uri, "r")` for input and `"wt"` (write + truncate) for output.
- Kotlin passes `pfd.detachFd()`. Rust becomes the sole owner and closes both fds before returning, on success **and** on error.
- On error, the output document may contain partial data. The caller must discard it (e.g. `DocumentsContract.deleteDocument`). Desktop-style atomic replacement is the platform layer's job (feature 10 on desktop, features 13/14 on Android).

### 5. The exported object

`src/lib.rs`:

```rust
uniffi::setup_scaffolding!();

mod error;
mod fd;
mod types;
#[cfg(test)]
mod tests;

pub use error::GpgError;
pub use types::KeyInfo;

use std::io::{BufReader, BufWriter, Write};

#[derive(uniffi::Object)]
pub struct GpgKeyring {
    inner: gpg_core::Keyring,
}

#[uniffi::export]
impl GpgKeyring {
    /// Opens (creating if needed) `<data_dir>/keyring/`. On Android pass `context.filesDir.absolutePath`.
    #[uniffi::constructor]
    pub fn new(data_dir: String) -> Result<std::sync::Arc<Self>, GpgError> {
        let inner = gpg_core::Keyring::open(data_dir.into())?;
        Ok(std::sync::Arc::new(Self { inner }))
    }

    pub fn list_keys(&self) -> Result<Vec<KeyInfo>, GpgError> {
        Ok(gpg_core::list_keys(&self.inner)?.into_iter().map(Into::into).collect())
    }

    pub fn import_key(&self, armored: String) -> Result<KeyInfo, GpgError> {
        Ok(gpg_core::import_key(&self.inner, &armored)?.into())
    }

    pub fn generate_key(&self, name: String, email: String, passphrase: String) -> Result<KeyInfo, GpgError> {
        Ok(gpg_core::generate_key(&self.inner, &name, &email, &passphrase)?.into())
    }

    /// Encrypts input_fd to output_fd. Takes ownership of both fds.
    pub fn encrypt_fd(
        &self,
        input_fd: i32,
        output_fd: i32,
        recipient_fingerprints: Vec<String>,
        passphrase: Option<String>,
    ) -> Result<(), GpgError> {
        let input = fd::file_from_owned_fd(input_fd)?;
        let output = fd::file_from_owned_fd(output_fd)?;
        let mut reader = BufReader::new(input);
        let mut writer = BufWriter::new(output);
        gpg_core::encrypt(
            &self.inner,
            gpg_core::EncryptParams {
                recipient_fingerprints: &recipient_fingerprints,
                passphrase: passphrase.as_deref(),
            },
            &mut reader,
            &mut writer,
        )?;
        writer.flush().map_err(|e| GpgError::Io { message: e.to_string() })?;
        writer.into_inner().map_err(|e| GpgError::Io { message: e.to_string() })?
            .sync_all().map_err(|e| GpgError::Io { message: e.to_string() })
    }

    /// Decrypts input_fd to output_fd. Takes ownership of both fds.
    pub fn decrypt_fd(&self, input_fd: i32, output_fd: i32, passphrase: String) -> Result<(), GpgError> {
        // same pattern: open both fds first so they are always closed, then gpg_core::decrypt, flush, sync
    }

    /// In-memory variant for small payloads, previews and tests.
    pub fn encrypt_bytes(
        &self,
        plaintext: Vec<u8>,
        recipient_fingerprints: Vec<String>,
        passphrase: Option<String>,
    ) -> Result<Vec<u8>, GpgError> { /* gpg_core::encrypt over &[u8] → Vec<u8> */ }

    pub fn decrypt_bytes(&self, ciphertext: Vec<u8>, passphrase: String) -> Result<Vec<u8>, GpgError> {
        /* gpg_core::decrypt over &[u8] → Vec<u8> */
    }
}
```

Rules:

- Both fds are converted to `File` **before** any other work, so they are closed on every early return (including `KeyNotFound` / `NoRecipientsOrPassphrase`).
- Exact generic bounds on `gpg_core::encrypt` / `decrypt` follow what feature 09 shipped. Adapt the call sites, not the core.
- `GpgKeyring` is `Send + Sync` (it only holds a `PathBuf`). Kotlin may share one instance across coroutines. Concurrent writes to the same key file are not coordinated, the same as on desktop.
- Every export is blocking. Kotlin must call them from `Dispatchers.IO`, never the main thread.
- Passphrases cross the boundary as Kotlin `String`s, which the JVM cannot zeroize. On the Rust side they are converted to `sequoia_openpgp::crypto::Password` inside `gpg-core` and are never logged or put into error messages.

Generated Kotlin surface (for reference, produced by bindgen):

```kotlin
package com.gpglocal.core

class GpgKeyring(dataDir: String) : AutoCloseable {
    fun listKeys(): List<KeyInfo>
    fun importKey(armored: String): KeyInfo
    fun generateKey(name: String, email: String, passphrase: String): KeyInfo
    fun encryptFd(inputFd: Int, outputFd: Int, recipientFingerprints: List<String>, passphrase: String?)
    fun decryptFd(inputFd: Int, outputFd: Int, passphrase: String)
    fun encryptBytes(plaintext: ByteArray, recipientFingerprints: List<String>, passphrase: String?): ByteArray
    fun decryptBytes(ciphertext: ByteArray, passphrase: String): ByteArray
    override fun close()
}
```

All methods throw `GpgException`.

### 6. Build script

`crates/gpg-core-ffi/build-android.sh` produces everything the Android project needs in `crates/gpg-core-ffi/dist/`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

OUT=dist
rm -rf "$OUT"

# 1. Native libraries per ABI (minSdk 26 matches the Android app)
cargo ndk \
  -t arm64-v8a -t armeabi-v7a -t x86_64 \
  --platform 26 \
  -o "$OUT/jniLibs" \
  build --release

# 2. Kotlin bindings from the compiled library's metadata
cargo run --release --bin uniffi-bindgen -- generate \
  --library "$OUT/jniLibs/arm64-v8a/libgpg_core_ffi.so" \
  --language kotlin \
  --config uniffi.toml \
  --out-dir "$OUT/kotlin"
```

Output layout:

```
crates/gpg-core-ffi/dist/
├── jniLibs/
│   ├── arm64-v8a/libgpg_core_ffi.so
│   ├── armeabi-v7a/libgpg_core_ffi.so
│   └── x86_64/libgpg_core_ffi.so
└── kotlin/com/gpglocal/core/gpg_core_ffi.kt
```

`dist/` and `crates/gpg-core-ffi/target/` are build outputs: add both to `.gitignore`. Feature 12 regenerates them from Gradle. Consumers need JNA, which the generated Kotlin uses to load the library: `net.java.dev.jna:jna:5.14.0@aar` (feature 12 adds the dependency).

If NDK r27 or older must be used, add `-C link-arg=-Wl,-z,max-page-size=16384` through `.cargo/config.toml` for the Android targets so the libraries stay 16 KB-aligned.

### 7. Tests

Rust tests in `src/tests.rs` exercise the exported API exactly as Kotlin will call it (no JVM needed):

- `keyring_new_creates_directory`: `GpgKeyring::new(tmp)` creates `<tmp>/keyring/`.
- `generate_then_list_keys`: the generated key appears in `list_keys` with `has_secret == true`.
- `import_key_returns_key_info`: an armored public key from a fixture imports with `has_secret == false`.
- `bytes_symmetric_roundtrip` / `bytes_public_key_roundtrip`.
- `fd_symmetric_roundtrip`: open temp files, pass `into_raw_fd()` values, and assert the output decrypts.
- `fd_wrong_passphrase_maps_to_no_matching_secret_key`: asserts `GpgError::NoMatchingSecretKey` and the message `no matching secret key found`.
- `encrypt_unknown_fingerprint_maps_to_key_not_found`: the message is `key not found: <fp>`.
- `encrypt_without_recipients_or_passphrase_errors`.
- `fds_are_closed_on_error`: after a failing `encrypt_fd`, `fcntl(fd, F_GETFD)` on both raw fds returns `EBADF`.
- `negative_fd_is_rejected`: `encrypt_fd(-1, …)` returns `GpgError::Io`.
- `ciphertext_compatible_with_core`: `encrypt_bytes` output decrypts with `gpg_core::decrypt` directly, and vice versa.

Kotlin-side tests (instrumented, on an emulator) arrive with the Android app in feature 12.

### 8. CI

Extend the `gpg-core` pull-request job from feature 09 with:

```bash
cargo test --manifest-path crates/gpg-core-ffi/Cargo.toml
cargo clippy --manifest-path crates/gpg-core-ffi/Cargo.toml --all-targets -- -D warnings
crates/gpg-core-ffi/build-android.sh            # NDK r28 via nttld/setup-ndk
# Only Android system libs may be linked:
for so in crates/gpg-core-ffi/dist/jniLibs/*/libgpg_core_ffi.so; do
  "$ANDROID_NDK_HOME"/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf -d "$so" \
    | grep NEEDED | grep -vE 'lib(c|m|dl|log)\.so' && exit 1 || true
done
test -f crates/gpg-core-ffi/dist/kotlin/com/gpglocal/core/gpg_core_ffi.kt
```

Upload `dist/` as a workflow artifact so it can be inspected without a local NDK.

### 9. Documentation

- `CLAUDE.md`: add `crates/gpg-core-ffi/` to the Architecture tree and `crates/gpg-core-ffi/build-android.sh` to Commands.
- Add `@specs/features/11-uniffi-bindings.md` to the `CLAUDE.md` spec list.

---

## File Tree After This Feature

```
gpg-local/
├── crates/
│   ├── gpg-core/                 # feature 09, unchanged
│   └── gpg-core-ffi/
│       ├── Cargo.toml
│       ├── uniffi.toml
│       ├── build-android.sh
│       ├── dist/                 # generated, gitignored
│       └── src/
│           ├── lib.rs
│           ├── error.rs
│           ├── types.rs
│           ├── fd.rs
│           ├── tests.rs
│           └── bin/uniffi-bindgen.rs
├── src-tauri/                    # unchanged
└── ...
```

---

## Security Considerations

- **No new crypto code.** The FFI layer only converts types and errors. All OpenPGP behaviour comes from `gpg-core`, which the desktop app already uses.
- **File access stays with the platform.** Rust receives already-opened descriptors chosen by the user through SAF. It never resolves `content://` URIs or user paths, so it cannot reach files the user did not grant. The only path it opens is the keyring under the app's private `filesDir`.
- **fd ownership is explicit.** Rust takes ownership and always closes descriptors, so there are no leaked handles to user documents and no double-close (Kotlin uses `detachFd()`).
- **Passphrases** are JVM `String`s on the Kotlin side and cannot be zeroized there. On the Rust side they become zeroizing `Password`s. They never appear in errors or logs. Hardware-backed protection is a later feature.
- **Panics do not cross the FFI boundary.** UniFFI converts them to `InternalException`.
- **Release libraries are stripped** (`strip = true`) and built with LTO. No debug symbols that would expose internals ship in the APK.

---

## Acceptance Criteria

- [ ] `crates/gpg-core-ffi` builds as a `cdylib`, and `gpg-core` has no `uniffi` dependency.
- [ ] `build-android.sh` produces `libgpg_core_ffi.so` for `arm64-v8a`, `armeabi-v7a` and `x86_64`, plus `gpg_core_ffi.kt` in package `com.gpglocal.core`.
- [ ] Each `.so` links only Android system libraries (`libc`, `libm`, `libdl`, `liblog`) and is 16 KB page-aligned (`llvm-readelf -l` shows `LOAD` alignment `0x4000`).
- [ ] The generated Kotlin exposes `GpgKeyring` with `listKeys`, `importKey`, `generateKey`, `encryptFd`, `decryptFd`, `encryptBytes`, `decryptBytes`, plus the `KeyInfo` data class and the `GpgException` sealed class.
- [ ] Error messages crossing the FFI match the desktop strings exactly.
- [ ] `encryptFd` / `decryptFd` close both descriptors on success and on every error path.
- [ ] Ciphertext from `encrypt_bytes` / `encrypt_fd` decrypts with the desktop app and `gpg --decrypt`, and desktop ciphertext decrypts through `decrypt_fd`.
- [ ] `cargo test` and `cargo clippy -D warnings` pass for `gpg-core-ffi`. Feature 09 and 10 test suites still pass.
- [ ] `src-tauri`, `pnpm test`, `pnpm test:e2e` and `pnpm build:tauri` are unaffected.
