# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Android-only changes are listed under an `### Android` sub-heading inside the version section, so the release notes cover both the desktop and the Android app.

## [0.1.6] - 2026-10-13

### Android

- **Encrypted files keep the `.gpg` extension** — the "Save as" picker no longer turns `report.md.gpg` into `report.md.gpg.pgp`. Some storage providers appended their own `.pgp` extension because the save request used the `application/pgp-encrypted` type; it now uses a generic binary type, so the suggested name is kept as-is.
- **New app icon** — the launcher icon (standard, round and adaptive) now uses the GPG Local artwork instead of the placeholder.

## [0.1.5] - 2026-10-11

### Changed

- **Shared OpenPGP core** — all encryption, decryption and keyring logic moved from the Tauri backend into the new Tauri-free `gpg-core` crate (`crates/gpg-core`), which the desktop and Android apps now share. Cryptographic behaviour, algorithms, the keyring location (`<app data>/keyring/`) and its on-disk format are unchanged, so existing keys and `.gpg` files keep working without migration. Error messages shown in the dialogs are unchanged.
- **Atomic output files** — encrypting or decrypting now writes to a hidden temporary file in the target folder and renames it into place only on success. A wrong passphrase or any other failure no longer creates, truncates or overwrites an existing output file, and no temporary files are left behind. A successful operation still silently replaces an existing output file.
- **Responsive UI during large operations** — encryption and decryption run off the main thread and stream the input instead of reading the whole file into memory first.

### Android

- **First Android release** — native app for Android 8.0 (API 26) and newer, built with Kotlin and Jetpack Compose on top of the shared `gpg-core` crate through UniFFI bindings. Files encrypted on the desktop decrypt on Android and vice versa, and both interoperate with `gpg --symmetric`.
- **Encrypt files** — pick any file with the system file picker, enter and confirm a passphrase (same validation rules and messages as the desktop app), and save the `.gpg` output with the system "Save as" picker. Files are streamed through file descriptors, so large files do not exhaust memory. A partially written output is deleted on failure.
- **Decrypt files** — pick a `.gpg` / `.pgp` file, enter the passphrase and save the plaintext (suggested name: the input name without `.gpg` / `.pgp`). The success message offers **Open** to view the result in another app. A wrong passphrase clears the field and deletes the partial output.
- **Share sheet and "Open with"** — share any single file to GPG Local from another app, or open `.gpg` files with it: encrypted files open the Decrypt flow, everything else opens the Encrypt flow, with the file already selected. After encrypting, **Share encrypted file** sends the `.gpg` onward in one tap. Decrypted plaintext is only offered to a viewer, never to a share target.
- **Privacy defaults** — no network or storage permissions (files are reached only through the Storage Access Framework), the keyring is excluded from cloud backup and device transfer, screenshots are blocked on passphrase screens, and passphrases are never saved to disk or restored after the app is killed.
- **Signed APK in GitHub Releases** — each release now includes `GPG-Local_<version>_android.apk` and its `.sha256` checksum. The Android version follows the desktop version.

## [0.1.4] - 2026-09-19

### Added

- **Type-ahead selection in file list** — in both Encrypt and Decrypt modes, typing a letter with the file list focused jumps to and selects the first matching file, mirroring OS file-explorer behavior. Repeating the same letter cycles through all matches; typing further letters within 800 ms narrows the match by prefix. Greyed-out (disabled) files are skipped and can never be selected.

## [0.1.3] - 2026-08-11

### Added

- **Open in file explorer from file list** — right-click any non-disabled file or directory row in the file-list panel to reveal it in the OS's native file manager (Finder on macOS, Explorer on Windows, Nautilus on Linux). Available in both Encrypt and Decrypt modes. Directory rows, which previously had no context menu, now show a single "Open in file explorer" item.
- **Platform abstraction for revealing files** — `revealInFileExplorer` in `src/lib/platform.ts` routes through `revealItemInDir` from `tauri-plugin-opener` in Tauri and falls back to a window-global mock for browser-based e2e testing.

### Fixed

- **Open in file explorer now reveals instead of opening** — the sidebar and file-list "Open in file explorer" action now correctly uses `revealItemInDir` (which reveals the item in the OS file manager) instead of `openPath` (which opened files with their default application).

## [0.1.2] - 2026-08-10

### Added

- **Open in file explorer from sidebar** — right-click any folder node in the sidebar tree to reveal it in the OS's native file manager (Finder on macOS, Explorer on Windows, Nautilus on Linux). The item appears above the existing "Reload" entry in the context menu.

### Removed

- **Refresh button in mode tab bar** — removed the Refresh button that sat next to the Encrypt/Decrypt tabs, as it was redundant with the existing reload controls in the sidebar context menu and file-list panel toolbar.

## [0.1.1] - 2026-07-28

### Added

- **Open text file in default application** — right-click any file with a recognized plain-text extension (`.txt`, `.md`, `.markdown`, `.rtf`, `.log`, `.json`, `.csv`, `.tsv`, `.yaml`, `.yml`, `.xml`, `.ini`, `.conf`, `.cfg`, `.toml`) in Encrypt mode to open it with the OS's configured default handler via `tauri-plugin-opener`. The action is read-only and does not invoke any GPG command.
- **Platform abstraction for file opening** — `openFilePath` in `src/lib/platform.ts` routes through `tauri-plugin-opener` in Tauri and falls back to a window-global mock for browser-based e2e testing.

## [0.1.0] - 2026-05-31

### Added

- **Tauri desktop wrapper** — ships as a native binary on macOS, Windows, and Linux using Tauri 2; the React + Vite UI runs inside the OS's native WebView with no Electron overhead.
- **GPG encryption and decryption backend** — pure-Rust OpenPGP implementation via `sequoia-openpgp` (RustCrypto backend); no system `gpg` binary required. Supports key generation, armored key import, key listing, and symmetric passphrase-based file encryption and decryption.
- **File browser dashboard** — two-panel layout with a collapsible folder tree sidebar (lazy-loads directory contents on expand) and a file-list panel showing name, type, and last-modified date. Built with Tailwind CSS v4, Shadcn UI, and Lucide React icons.
- **Resizable sidebar** — drag the divider handle to resize the sidebar between 15 % and 50 % of the window width (absolute cap of 400 px).
- **Header toolbar** — breadcrumb path display with clickable ancestor segments, a Home button, and an Open Folder button that opens a native directory picker to re-root both panels.
- **Encrypt mode** — right-click any file in the file list to open the Encrypt dialog; enter and confirm a passphrase to produce a `.gpg` file in the same directory. Files already ending in `.gpg` or `.pgp` are greyed out and cannot be actioned in this mode.
- **Decrypt mode** — right-click any `.gpg` or `.pgp` file to open the Decrypt dialog; enter the passphrase to restore the original file in the same directory. Non-encrypted files are greyed out in this mode.
- **Encrypt / Decrypt mode tab bar** — toggle between modes via a tab bar below the header toolbar.
- **Refresh controls** — three entry points to reload the current directory: a Refresh button in the tab bar, a Reload item in the sidebar folder-node context menu, and a Reload button in the file-list panel toolbar.
- **Success toasts** — brief notifications after a successful encrypt or decrypt operation showing the source and output file names.
- **Inline error handling** — encryption and decryption errors are surfaced inside the respective dialog without crashing the application.
- **Keyboard navigation** — all panels are navigable without a mouse (Tab, Enter, arrow keys); folder tree supports ArrowRight / ArrowLeft to expand and collapse nodes.
