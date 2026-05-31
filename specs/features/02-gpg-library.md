# Feature: GPG Encryption / Decryption via sequoia-openpgp

Add file encryption and decryption to the Tauri backend using the pure-Rust [sequoia-openpgp](https://docs.rs/sequoia-openpgp) library. No system `gpg` binary is required — the entire OpenPGP implementation ships inside the application binary.

---

## Motivation

The Tauri wrapper (feature 01) gave us a native window and filesystem access. The next step is the core value of the product: actually encrypting and decrypting files. Using `sequoia-openpgp` instead of spawning the system `gpg` process means:

- **Zero external dependency** — the application works on machines where `gpg` is not installed.
- **Reproducible behaviour** — the OpenPGP implementation is pinned to a specific crate version; system `gpg` versions vary per machine and OS.
- **Single distributable binary** — no need to bundle or install a sidecar.
- **Rust-native error handling** — results propagate cleanly through Tauri commands as typed errors rather than subprocess exit codes.

---

## Goals

1. Expose Tauri commands that the React UI can call to encrypt and decrypt arbitrary files.
2. Manage OpenPGP keys in an application-owned keyring directory (inside the OS app-data folder) — no dependency on the system keyring.
3. Support public-key encryption (encrypt to one or more recipients) and symmetric passphrase-based encryption as a fallback.
4. Support decryption of files encrypted with any key stored in the local keyring, unlocked by passphrase.
5. Support key generation, key import (armored), and key listing.
6. All operations run in a Tauri `async` command so the UI thread is never blocked.

---

## Out of Scope

- Web-of-trust or key signing ceremonies.
- Integration with public keyservers (HKP, WKD).
- Code-signing of the application binary.
- Key revocation and expiry enforcement (tracked separately).
- Compression format negotiation — use the `sequoia-openpgp` defaults.

---

## Prerequisites

| Requirement                    | Notes                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Feature 01 complete            | `src-tauri/` scaffold must exist                                                                                              |
| Rust toolchain (stable ≥ 1.77) | `sequoia-openpgp` requires a recent stable compiler                                                                           |
| `clang` / `llvm` on Linux      | `sequoia-openpgp` links against `nettle` by default on Linux; the `crypto-rust` feature removes this requirement (see step 1) |

### Choosing the crypto backend

`sequoia-openpgp` supports multiple cryptographic backends via Cargo features:

| Backend            | Feature flag     | Notes                                                                                          |
| ------------------ | ---------------- | ---------------------------------------------------------------------------------------------- |
| Nettle (C library) | _(default)_      | Fastest; requires `libnettle-dev` on Linux                                                     |
| RustCrypto         | `crypto-rust`    | Pure Rust; no C deps; slightly slower; recommended for this project to avoid native build deps |
| OpenSSL            | `crypto-openssl` | Requires `libssl-dev`                                                                          |

This feature uses the `crypto-rust` backend so the build has no native library requirements on any platform.

---

## Implementation Plan

### 1. Add `sequoia-openpgp` to `Cargo.toml`

```toml
[dependencies]
sequoia-openpgp = { version = "1", default-features = false, features = [
    "crypto-rust",
    "allow-experimental-crypto",
    "compression",
    "compression-deflate",
    "compression-bzip2",
] }
anyhow = "1"
```

`anyhow` simplifies error propagation inside Tauri commands. The compression features enable reading/writing PGP messages that include compressed literals — common in files produced by other OpenPGP implementations.

### 2. Define the keyring store

Keys are stored as ASCII-armored files in the Tauri app-data directory:

```
<app-data-dir>/
└── keyring/
    ├── <fingerprint-1>.pgp   # each Cert (public + optional secret) as armored text
    ├── <fingerprint-2>.pgp
    └── ...
```

`<app-data-dir>` is resolved at runtime via `tauri::Manager::path().app_data_dir()`. This directory is owned by the OS user and persists across application updates.

Create `src-tauri/src/keyring.rs` with:

```rust
use std::path::PathBuf;
use anyhow::{Context, Result};
use sequoia_openpgp::Cert;
use sequoia_openpgp::parse::Parse;
use sequoia_openpgp::serialize::SerializeInto;

pub struct Keyring {
    dir: PathBuf,
}

impl Keyring {
    pub fn open(app_data_dir: PathBuf) -> Result<Self> {
        let dir = app_data_dir.join("keyring");
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn store(&self, cert: &Cert) -> Result<()> {
        let fp = cert.fingerprint().to_hex();
        let path = self.dir.join(format!("{fp}.pgp"));
        let armored = cert.armored().to_vec()?;
        std::fs::write(&path, armored)?;
        Ok(())
    }

    pub fn load_all(&self) -> Result<Vec<Cert>> {
        let mut certs = Vec::new();
        for entry in std::fs::read_dir(&self.dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) == Some("pgp") {
                let data = std::fs::read(&path)?;
                let cert = Cert::from_bytes(&data)
                    .with_context(|| format!("parsing {}", path.display()))?;
                certs.push(cert);
            }
        }
        Ok(certs)
    }

    pub fn find(&self, fingerprint: &str) -> Result<Option<Cert>> {
        let path = self.dir.join(format!("{}.pgp", fingerprint.to_uppercase()));
        if !path.exists() {
            return Ok(None);
        }
        let data = std::fs::read(path)?;
        Ok(Some(Cert::from_bytes(&data)?))
    }
}
```

### 3. Define shared data types

Create `src-tauri/src/types.rs` with Serde-serializable types returned to the frontend:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeyInfo {
    pub fingerprint: String,
    pub user_ids: Vec<String>,
    pub has_secret: bool,
    pub created_at: i64,   // Unix timestamp (seconds)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub recipient_fingerprints: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DecryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub passphrase: String,
}
```

### 4. Implement the Tauri commands

Create `src-tauri/src/commands.rs`. Each command takes `app: tauri::AppHandle` to resolve the keyring path at runtime.

#### 4a. List keys

```rust
#[tauri::command]
pub async fn list_keys(app: tauri::AppHandle) -> Result<Vec<KeyInfo>, String> {
    let keyring = open_keyring(&app).map_err(|e| e.to_string())?;
    let certs = keyring.load_all().map_err(|e| e.to_string())?;
    Ok(certs.iter().map(cert_to_info).collect())
}
```

#### 4b. Import a key (armored text)

```rust
#[tauri::command]
pub async fn import_key(app: tauri::AppHandle, armored: String) -> Result<KeyInfo, String> {
    let cert = Cert::from_bytes(armored.as_bytes()).map_err(|e| e.to_string())?;
    let info = cert_to_info(&cert);
    let keyring = open_keyring(&app).map_err(|e| e.to_string())?;
    keyring.store(&cert).map_err(|e| e.to_string())?;
    Ok(info)
}
```

#### 4c. Generate a key pair

```rust
#[tauri::command]
pub async fn generate_key(
    app: tauri::AppHandle,
    name: String,
    email: String,
    passphrase: String,
) -> Result<KeyInfo, String> {
    use sequoia_openpgp::cert::CertBuilder;
    use sequoia_openpgp::types::KeyFlags;

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
```

#### 4d. Encrypt a file

The command encrypts `input_path` and writes the result to `output_path`. The output is binary OpenPGP format (`.gpg`). Recipients are identified by their fingerprints stored in the local keyring.

```rust
#[tauri::command]
pub async fn encrypt_file(
    app: tauri::AppHandle,
    options: EncryptOptions,
) -> Result<(), String> {
    use sequoia_openpgp::crypto::SessionKey;
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

    let plaintext = std::fs::read(&options.input_path).map_err(|e| e.to_string())?;
    let mut output = Vec::new();

    let message = Message::new(&mut output);
    let message = Encryptor2::for_recipients(message, recipient_keys)
        .build()
        .map_err(|e| e.to_string())?;
    let mut message = LiteralWriter::new(message)
        .build()
        .map_err(|e| e.to_string())?;
    message.write_all(&plaintext).map_err(|e| e.to_string())?;
    message.finalize().map_err(|e| e.to_string())?;

    std::fs::write(&options.output_path, output).map_err(|e| e.to_string())?;
    Ok(())
}
```

#### 4e. Decrypt a file

```rust
#[tauri::command]
pub async fn decrypt_file(
    app: tauri::AppHandle,
    options: DecryptOptions,
) -> Result<(), String> {
    use sequoia_openpgp::policy::StandardPolicy;
    use sequoia_openpgp::parse::stream::{DecryptionHelper, DecryptorBuilder, MessageStructure, VerificationHelper};
    use sequoia_openpgp::parse::Parse;
    use sequoia_openpgp::KeyHandle;

    let policy = &StandardPolicy::new();
    let keyring = open_keyring(&app).map_err(|e| e.to_string())?;
    let all_certs = keyring.load_all().map_err(|e| e.to_string())?;
    let ciphertext = std::fs::read(&options.input_path).map_err(|e| e.to_string())?;

    let helper = KeyringHelper {
        certs: all_certs,
        passphrase: options.passphrase.clone().into(),
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
```

`KeyringHelper` is a private struct implementing `DecryptionHelper` + `VerificationHelper` — it iterates the local keyring, decrypts the session key using each secret key candidate (trying the supplied passphrase), and returns the session key to the decryptor. See `src-tauri/src/helpers.rs` (step 5).

### 5. Implement `KeyringHelper`

Create `src-tauri/src/helpers.rs`:

```rust
use sequoia_openpgp::{
    crypto::{self, SessionKey},
    parse::stream::{DecryptionHelper, MessageStructure, VerificationHelper},
    policy::Policy,
    Cert, Fingerprint, KeyHandle,
    types::SymmetricAlgorithm,
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
        Ok(()) // signature verification is out of scope for this feature
    }
}

impl DecryptionHelper for KeyringHelper {
    fn decrypt<D>(
        &mut self,
        pkesks: &[sequoia_openpgp::packet::PKESK],
        _skesks: &[sequoia_openpgp::packet::SKESK],
        sym_algo: Option<SymmetricAlgorithm>,
        mut decrypt: D,
    ) -> sequoia_openpgp::Result<Option<Fingerprint>>
    where
        D: FnMut(SymmetricAlgorithm, &SessionKey) -> bool,
    {
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
                        let _ = key.secret_mut().decrypt_in_place(
                            key.pk_algo(),
                            &self.passphrase,
                        );
                    }
                    if let Ok(mut keypair) = key.into_keypair() {
                        if let Ok(Some((algo, sk))) = pkesk.decrypt(&mut keypair, sym_algo) {
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
```

### 6. Register commands in `lib.rs`

```rust
mod commands;
mod helpers;
mod keyring;
mod types;

use commands::{decrypt_file, encrypt_file, generate_key, import_key, list_keys};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_keys,
            import_key,
            generate_key,
            encrypt_file,
            decrypt_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 7. Update Tauri capabilities

Add filesystem read/write permissions for user-chosen files in `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability set",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "dialog:allow-save",
    "fs:allow-read-text-file",
    "fs:allow-write-text-file",
    "fs:allow-read-file",
    "fs:allow-write-file",
    "fs:allow-create-dir",
    "fs:allow-read-dir",
    "path:allow-app-data-dir"
  ]
}
```

Add the required Tauri plugins to `Cargo.toml`:

```toml
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
```

### 8. Add a helper to resolve the keyring from `AppHandle`

In `src-tauri/src/commands.rs`:

```rust
fn open_keyring(app: &tauri::AppHandle) -> anyhow::Result<crate::keyring::Keyring> {
    let data_dir = app.path().app_data_dir()?;
    crate::keyring::Keyring::open(data_dir)
}

fn cert_to_info(cert: &sequoia_openpgp::Cert) -> crate::types::KeyInfo {
    use sequoia_openpgp::policy::StandardPolicy;
    let policy = StandardPolicy::new();
    crate::types::KeyInfo {
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
```

### 9. Call commands from the React UI

Install the Tauri invoke helper (already available via `@tauri-apps/api`):

```ts
import { invoke } from '@tauri-apps/api/core'

// List keys
const keys = await invoke<KeyInfo[]>('list_keys')

// Import an armored key
const info = await invoke<KeyInfo>('import_key', { armored: '-----BEGIN PGP ...' })

// Generate a new key pair
const info = await invoke<KeyInfo>('generate_key', {
  name: 'Alice',
  email: 'alice@example.com',
  passphrase: 's3cr3t',
})

// Encrypt a file
await invoke('encrypt_file', {
  options: {
    input_path: '/path/to/plaintext.txt',
    output_path: '/path/to/plaintext.txt.gpg',
    recipient_fingerprints: ['ABCD1234...'],
  },
})

// Decrypt a file
await invoke('decrypt_file', {
  options: {
    input_path: '/path/to/plaintext.txt.gpg',
    output_path: '/path/to/plaintext.txt',
    passphrase: 's3cr3t',
  },
})
```

Use `@tauri-apps/plugin-dialog` to let the user pick files via the native file-picker rather than typing paths manually.

---

## File Tree After This Feature

```
src-tauri/
└── src/
    ├── main.rs         # unchanged
    ├── lib.rs          # + module declarations + invoke_handler
    ├── commands.rs     # Tauri command functions + open_keyring helper
    ├── helpers.rs      # KeyringHelper (DecryptionHelper + VerificationHelper)
    ├── keyring.rs      # Keyring struct — key persistence in app-data dir
    └── types.rs        # KeyInfo, EncryptOptions, DecryptOptions
```

---

## Security Considerations

- **Passphrases are never written to disk.** They are passed from the UI as a plain string argument to the Tauri command and held in memory only for the duration of the operation.
- **Secret keys are stored in the app-data directory**, which is owned by the OS user account and not readable by other users on most OS configurations. The application does not apply additional encryption to the key store beyond what the OS provides.
- **No passphrase caching.** The UI must supply the passphrase on every decrypt call. If a caching layer is added later it must be in-process only (no disk persistence).
- **File paths are not validated against a scope allowlist** in this initial version — all user-supplied paths are accepted. A follow-up should scope file access to directories the user explicitly grants via the native file dialog.

---

## Acceptance Criteria

- [ ] `pnpm build:tauri` compiles successfully on macOS, Linux, and Windows with no native C library dependencies beyond what Tauri itself requires.
- [ ] A key pair can be generated and appears in the key list after restart (persisted to disk).
- [ ] A public key (armored) can be imported and is listed alongside generated keys.
- [ ] A plaintext file encrypted to a locally-stored key can be decrypted back to the original content.
- [ ] A file encrypted by an external OpenPGP tool (e.g., `gpg`, `age-pgp`) to a key that is in the local keyring can be decrypted correctly.
- [ ] Decryption with a wrong passphrase returns a clear error to the UI without crashing.
- [ ] Encrypting to a fingerprint not present in the keyring returns a clear error.
- [ ] No passphrase or secret-key material appears in Tauri log output.
