# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
