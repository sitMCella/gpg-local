# Feature: Encrypt File from File Browser

Allow the user to symmetrically encrypt any file visible in the file-list panel using a passphrase. The operation is initiated from a context menu on the file row, confirmed through a passphrase dialog, and produces a `.gpg` file in the same directory as the source file — without removing the original.

---

## Motivation

Features 01–03 delivered the Tauri shell, the GPG backend (sequoia-openpgp), and the file browser dashboard. The first user-facing GPG action is encrypting a file. Symmetric passphrase encryption is the simplest entry point: no key management is required, the workflow mirrors familiar "protect with password" patterns, and it validates the end-to-end pipeline from the UI down through the Tauri command layer established in feature 02.

---

## Goals

1. Add an **Encrypt** tab to the top of the application window. When active it signals "encrypt mode" to the file list.
2. In encrypt mode, files with a `.gpg` or `.pgp` extension are visually greyed out and cannot be selected or actioned — they are already encrypted.
3. Right-clicking any non-greyed file row in the file list opens a context menu with a single relevant action: **Encrypt file**.
4. Clicking **Encrypt file** opens a modal dialog that collects a passphrase and a passphrase confirmation field.
5. On confirmation, invoke the `encrypt_file` Tauri command (feature 02) with a symmetric passphrase. The output path is `<source-path>.gpg` in the same directory.
6. On success, refresh the file list so the new `.gpg` file appears immediately (greyed out).
7. On error, surface a clear inline message inside the dialog without closing it.

---

## Out of Scope

- Public-key (recipient-based) encryption — covered separately.
- Deleting or replacing the original file after encryption.
- Decrypt mode and the corresponding tab (tracked in the next feature).
- Progress indication for large files (tracked separately).
- Keyboard shortcut to invoke encryption without a context menu.

---

## Prerequisites

| Requirement         | Notes                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------- |
| Feature 02 complete | `encrypt_file` Tauri command and the sequoia-openpgp backend must be present                  |
| Feature 03 complete | File browser dashboard, `FileList` component, and Shadcn + Tailwind v4 setup must be in place |

---

## Implementation Plan

### 1. Add a mode tab bar to `App.tsx`

Insert a tab bar directly below the header toolbar and above the resizable panel group. Use the Shadcn `Tabs` component.

```bash
pnpm dlx shadcn@canary add tabs
```

Two tabs are defined now; a third (`Decrypt`) will be added in feature 05:

| Tab label | Value     | Description                                       |
| --------- | --------- | ------------------------------------------------- |
| Encrypt   | `encrypt` | Encrypt mode — `.gpg`/`.pgp` files are greyed out |
| (Decrypt) | `decrypt` | Placeholder, added in the next feature            |

The active tab is stored in top-level App state:

```ts
const [mode, setMode] = useState<'encrypt' | 'decrypt'>('encrypt')
```

The `mode` value is passed as a prop to `FileList`:

```tsx
<FileList dirPath={selectedPath} mode={mode} onNavigate={setSelectedPath} />
```

Visual spec for the tab bar:

```
┌─────────────────────────────────────────────────────────┐
│ [⌂] [📂]  │  home  /  Documents  /  Projects           │ ← header
├─────────────────────────────────────────────────────────┤
│  [ Encrypt ]   Decrypt                                  │ ← tab bar (40 px)
├──────────────┬──────────────────────────────────────────┤
│  sidebar     │  file list                               │
```

The active tab uses a 3 px bottom-border underline (not a filled pill) for a lightweight but clearly visible indicator. Active tab text is rendered at `text-sm font-semibold` and full foreground color; inactive tabs are `text-sm font-medium` at muted foreground. The tab bar height is 40 px (`h-10`) to give the larger text comfortable vertical padding.

### 2. Extend `FileList` props and filtering

Update `FileListProps`:

```ts
interface FileListProps {
  dirPath: string | null
  mode: 'encrypt' | 'decrypt'
  onNavigate: (path: string) => void
}
```

Add a helper that determines whether a file row is disabled in the current mode:

```ts
function isDisabled(entry: FsEntry, mode: 'encrypt' | 'decrypt'): boolean {
  if (mode === 'encrypt') {
    const ext = entry.name.split('.').pop()?.toLowerCase()
    return ext === 'gpg' || ext === 'pgp'
  }
  return false // decrypt-mode filtering added in feature 05
}
```

Apply the disabled state in the row renderer:

- `opacity-40` + `cursor-not-allowed` Tailwind classes on the row element.
- The row does not respond to right-click or keyboard selection when disabled.
- The `Lock` icon (already used for `.gpg` files per feature 03) is retained; no additional icon is needed.

### 3. Add a context menu to file rows

Use the Shadcn `ContextMenu` component to wrap each file-list row:

```bash
pnpm dlx shadcn@canary add context-menu
```

The context menu is only rendered when the row is **not** disabled. Structure:

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <FileListRow entry={entry} disabled={disabled} />
  </ContextMenuTrigger>
  {!disabled && (
    <ContextMenuContent>
      <ContextMenuItem onSelect={() => onEncryptRequest(entry)}>Encrypt file</ContextMenuItem>
    </ContextMenuContent>
  )}
</ContextMenu>
```

`onEncryptRequest` lifts the selected entry up to a piece of state in `FileList` (or `App`) that controls the encrypt dialog's visibility:

```ts
const [encryptTarget, setEncryptTarget] = useState<FsEntry | null>(null)
```

### 4. Build the `EncryptDialog` component

Create `src/components/EncryptDialog.tsx`.

The dialog is a controlled modal built on Shadcn `Dialog`. It is shown when `encryptTarget` is non-null and closed on cancel or successful encryption.

```ts
interface EncryptDialogProps {
  target: FsEntry | null // null = closed
  onClose: () => void
  onSuccess: (outputPath: string) => void
}
```

Internal state:

```ts
const [passphrase, setPassphrase] = useState('')
const [confirm, setConfirm] = useState('')
const [error, setError] = useState<string | null>(null)
const [loading, setLoading] = useState(false)
```

Layout:

```
┌──────────────────────────────────────────┐
│  Encrypt file                       [✕]  │
│                                          │
│  File: report.md                         │
│  Output: report.md.gpg                   │
│                                          │
│  Passphrase                              │
│  [••••••••••••••••••••••••••]  [👁]      │
│                                          │
│  Confirm passphrase                      │
│  [••••••••••••••••••••••••••]  [👁]      │
│                                          │
│  ⚠  Passphrases do not match.            │  ← inline error, only when present
│                                          │
│  ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │  ← indeterminate progress bar (loading only)
│  Encrypting file, please wait…           │  ← status text (loading only)
│                                          │
│               [Cancel]  [Encrypt]        │
└──────────────────────────────────────────┘
```

Validation rules (client-side, evaluated on submit):

| Condition                        | Error message                               |
| -------------------------------- | ------------------------------------------- |
| Passphrase is empty              | "Passphrase must not be empty."             |
| Passphrase length < 8 characters | "Passphrase must be at least 8 characters." |
| Passphrase ≠ confirm             | "Passphrases do not match."                 |

Each field has a toggle button (`Eye` / `EyeOff` Lucide icons) to reveal the passphrase in plain text. Both fields default to `type="password"`. The toggle buttons are excluded from the tab order (`tabIndex={-1}`).

While `loading` is true, the **Encrypt** and **Cancel** buttons are disabled and an indeterminate progress bar appears above the footer together with the status text "Encrypting file, please wait…". The Encrypt button label does not change. The progress bar is an animated sliding fill (`animate-indeterminate`, defined in `index.css`) because no real progress percentage is available from the one-shot Tauri command.

### 5. Invoke the Tauri command

When the user submits the dialog with valid input:

```ts
import { invoke } from '@tauri-apps/api/core'

async function handleEncrypt() {
  setError(null)
  setLoading(true)
  try {
    const outputPath = `${target.path}.gpg`
    await invoke('encrypt_file', {
      options: {
        input_path: target.path,
        output_path: outputPath,
        passphrase, // symmetric encryption
        recipient_fingerprints: [], // empty = symmetric-only
      },
    })
    onSuccess(outputPath)
  } catch (err) {
    setError(String(err))
  } finally {
    setLoading(false)
  }
}
```

The `encrypt_file` command from feature 02 must be extended (or a parallel `encrypt_file_symmetric` command added) to accept an optional `passphrase` field for symmetric encryption. See the backend note in §6 below.

On success, `onSuccess` is called with the output path, which:

1. Closes the dialog (sets `encryptTarget` to `null`).
2. Triggers a directory refresh in `FileList` so the new `.gpg` file appears.
3. Displays a brief success toast.

Add the Shadcn `Toast` / `Sonner` component for the success notification:

```bash
pnpm dlx shadcn@canary add sonner
```

Success toast message: **"report.md encrypted → report.md.gpg"**

### 6. Extend the Tauri `encrypt_file` command for symmetric encryption

Update `EncryptOptions` in `src-tauri/src/types.rs` to include an optional passphrase:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptOptions {
    pub input_path: String,
    pub output_path: String,
    pub recipient_fingerprints: Vec<String>,
    pub passphrase: Option<String>,   // Some(...) = add symmetric layer
}
```

In `src-tauri/src/commands.rs`, when `passphrase` is `Some`, add a `Password` to the `Encryptor2` builder alongside (or instead of) recipient keys:

```rust
use sequoia_openpgp::crypto::Password;

let mut encryptor = Encryptor2::for_recipients(message, recipient_keys);
if let Some(pw) = &options.passphrase {
    encryptor = encryptor.add_passwords([Password::from(pw.as_str())]);
}
let message = encryptor.build().map_err(|e| e.to_string())?;
```

When `recipient_fingerprints` is empty and `passphrase` is `Some`, the message is encrypted symmetrically only. When both are provided, the session key is wrapped for both recipients and the passphrase — either can decrypt.

### 7. Update Tauri capabilities

No new permissions are required beyond those added in features 02 and 03 (`fs:allow-read-file`, `fs:allow-write-file`).

### 8. Write unit tests

**`src/components/EncryptDialog.test.tsx`**

- Renders correctly when `target` is non-null (file name and computed output path are displayed).
- Shows "Passphrase must not be empty." error when the form is submitted with a blank passphrase.
- Shows "Passphrase must be at least 8 characters." when passphrase is fewer than 8 chars.
- Shows "Passphrases do not match." when the two fields differ.
- While loading, the Encrypt and Cancel buttons are disabled, an indeterminate progress bar is visible, and the status text "Encrypting file, please wait…" is shown. The Encrypt button label does not change.
- Toggles passphrase visibility when the eye icon is clicked.
- Calls `onClose` when Cancel is clicked.

**`src/components/FileList.test.tsx`** (additions)

- In `encrypt` mode, a `.gpg` file row has `cursor-not-allowed` class.
- In `encrypt` mode, a `.gpg` file row does not fire `onEncryptRequest` on right-click.
- In `encrypt` mode, a non-`.gpg` file row renders a context menu trigger.

**`src/components/ModeTabBar.test.tsx`**

- Renders two tabs: "Encrypt" and "Decrypt".
- Clicking a tab calls `onModeChange` with the corresponding value.
- The active tab has the expected aria-selected attribute.

---

## File Tree After This Feature

```
src/
├── App.tsx                        # + mode state, tab bar, encryptTarget state
├── components/
│   ├── EncryptDialog.tsx          # ← new: passphrase modal
│   ├── ModeTabBar.tsx             # ← new: Encrypt / Decrypt tab bar
│   ├── FileList.tsx               # + mode prop, disabled row logic, context menu
│   └── ui/
│       ├── tabs.tsx               # Shadcn Tabs (new)
│       ├── context-menu.tsx       # Shadcn ContextMenu (new)
│       └── sonner.tsx             # Shadcn Sonner toast (new)
src-tauri/
└── src/
    ├── types.rs                   # EncryptOptions + passphrase field
    └── commands.rs                # encrypt_file + symmetric passphrase branch
```

---

## Visual Layout Reference

### Mode tab bar (encrypt mode active)

```
┌─────────────────────────────────────────────────────────┐
│ [⌂] [📂]  │  home  /  Documents                        │
├─────────────────────────────────────────────────────────┤
│  ▸ ENCRYPT ▂▂▂   Decrypt                               │  ← 40 px tall; active: bold + 3 px underline
├──────────────┬──────────────────────────────────────────┤
│ sidebar tree │ file list (encrypted files greyed out)   │
└──────────────┴──────────────────────────────────────────┘
```

### File list in encrypt mode

```
│ 📁 Documents         Directory   today                  │  ← normal
│ 📁 Downloads         Directory   today                  │  ← normal
│ 🔒 secret.gpg        GPG         Mon      (greyed out)  │  ← disabled
│ 📄 report.md         MD          Sun                    │  ← selectable
│ 📄 notes.txt         TXT         Sat                    │  ← selectable
```

### Context menu on right-click

```
│ 📄 report.md         MD          Sun      ┌────────────┐│
│                                           │ Encrypt    ││
│                                           │ file       ││
│                                           └────────────┘│
```

### Encrypt dialog

Idle state:

```
┌──────────────────────────────────────────┐
│  Encrypt file                       [✕]  │
│                                          │
│  File: report.md                         │
│  Output: report.md.gpg                   │
│                                          │
│  Passphrase                              │
│  [                              ]  [👁]  │
│                                          │
│  Confirm passphrase                      │
│  [                              ]  [👁]  │
│                                          │
│               [Cancel]  [Encrypt]        │
└──────────────────────────────────────────┘
```

Loading state (after Encrypt is clicked):

```
┌──────────────────────────────────────────┐
│  Encrypt file                       [✕]  │
│                                          │
│  File: report.md                         │
│  Output: report.md.gpg                   │
│                                          │
│  Passphrase                              │
│  [                              ]  [👁]  │
│                                          │
│  Confirm passphrase                      │
│  [                              ]  [👁]  │
│                                          │
│  ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │  ← animated indeterminate bar
│  Encrypting file, please wait…           │
│                                          │
│          [Cancel ░]  [Encrypt ░]         │  ← both disabled
└──────────────────────────────────────────┘
```

---

## Security Considerations

- **Passphrases are never persisted.** They exist only in React component state for the lifetime of the dialog and as a string argument to the Tauri command. They are cleared when the dialog closes.
- **No passphrase strength enforcement** beyond the 8-character minimum in this feature. A follow-up may add entropy estimation (e.g., zxcvbn).
- **The original file is not deleted.** The user retains the plaintext file. Secure deletion of the source is a separate, opt-in action.
- **Output path is deterministic** (`<input>.gpg`). If a file with that name already exists it is **silently overwritten** — the Tauri command uses `std::fs::write`, which truncates and replaces any existing file without prompting. The dialog always displays the computed output filename (e.g. `report.md.gpg`) so the user can see what will be written before clicking **Encrypt**. A future enhancement may add an explicit overwrite-confirmation step when the output file already exists.

---

## Acceptance Criteria

- [ ] The tab bar renders "Encrypt" and "Decrypt" tabs; "Encrypt" is active by default.
- [ ] In encrypt mode, files with `.gpg` or `.pgp` extensions are rendered at reduced opacity with `cursor-not-allowed` and do not respond to right-click.
- [ ] Right-clicking a non-greyed file row shows a context menu with "Encrypt file".
- [ ] The encrypt dialog displays the source filename and the computed output filename (`<name>.gpg`).
- [ ] Submitting with an empty passphrase shows the "must not be empty" error inline without closing the dialog.
- [ ] Submitting with a passphrase shorter than 8 characters shows the length error.
- [ ] Submitting with mismatched passphrase fields shows the mismatch error.
- [ ] Eye-toggle buttons reveal/hide each passphrase field independently.
- [ ] A successful encryption creates a `.gpg` file in the same directory, refreshes the file list, and shows a success toast.
- [ ] If a `.gpg` file with the same name already exists it is silently overwritten; no additional confirmation prompt is shown.
- [ ] The new `.gpg` file appears greyed out in the refreshed file list (encrypt mode).
- [ ] A backend error (e.g., insufficient write permissions) is surfaced inside the dialog as an inline error without crashing the app.
- [ ] All existing `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) suites continue to pass.
- [ ] `pnpm build:tauri` compiles without errors on macOS, Linux, and Windows.
