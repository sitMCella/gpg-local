# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
