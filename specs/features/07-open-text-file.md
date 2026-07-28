# Feature: Open Text File in Default Application

Allow the user to open a text file directly in whatever application the operating system has configured as the default handler for text files — without leaving GPG Local, and without any GPG operation taking place. The action is available only in the **Encrypt** tab, on files whose extension identifies them as plain text, via the existing right-click context menu.

---

## Motivation

Features 03–06 let the user browse, encrypt, decrypt, and refresh files, but there is still no way to inspect a plaintext file's contents from within the app before deciding to encrypt it. The most natural affordance is the one every desktop file browser already offers: open the file with the OS default application (TextEdit / Notepad / gedit or whatever the user has associated with `.txt`, `.md`, etc.). This is read-only, requires no new GPG plumbing, and reuses the context-menu infrastructure already built for **Encrypt file** / **Decrypt file** in features 04 and 05.

---

## Goals

1. Add an **Open file** item to the right-click context menu on file rows, but **only** when the active mode is `encrypt` (the `ModeTabBar` `AppMode` value from [ModeTabBar.tsx](src/components/ModeTabBar.tsx)).
2. **Open file** is offered only for rows whose extension identifies a plain-text file (see the extension list in §2 below). Any other file type — including directories, `.gpg`/`.pgp` files, and non-text binary files — does not show the item.
3. Selecting **Open file** asks the OS to open the file's absolute path with its configured default application for that file type, on macOS, Windows, and Linux.
4. The action never reads the file's bytes into the app and never invokes any encrypt/decrypt command — it only hands the path to the OS.
5. If the OS cannot open the file (no default handler registered, path no longer exists, permission denied), the failure is surfaced as a toast rather than crashing the app.

---

## Out of Scope

- Any in-app text preview or editor pane (the file is opened externally, not rendered inside GPG Local).
- Opening `.gpg`/`.pgp` files — those must be decrypted first (feature 05).
- Opening non-text files (images, PDFs, spreadsheets, etc.) — tracked separately if ever pursued.
- Making **Open file** available in decrypt mode. Decrypt mode's context menu is unchanged from feature 05.
- Configuring or overriding which application the OS treats as default — that is entirely OS-level configuration outside the app's control.
- A keyboard shortcut or double-click binding for opening a file (double-click on a file row remains a no-op today; only directories respond to double-click, per [FileList.tsx](src/components/FileList.tsx)).

---

## Prerequisites

| Requirement         | Notes                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Feature 03 complete | `FileList` component and its row-level `ContextMenu` wiring must be in place              |
| Feature 04 complete | `AppMode` (`'encrypt' \| 'decrypt'`) and the encrypt-mode context menu item must exist      |
| Feature 06 complete | Toast plumbing (`@/components/ui/toast`) already used for encrypt/decrypt success/failure |

---

## Current State

- [FileList.tsx](src/components/FileList.tsx) renders a `ContextMenuRoot` per row inside `FileListItem`, with mode-specific content: `mode === 'encrypt'` currently renders a single **Encrypt file** item, `mode === 'decrypt'` renders a single **Decrypt file** item.
- File-type detection today lives in two small extension-sniffing helpers in the same file: `isEncryptedFile` (checks `gpg`/`pgp`) and `fileIcon` (checks `txt`/`md`/`log` for the `FileText` icon, falling back to a generic `File` icon).
- There is no Tauri command or plugin wired up yet for asking the OS to open a path with its default application — `src-tauri/Cargo.toml` currently depends on `tauri-plugin-dialog` and `tauri-plugin-fs` only, and `package.json` depends on `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs` only.

---

## Implementation Plan

### 1. Add the `tauri-plugin-opener` plugin

Tauri 2's dedicated plugin for "open this path/URL with the OS default handler" is `tauri-plugin-opener`. Add it to the Rust crate and the frontend bindings:

```toml
# src-tauri/Cargo.toml
[dependencies]
tauri-plugin-opener = "2"
```

```bash
pnpm add @tauri-apps/plugin-opener
```

Register the plugin in `src-tauri/src/lib.rs` alongside the existing plugins:

```rust
.plugin(tauri_plugin_opener::init())
```

No custom Tauri command is needed — the plugin exposes an `openPath` JS binding that the frontend calls directly.

### 2. Define the text-extension helper

Add a shared helper (co-located in `FileList.tsx`, matching the style of the existing `isEncryptedFile` helper) that recognizes common plain-text extensions:

```ts
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'log',
  'json',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'xml',
  'ini',
  'conf',
  'cfg',
  'toml',
])

function isTextFile(entry: FsEntry): boolean {
  if (entry.isDir) return false
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  return TEXT_EXTENSIONS.has(ext)
}
```

This list is intentionally the same "obviously plain text" set implied by the existing `FileText` icon check (`txt`, `md`, `log`) plus other common text/config formats. It does not attempt content sniffing (no reading of file bytes) — extension-only, consistent with how `isEncryptedFile` already works.

### 3. Extend the context menu in `FileListItem`

Add an `onOpenRequest` callback prop, and render **Open file** above the existing **Encrypt file** item when in encrypt mode and the row is a recognized text file:

```tsx
interface FileListItemProps {
  entry: FsEntry
  disabled: boolean
  mode: AppMode
  onNavigate: (path: string) => void
  onEncryptRequest?: (entry: FsEntry) => void
  onDecryptRequest?: (entry: FsEntry) => void
  onOpenRequest?: (entry: FsEntry) => void // ← new
}
```

```tsx
{
  mode === 'encrypt' && !entry.isDir && (
    <ContextMenuContent>
      {isTextFile(entry) && (
        <ContextMenuItem onClick={() => onOpenRequest?.(entry)}>Open file</ContextMenuItem>
      )}
      <ContextMenuItem onClick={() => onEncryptRequest?.(entry)}>Encrypt file</ContextMenuItem>
    </ContextMenuContent>
  )
}
```

`.gpg`/`.pgp` rows are already excluded because they are `disabled` in encrypt mode (per the existing `isDisabled` check) and disabled rows render without any `ContextMenuRoot` at all — no change needed there. Non-text, non-encrypted files (e.g. `budget.xlsx`) remain selectable and still show **Encrypt file**, just without **Open file** above it.

### 4. Implement the open action in `FileList`

Add a handler in `FileList` that calls the plugin and reports failures via toast:

```ts
import { openPath } from '@tauri-apps/plugin-opener'

async function handleOpenRequest(entry: FsEntry) {
  try {
    await openPath(entry.path)
  } catch (err) {
    toast.add({
      title: `Could not open ${entry.name}`,
      description: String(err),
      timeout: 4000,
    })
  }
}
```

Wire it into the row list:

```tsx
<FileListItem
  key={entry.path}
  entry={entry}
  disabled={isDisabled(entry, mode)}
  mode={mode}
  onNavigate={onNavigate}
  onEncryptRequest={onEncryptRequest}
  onDecryptRequest={setDecryptTarget}
  onOpenRequest={handleOpenRequest}
/>
```

No loading state, dialog, or passphrase prompt is involved — `openPath` is fire-and-forget from the app's perspective; the OS spawns the external application asynchronously and GPG Local does not wait on it or track its lifecycle.

### 5. Update Tauri capabilities

Add the opener plugin's permission to `src-tauri/capabilities/default.json`:

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
    "fs:allow-mkdir",
    "fs:allow-read-dir",
    "fs:scope-home-recursive",
    "opener:allow-open-path"
  ]
}
```

`opener:allow-open-path` scopes the permission to only the "open an arbitrary path with its default handler" capability, not URL opening (`opener:allow-open-url`) or program execution, which this feature does not need.

### 6. Write unit tests

**`src/components/FileList.test.tsx`** (additions)

- In `encrypt` mode, a `.txt` file row's context menu shows both "Open file" and "Encrypt file", with "Open file" listed first.
- In `encrypt` mode, a `.md` file row's context menu shows "Open file".
- In `encrypt` mode, a non-text, non-encrypted file row (e.g. `.xlsx`) shows "Encrypt file" but not "Open file".
- In `encrypt` mode, a `.gpg` file row (disabled) shows no context menu at all — unchanged from feature 04.
- In `decrypt` mode, no row ever shows "Open file", including for `.txt` files (which are disabled in decrypt mode per feature 05) and `.gpg` files (which show only "Decrypt file").
- Clicking "Open file" calls the mocked `@tauri-apps/plugin-opener` `openPath` with the entry's absolute path.
- When `openPath` rejects, a failure toast is shown and no error is thrown to the test harness.

---

## File Tree After This Feature

```
src/
└── components/
    └── FileList.tsx       # + isTextFile helper, Open file context menu item (encrypt mode only), handleOpenRequest
src-tauri/
├── Cargo.toml              # + tauri-plugin-opener dependency
├── capabilities/
│   └── default.json        # + opener:allow-open-path permission
└── src/
    └── lib.rs              # + tauri_plugin_opener::init() registration
package.json                 # + @tauri-apps/plugin-opener dependency
```

No new component files are introduced — all changes are additive edits to `FileList.tsx` and the Tauri plugin/capability wiring.

---

## Visual Layout Reference

### Context menu on right-click (encrypt mode, text file)

```
│ 📄 report.md         MD          Sun      ┌────────────┐│
│                                           │ Open file  ││
│                                           │ Encrypt    ││
│                                           │ file       ││
│                                           └────────────┘│
```

### Context menu on right-click (encrypt mode, non-text file)

```
│ 📄 budget.xlsx       XLSX        2 wk ago ┌────────────┐│
│                                           │ Encrypt    ││
│                                           │ file       ││
│                                           └────────────┘│
```

### Context menu on right-click (decrypt mode — unchanged from feature 05)

```
│ 🔒 report.md.gpg     GPG         Sun      ┌──────────────┐│
│                                           │ Decrypt file ││
│                                           └──────────────┘│
```

---

## Security Considerations

- **No file contents ever pass through the app.** `openPath` only receives the file's path; the OS-level default application reads and renders the bytes, entirely outside GPG Local's process.
- **The action is a pure passthrough to the OS.** GPG Local does not attempt to sandbox, inspect, or restrict what the default application does with the file once opened — this is identical in trust model to double-clicking the file in Finder/Explorer/Nautilus.
- **Restricting to text extensions is a UX affordance, not a security boundary.** A file named `notes.txt` that actually contains different content is still opened — no content sniffing or MIME validation is performed. This mirrors the existing `.gpg`/`.pgp` extension-only detection already used elsewhere in the app (`isEncryptedFile`, `fileIcon`).
- **Encrypted files cannot be opened directly.** Because rows in encrypt mode are only actionable (non-`disabled`) when they are *not* `.gpg`/`.pgp`, there is no path by which this feature exposes ciphertext to a text editor expecting plaintext.

---

## Acceptance Criteria

- [ ] In encrypt mode, right-clicking a file with a recognized text extension (`.txt`, `.md`, `.markdown`, `.log`, `.json`, `.csv`, `.tsv`, `.yaml`, `.yml`, `.xml`, `.ini`, `.conf`, `.cfg`, `.toml`) shows an "Open file" item above "Encrypt file".
- [ ] In encrypt mode, right-clicking a file with a non-text, non-encrypted extension shows only "Encrypt file" — no "Open file" item.
- [ ] In encrypt mode, `.gpg`/`.pgp` rows remain disabled and show no context menu at all, unchanged from feature 04.
- [ ] In decrypt mode, no context menu ever shows "Open file" — the decrypt-mode menu is unchanged from feature 05.
- [ ] Clicking "Open file" launches the file in the OS's configured default application for that file type on macOS, Windows, and Linux.
- [ ] The action does not invoke `encrypt_file`, `decrypt_file`, or any other GPG command.
- [ ] If the OS fails to open the file (missing default handler, deleted file, permission error), a toast reports the failure and the app does not crash.
- [ ] Directories never show "Open file" in their context menu (they have no context menu item added by this feature at all).
- [ ] All existing `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) suites continue to pass.
- [ ] `pnpm build:tauri` compiles without errors on macOS, Linux, and Windows.
