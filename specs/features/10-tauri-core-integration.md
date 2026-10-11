# Feature: Desktop App on Shared GPG Core

Switch the Tauri desktop backend (`src-tauri/`) to the shared `gpg-core` crate from feature 09. Remove the duplicated OpenPGP code so `src-tauri` only contains Tauri plumbing: resolving the keyring directory, opening user file paths, and mapping core errors to strings for the UI. Users and the React frontend see no change.

---

## Motivation

Feature 09 created `crates/gpg-core`, a Tauri-free, stream-based copy of the OpenPGP logic. Until this feature, the desktop app still runs its own copy in `src-tauri/src/{helpers,keyring,commands}.rs`. Two copies of the crypto code will drift: a fix or policy change in one would silently not apply to the other, and desktop and Android could produce or accept different ciphertext.

This feature makes `gpg-core` the only implementation on desktop, so every later Android feature (11+) builds on code the desktop app already exercises in production.

---

## Goals

1. `src-tauri` depends on `gpg-core` through a path dependency and no longer depends on `sequoia-openpgp` directly.
2. Delete `src-tauri/src/helpers.rs` and `src-tauri/src/keyring.rs`. Remove `cert_to_info` and all OpenPGP logic from `commands.rs`.
3. Tauri commands keep their names, argument shapes and return types exactly: `list_keys`, `import_key`, `generate_key`, `encrypt_file`, `decrypt_file`.
4. Error strings returned to the UI stay identical (see Current State).
5. `encrypt_file` / `decrypt_file` write output **atomically**: a failed operation never creates, truncates or overwrites the output file.
6. Blocking crypto and file I/O run off the async runtime thread.
7. All existing tests pass: Rust, `pnpm test`, `pnpm test:e2e`. `pnpm build:tauri` succeeds on macOS, Linux and Windows.

---

## Out of Scope

- Any change to the React frontend, `src/lib/platform.ts`, or the Tauri command contract.
- New commands (e.g. key deletion, export) or UI for key management.
- Progress reporting or cancellation for large files.
- UniFFI bindings and the Android app (feature 11+).
- Changing the release version check or turning the repository into a Cargo workspace.

---

## Prerequisites

| Requirement         | Notes                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Feature 09 complete | `crates/gpg-core` exists, its tests pass, and its public API matches spec 09 |
| Features 02–05      | Desktop commands and the encrypt/decrypt dialogs that call them              |

---

## Current State

```
src-tauri/src/
├── lib.rs        # registers commands + plugins
├── commands.rs   # 5 Tauri commands, open_keyring(AppHandle), cert_to_info, all crypto logic
├── helpers.rs    # KeyringHelper (duplicate of gpg-core)
├── keyring.rs    # Keyring (duplicate of gpg-core)
├── types.rs      # KeyInfo, EncryptOptions, DecryptOptions
└── tests.rs      # crypto tests (duplicated in gpg-core) + serde tests for the types
```

Frontend contract (must not change):

| Command        | Arguments                                                                   | Returns     |
| -------------- | --------------------------------------------------------------------------- | ----------- |
| `list_keys`    | —                                                                           | `KeyInfo[]` |
| `import_key`   | `armored: string`                                                           | `KeyInfo`   |
| `generate_key` | `name`, `email`, `passphrase`                                               | `KeyInfo`   |
| `encrypt_file` | `options: { input_path, output_path, recipient_fingerprints, passphrase? }` | `void`      |
| `decrypt_file` | `options: { input_path, output_path, passphrase }`                          | `void`      |

`KeyInfo` serialises as `{ fingerprint, user_ids, has_secret, created_at }` (snake_case).

The UI shows backend errors verbatim: `EncryptDialog` uses `String(err)`, and `DecryptDialog` wraps it as `Decryption failed. Check your passphrase and try again. (<raw>)`. The raw strings that must not change are `key not found: <fingerprint>`, `No recipients or passphrase specified` and `no matching secret key found`.

Today `encrypt_file` / `decrypt_file` read the whole input into memory and call `std::fs::write` only after the operation succeeds. So a wrong passphrase never touches an existing output file. The streaming core API (feature 09) writes as it goes, so the desktop layer must keep this guarantee explicitly (step 4).

---

## Implementation Plan

### 1. Update `src-tauri/Cargo.toml`

```toml
[dependencies]
gpg-core = { path = "../crates/gpg-core" }
tempfile = "3"          # atomic output files (moved from dev-dependencies)
serde_json = "1.0"
serde = { version = "1.0", features = ["derive"] }
log = "0.4"
tauri = { version = "2.11.2", features = [] }
tauri-plugin-log = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-opener = "2"
# removed: sequoia-openpgp, anyhow
```

Remove `sequoia-openpgp` and `anyhow`. The sequoia feature flags now live only in `crates/gpg-core/Cargo.toml`. Keep `tempfile` once, under `[dependencies]` (it is now runtime code, not only tests).

The `[package] version` in `src-tauri/Cargo.toml` stays the app version checked by `.github/workflows/release.yml`. `gpg-core` keeps its own independent version.

### 2. Slim down `types.rs`

`KeyInfo` now comes from the core. Re-export it so the rest of the crate and the serde tests keep the same import path:

```rust
use serde::{Deserialize, Serialize};

pub use gpg_core::KeyInfo;

#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub recipient_fingerprints: Vec<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DecryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub passphrase: String,
}
```

`EncryptOptions` / `DecryptOptions` stay here: they carry file paths, so they belong to the desktop layer, not the core.

### 3. Rewrite `commands.rs` as thin wrappers

```rust
use gpg_core::{CoreError, EncryptParams, Keyring};
use tauri::Manager;

use crate::fs_io::{open_input, write_atomically};
use crate::types::{DecryptOptions, EncryptOptions, KeyInfo};

fn open_keyring(app: &tauri::AppHandle) -> Result<Keyring, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Keyring::open(data_dir).map_err(|e| e.to_string())
}

fn err(e: CoreError) -> String {
    e.to_string()
}

#[tauri::command]
pub async fn list_keys(app: tauri::AppHandle) -> Result<Vec<KeyInfo>, String> {
    let keyring = open_keyring(&app)?;
    blocking(move || gpg_core::list_keys(&keyring).map_err(err)).await
}

#[tauri::command]
pub async fn import_key(app: tauri::AppHandle, armored: String) -> Result<KeyInfo, String> {
    let keyring = open_keyring(&app)?;
    blocking(move || gpg_core::import_key(&keyring, &armored).map_err(err)).await
}

#[tauri::command]
pub async fn generate_key(
    app: tauri::AppHandle,
    name: String,
    email: String,
    passphrase: String,
) -> Result<KeyInfo, String> {
    let keyring = open_keyring(&app)?;
    blocking(move || gpg_core::generate_key(&keyring, &name, &email, &passphrase).map_err(err))
        .await
}

#[tauri::command]
pub async fn encrypt_file(app: tauri::AppHandle, options: EncryptOptions) -> Result<(), String> {
    let keyring = open_keyring(&app)?;
    blocking(move || {
        let params = EncryptParams {
            recipient_fingerprints: &options.recipient_fingerprints,
            passphrase: options.passphrase.as_deref(),
        };
        let mut input = open_input(&options.input_path)?;
        write_atomically(&options.output_path, |out| {
            gpg_core::encrypt(&keyring, params, &mut input, out).map_err(err)
        })
    })
    .await
}

#[tauri::command]
pub async fn decrypt_file(app: tauri::AppHandle, options: DecryptOptions) -> Result<(), String> {
    let keyring = open_keyring(&app)?;
    blocking(move || {
        let input = open_input(&options.input_path)?;
        write_atomically(&options.output_path, |out| {
            gpg_core::decrypt(&keyring, &options.passphrase, input, out).map_err(err)
        })
    })
    .await
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}
```

Notes:

- The exact `encrypt` / `decrypt` signatures (`&mut R` vs `R`, writer by value vs `&mut`) follow whatever feature 09 shipped. Adjust the call sites, not the core.
- `open_keyring` is the only place that resolves a path from `AppHandle`. The keyring stays at `<app_data_dir>/keyring/`, so existing users' keys load without migration.
- The order of checks must keep today's behaviour: an unknown fingerprint or a missing recipient/passphrase is reported before any output file is created. `gpg_core::encrypt` already validates before reading input (spec 09). Because `write_atomically` only creates a temp file, an early error leaves the output path untouched either way.

### 4. Add `src-tauri/src/fs_io.rs` for path handling and atomic writes

```rust
use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use std::path::Path;

pub fn open_input(path: &str) -> Result<BufReader<File>, String> {
    File::open(path).map(BufReader::new).map_err(|e| e.to_string())
}

/// Runs `op` against a temp file in the output's directory and moves it over
/// `output_path` only if `op` succeeds. On error the temp file is deleted and
/// any existing file at `output_path` is left untouched.
pub fn write_atomically<F>(output_path: &str, op: F) -> Result<(), String>
where
    F: FnOnce(&mut BufWriter<&mut File>) -> Result<(), String>,
{
    let out = Path::new(output_path);
    let dir = out.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut tmp = tempfile::Builder::new()
        .prefix(".gpg-local-")
        .suffix(".tmp")
        .tempfile_in(dir)
        .map_err(|e| e.to_string())?;
    {
        let mut writer = BufWriter::new(tmp.as_file_mut());
        op(&mut writer)?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    tmp.persist(out).map_err(|e| e.error.to_string())?;
    Ok(())
}
```

- The temp file is in the **same directory** as the output, so `persist` is a rename on the same filesystem, and it replaces an existing file on macOS, Linux and Windows. This keeps the silent-overwrite behaviour of specs 04/05 on success.
- If the operation fails (wrong passphrase, I/O error, app crash), the `NamedTempFile` drop removes the temp file, and the previous contents of `output_path` survive. This is stronger than today, where a crash during `std::fs::write` could leave a truncated file.
- The temp file name starts with `.`, so the file list hides it during the operation (hidden files are filtered, spec 03).
- New files get the same permissions `std::fs::write` produced before: `tempfile` creates them `0600` on Unix. Call `set_permissions` to `0644`, the umask-default mode that `std::fs::write` produced, before `persist`. That way decrypted/encrypted files keep their current mode.

### 5. Update `lib.rs`

```rust
mod commands;
mod fs_io;
#[cfg(test)]
mod tests;
mod types;
```

Remove `mod helpers;` and `mod keyring;`. Command registration and plugins are unchanged.

### 6. Delete duplicated code

- Delete `src-tauri/src/helpers.rs` and `src-tauri/src/keyring.rs`.
- From `src-tauri/src/tests.rs`, delete every crypto/keyring/`cert_to_info` test. They now live in `crates/gpg-core/src/tests.rs`. Keep the four serde tests (`key_info_serde_roundtrip`, `encrypt_options_serde_roundtrip`, `encrypt_options_no_passphrase_serde`, `decrypt_options_serde_roundtrip`). They guard the JSON contract with the frontend.

### 7. New desktop-layer tests (`src-tauri/src/tests.rs`)

These test the code that remains in `src-tauri`, without starting Tauri:

- `write_atomically_creates_file_on_success`: output exists with the bytes `op` wrote.
- `write_atomically_leaves_existing_file_on_error`: write `"original"` to the output, run an `op` that returns `Err`, and assert the file still contains `"original"` and no `.gpg-local-*.tmp` remains in the directory.
- `write_atomically_does_not_create_file_on_error`: output path absent before, still absent after a failing `op`.
- `write_atomically_overwrites_existing_on_success`: matches the silent-overwrite rule in specs 04/05.
- `wrong_passphrase_preserves_existing_output`: end-to-end through `fs_io` + `gpg_core`. Encrypt symmetrically to a temp dir, create a plaintext output with `"keep me"`, decrypt with the wrong passphrase, then assert the error string contains `no matching secret key found` and the file still says `"keep me"`.
- `open_input_missing_file_errors`: the error string is the OS "not found" message, as today.

The Tauri command functions themselves stay thin and are covered by the existing Playwright suites (which mock `invoke`) plus the manual desktop checks below.

### 8. Documentation

- `CLAUDE.md` Architecture tree: drop `helpers.rs` / `keyring.rs` under `src-tauri/src/`, add `fs_io.rs`, and note that crypto lives in `crates/gpg-core`.
- Add `@specs/features/10-tauri-core-integration.md` to the `CLAUDE.md` spec list.

---

## File Tree After This Feature

```
gpg-local/
├── crates/
│   └── gpg-core/            # single OpenPGP implementation (feature 09)
└── src-tauri/
    ├── Cargo.toml           # + gpg-core path dep, + tempfile; − sequoia-openpgp, − anyhow
    └── src/
        ├── main.rs          # unchanged
        ├── lib.rs           # − mod helpers, − mod keyring, + mod fs_io
        ├── commands.rs      # thin wrappers over gpg-core
        ├── fs_io.rs         # ← new: open_input, write_atomically
        ├── types.rs         # KeyInfo re-exported from gpg-core; path DTOs stay
        └── tests.rs         # serde tests + fs_io tests only
        # deleted: helpers.rs, keyring.rs
```

---

## Security Considerations

- **One crypto implementation.** Desktop and Android now run the same OpenPGP code, policy and key selection, so a fix in `gpg-core` applies to both.
- **No partial or clobbered output.** Ciphertext and plaintext are written to a temp file and renamed into place only on success. A wrong passphrase or mid-operation failure cannot destroy an existing file at the output path.
- **Temp files and plaintext.** During decryption, plaintext is briefly on disk in a hidden temp file in the target directory: the same directory and the same exposure as the final output. It is deleted on failure. Permissions are set to the same mode as the final file before it becomes visible under its real name.
- **Passphrases** are still passed only in memory, moved into the blocking task, and never logged. `CoreError` messages never include them.
- **Keyring location and format are unchanged**, so no key material is rewritten or migrated.

---

## Acceptance Criteria

- [ ] `src-tauri/Cargo.toml` has no direct `sequoia-openpgp` or `anyhow` dependency; `cargo tree -p gpg-local -i sequoia-openpgp` shows it only through `gpg-core`.
- [ ] `src-tauri/src/helpers.rs` and `src-tauri/src/keyring.rs` no longer exist.
- [ ] The five Tauri commands keep the same names, arguments and JSON return shapes. No file under `src/` changes.
- [ ] The UI shows the same error texts as before for an unknown recipient, a missing recipient/passphrase, and a wrong passphrase.
- [ ] Decrypting with a wrong passphrase does not create, truncate or modify a file at the output path.
- [ ] A successful encrypt/decrypt still silently overwrites an existing output file.
- [ ] No `.gpg-local-*.tmp` files remain after a successful or failed operation.
- [ ] Keys generated or imported before this feature still appear in the key list and decrypt existing files.
- [ ] `.gpg` files created by the previous release decrypt in the new build, and vice versa.
- [ ] The UI stays responsive (window can be moved, tabs switch) while a large file (≥ 500 MB) is encrypted.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` and `cargo test --manifest-path crates/gpg-core/Cargo.toml` pass.
- [ ] All existing `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) suites pass without modification.
- [ ] `pnpm build:tauri` compiles without errors on macOS, Linux and Windows. The release workflow's version check still passes.
