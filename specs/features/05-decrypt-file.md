# Feature: Decrypt File from File Browser

Allow the user to symmetrically decrypt any `.gpg` file visible in the file-list panel using a passphrase. The operation is initiated from a context menu on the file row, confirmed through a passphrase dialog, and produces the decrypted file in the same directory as the source file — without removing the original `.gpg` file.

---

## Motivation

Feature 04 delivered symmetric file encryption from the file browser. The natural complement is decryption: a user who has encrypted a file (or received one from a third party) must be able to restore the plaintext from within the same UI. Symmetric passphrase decryption is the minimal viable decrypt path — no key management is required — and it validates the full round-trip through the `decrypt_file` Tauri command already implemented in feature 02.

---

## Goals

1. Activate the **Decrypt** tab that was scaffolded as a placeholder in feature 04.
2. In decrypt mode, only files with a `.gpg` or `.pgp` extension are selectable; all other files are visually greyed out and cannot be actioned.
3. Right-clicking a selectable (encrypted) file opens a context menu with a single relevant action: **Decrypt file**.
4. Clicking **Decrypt file** opens a modal dialog that collects a passphrase.
5. On confirmation, invoke the `decrypt_file` Tauri command (feature 02). The output path is the source path with the `.gpg` / `.pgp` extension stripped (e.g. `report.md.gpg` → `report.md`). If stripping the extension would produce a name with no remaining extension (e.g. `archive.gpg` → `archive`), the original name minus the extension is used as-is.
6. On success, refresh the file list so the new plaintext file appears immediately, and show a success toast.
7. On error, surface a clear inline message inside the dialog without closing it.

---

## Out of Scope

- Public-key (recipient-based) decryption — covered separately.
- Deleting or replacing the original `.gpg` file after decryption.
- Progress indication for large files (tracked separately).
- Keyboard shortcut to invoke decryption without a context menu.
- Handling files encrypted with a key not present in the local keyring (public-key workflow is a future feature).

---

## Prerequisites

| Requirement         | Notes                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| Feature 02 complete | `decrypt_file` Tauri command and the sequoia-openpgp backend must be present                       |
| Feature 03 complete | File browser dashboard, `FileList` component, and Shadcn + Tailwind v4 setup must be in place     |
| Feature 04 complete | Mode tab bar, context menu infrastructure, `EncryptDialog` pattern, and Sonner toasts must exist  |

---

## Implementation Plan

### 1. Activate the Decrypt tab in `ModeTabBar`

The `ModeTabBar` component already renders a "Decrypt" tab (added in feature 04) but it was non-functional. No structural changes to `ModeTabBar` are needed — switching to the `decrypt` value already updates the `mode` state in `App.tsx` and passes it down to `FileList`.

Verify that the tab triggers the correct `onModeChange('decrypt')` callback and that the active-tab indicator (3 px bottom-border underline, `text-sm font-semibold`) applies to the Decrypt tab when it is selected.

### 2. Extend `FileList` filtering for decrypt mode

`FileList` already has an `isDisabled` helper introduced in feature 04. Extend it to handle decrypt mode:

```ts
function isDisabled(entry: FsEntry, mode: 'encrypt' | 'decrypt'): boolean {
  const ext = entry.name.split('.').pop()?.toLowerCase()
  if (mode === 'encrypt') {
    return ext === 'gpg' || ext === 'pgp'
  }
  if (mode === 'decrypt') {
    // Directories are always navigable; only non-encrypted files are disabled
    if (entry.isDir) return false
    return ext !== 'gpg' && ext !== 'pgp'
  }
  return false
}
```

Disabled rows in decrypt mode receive the same visual treatment as in encrypt mode:

- `opacity-40` + `cursor-not-allowed` Tailwind classes on the row element.
- The row does not respond to right-click or keyboard selection.
- Directory rows are **never** disabled in either mode — the user must still be able to navigate into folders.

### 3. Add a decrypt action to the context menu

The context menu in `FileList` already uses Shadcn `ContextMenu`. Extend it to render a **Decrypt file** item when the active mode is `decrypt` and the row is not disabled:

```tsx
{mode === 'encrypt' && !disabled && (
  <ContextMenuItem onSelect={() => onEncryptRequest(entry)}>Encrypt file</ContextMenuItem>
)}
{mode === 'decrypt' && !disabled && (
  <ContextMenuItem onSelect={() => onDecryptRequest(entry)}>Decrypt file</ContextMenuItem>
)}
```

`onDecryptRequest` lifts the selected entry up to a piece of state that controls the decrypt dialog's visibility:

```ts
const [decryptTarget, setDecryptTarget] = useState<FsEntry | null>(null)
```

This state lives in `FileList` (mirroring `encryptTarget`) and is passed to `DecryptDialog`.

### 4. Compute the output path

Create a pure helper function (testable in isolation):

```ts
export function decryptedOutputPath(sourcePath: string): string {
  // Strip the last extension if it is .gpg or .pgp
  const lower = sourcePath.toLowerCase()
  if (lower.endsWith('.gpg') || lower.endsWith('.pgp')) {
    return sourcePath.slice(0, sourcePath.lastIndexOf('.'))
  }
  // Fallback: append .decrypted (should not normally be reached)
  return `${sourcePath}.decrypted`
}
```

The computed output path is displayed in the dialog before the user confirms so they know what file will be written.

### 5. Build the `DecryptDialog` component

Create `src/components/DecryptDialog.tsx`.

The dialog is a controlled modal built on Shadcn `Dialog`, mirroring `EncryptDialog`. It is shown when `decryptTarget` is non-null and closed on cancel or successful decryption.

```ts
interface DecryptDialogProps {
  target: FsEntry | null // null = closed
  onClose: () => void
  onSuccess: (outputPath: string) => void
}
```

Internal state:

```ts
const [passphrase, setPassphrase] = useState('')
const [showPassphrase, setShowPassphrase] = useState(false)
const [error, setError] = useState<string | null>(null)
const [loading, setLoading] = useState(false)
```

Note: unlike `EncryptDialog`, there is only **one** passphrase field — no confirmation field is needed for decryption.

Layout:

```
┌──────────────────────────────────────────┐
│  Decrypt file                       [✕]  │
│                                          │
│  File: report.md.gpg                     │
│  Output: report.md                       │
│                                          │
│  Passphrase                              │
│  [••••••••••••••••••••••••••]  [👁]      │
│                                          │
│  ⚠  Passphrase must not be empty.        │  ← inline error, only when present
│                                          │
│  ▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░    │  ← indeterminate progress bar (loading only)
│  Decrypting file, please wait…           │  ← status text (loading only)
│                                          │
│               [Cancel]  [Decrypt]        │
└──────────────────────────────────────────┘
```

Validation rules (client-side, evaluated on submit):

| Condition              | Error message                   |
| ---------------------- | ------------------------------- |
| Passphrase is empty    | "Passphrase must not be empty." |

The passphrase field has a toggle button (`Eye` / `EyeOff` Lucide icons) to reveal the passphrase in plain text. It defaults to `type="password"`. The toggle button is excluded from the tab order (`tabIndex={-1}`).

Pressing **Enter** in the passphrase field submits the form — equivalent to clicking the **Decrypt** button. The key handler is a no-op while `loading` is true.

While `loading` is true, the **Decrypt** and **Cancel** buttons are disabled, and an indeterminate progress bar appears above the footer together with the status text "Decrypting file, please wait…". The Decrypt button label does not change.

State is reset (passphrase cleared, error cleared, loading false, showPassphrase false) every time the dialog opens (i.e. when `target` transitions from `null` to a non-null value) using a `useEffect` on `target`.

### 6. Invoke the Tauri command

When the user submits the dialog with a non-empty passphrase:

```ts
import { invoke } from '@tauri-apps/api/core'

async function handleDecrypt() {
  if (!target) return
  setError(null)
  setLoading(true)
  try {
    const outputPath = decryptedOutputPath(target.path)
    await invoke('decrypt_file', {
      options: {
        input_path: target.path,
        output_path: outputPath,
        passphrase,
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

On success, `onSuccess` is called with the output path, which:

1. Closes the dialog (sets `decryptTarget` to `null`).
2. Triggers a directory refresh in `FileList` so the new plaintext file appears.
3. Displays a brief success toast using the Sonner component added in feature 04.

Success toast message: **"report.md.gpg decrypted → report.md"**

A wrong-passphrase error from the Tauri backend surfaces as an inline error inside the dialog: **"Decryption failed. Check your passphrase and try again."** The raw backend error string is appended in parentheses for diagnostics: `"Decryption failed. Check your passphrase and try again. (no matching secret key found)"`.

### 7. Wire `DecryptDialog` into `FileList` and `App`

`FileList` manages `decryptTarget` state and renders `DecryptDialog`. The `onSuccess` handler:

1. Calls `setDecryptTarget(null)` to close the dialog.
2. Re-invokes the `read` function from `useDirectory` on the current `dirPath` to refresh the file list.
3. Calls a `onToast` prop callback (or uses a shared toast context) to fire the Sonner success toast.

The toast can alternatively be fired directly from within `DecryptDialog` before calling `onSuccess` — either approach is acceptable as long as it only fires on success.

### 8. Update Tauri capabilities

No new permissions are required. The `fs:allow-read-file` and `fs:allow-write-file` permissions granted in features 02 and 03 already cover reading the ciphertext and writing the plaintext output.

### 9. Write unit tests

**`src/components/DecryptDialog.test.tsx`**

- Renders correctly when `target` is non-null: file name and computed output path are displayed.
- Shows "Passphrase must not be empty." when the form is submitted with a blank passphrase.
- Does **not** show a confirmation field (only one passphrase input is rendered).
- While loading, the Decrypt and Cancel buttons are disabled, an indeterminate progress bar is visible, and the status text "Decrypting file, please wait…" is shown. The Decrypt button label does not change.
- Toggles passphrase visibility when the eye icon is clicked.
- Pressing Enter in the passphrase field triggers decryption (same as clicking Decrypt); no-op while loading.
- Calls `onClose` when Cancel is clicked.
- After a failed invoke, the inline error message is rendered and the dialog remains open.
- Passphrase field and error are cleared when `target` changes from null to a new entry (dialog re-opens).

**`src/components/FileList.test.tsx`** (additions)

- In `decrypt` mode, a `.gpg` file row does **not** have `cursor-not-allowed` and responds to right-click with a "Decrypt file" menu item.
- In `decrypt` mode, a `.txt` file row has `cursor-not-allowed` and does not show a context menu on right-click.
- In `decrypt` mode, a directory row does **not** have `cursor-not-allowed` (directories remain navigable).

**`src/utils/decryptedOutputPath.test.ts`**

- `report.md.gpg` → `report.md`
- `archive.pgp` → `archive`
- `photo.jpg.gpg` → `photo.jpg`
- A path with no recognised encrypted extension → `<path>.decrypted` (fallback).

**`src/components/ModeTabBar.test.tsx`** (additions)

- Clicking the "Decrypt" tab sets `aria-selected="true"` on the Decrypt tab and `aria-selected="false"` on the Encrypt tab.

---

## File Tree After This Feature

```
src/
├── App.tsx                        # decrypt mode now fully active
├── components/
│   ├── DecryptDialog.tsx          # ← new: passphrase modal for decryption
│   ├── FileList.tsx               # + decrypt-mode disabled logic, Decrypt context menu item, decryptTarget state, DecryptDialog render
│   ├── ModeTabBar.tsx             # Decrypt tab now fully wired (no structural change needed)
│   └── ui/                        # unchanged
├── utils/
│   └── decryptedOutputPath.ts     # ← new: pure helper, output path computation
└── test/
    └── setup.ts                   # unchanged
```

---

## Visual Layout Reference

### Mode tab bar (decrypt mode active)

```
┌─────────────────────────────────────────────────────────┐
│ [⌂] [📂]  │  home  /  Documents                        │
├─────────────────────────────────────────────────────────┤
│   Encrypt   ▸ DECRYPT ▂▂▂                              │  ← 40 px tall; active: bold + 3 px underline
├──────────────┬──────────────────────────────────────────┤
│ sidebar tree │ file list (non-encrypted files greyed)   │
└──────────────┴──────────────────────────────────────────┘
```

### File list in decrypt mode

```
│ 📁 Documents         Directory   today                  │  ← normal (navigable)
│ 📁 Downloads         Directory   today                  │  ← normal (navigable)
│ 🔒 secret.gpg        GPG         Mon                    │  ← selectable
│ 🔒 report.md.gpg     GPG         Sun                    │  ← selectable
│ 📄 notes.txt         TXT         Sat      (greyed out)  │  ← disabled
│ 📄 budget.xlsx       XLSX        2 wk ago (greyed out)  │  ← disabled
```

### Context menu on right-click (decrypt mode)

```
│ 🔒 report.md.gpg     GPG         Sun      ┌──────────────┐│
│                                           │ Decrypt file ││
│                                           └──────────────┘│
```

### Decrypt dialog

Idle state:

```
┌──────────────────────────────────────────┐
│  Decrypt file                       [✕]  │
│                                          │
│  File: report.md.gpg                     │
│  Output: report.md                       │
│                                          │
│  Passphrase                              │
│  [                              ]  [👁]  │
│                                          │
│               [Cancel]  [Decrypt]        │
└──────────────────────────────────────────┘
```

Error state (wrong passphrase):

```
┌──────────────────────────────────────────┐
│  Decrypt file                       [✕]  │
│                                          │
│  File: report.md.gpg                     │
│  Output: report.md                       │
│                                          │
│  Passphrase                              │
│  [                              ]  [👁]  │
│                                          │
│  ⚠  Decryption failed. Check your        │
│     passphrase and try again.            │
│     (no matching secret key found)       │
│                                          │
│               [Cancel]  [Decrypt]        │
└──────────────────────────────────────────┘
```

Loading state (after Decrypt is clicked):

```
┌──────────────────────────────────────────┐
│  Decrypt file                       [✕]  │
│                                          │
│  File: report.md.gpg                     │
│  Output: report.md                       │
│                                          │
│  Passphrase                              │
│  [                              ]  [👁]  │
│                                          │
│  ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   │  ← animated indeterminate bar
│  Decrypting file, please wait…           │
│                                          │
│          [Cancel ░]  [Decrypt ░]         │  ← both disabled
└──────────────────────────────────────────┘
```

---

## Security Considerations

- **Passphrases are never persisted.** The passphrase exists only in React component state for the lifetime of the dialog and as a string argument to the Tauri command. It is cleared when the dialog closes.
- **No passphrase caching.** The user must re-enter the passphrase each time the dialog is opened. No in-memory cache is maintained between invocations.
- **The original `.gpg` file is not deleted.** The user retains the encrypted file. Secure deletion of the ciphertext is a separate, opt-in action.
- **Output path is deterministic** (source path with `.gpg`/`.pgp` stripped). If a file with that name already exists it is silently overwritten — the Tauri command uses `std::fs::write`, which truncates and replaces without prompting. The dialog always displays the computed output filename so the user can see what will be written before clicking **Decrypt**. A future enhancement may add an explicit overwrite-confirmation step.
- **Error messages from the backend are shown verbatim** (in parentheses) to aid diagnostics. They must not contain passphrase material — the backend must not echo the passphrase in its error output.

---

## Acceptance Criteria

- [ ] Clicking the "Decrypt" tab makes it the active tab (underline indicator, bold text) and switches the file list into decrypt mode.
- [ ] In decrypt mode, files without a `.gpg` or `.pgp` extension are rendered at reduced opacity with `cursor-not-allowed` and do not respond to right-click.
- [ ] In decrypt mode, directories are not greyed out and remain navigable.
- [ ] In decrypt mode, files with `.gpg` or `.pgp` extensions are rendered normally and respond to right-click.
- [ ] Right-clicking a selectable encrypted file in decrypt mode shows a context menu with "Decrypt file".
- [ ] The decrypt dialog displays the source filename and the computed output filename.
- [ ] Submitting with an empty passphrase shows the "Passphrase must not be empty." error inline without closing the dialog.
- [ ] The eye-toggle button reveals and hides the passphrase field.
- [ ] Pressing Enter in the passphrase field triggers decryption (equivalent to clicking Decrypt); no-op while loading.
- [ ] While decryption is in progress, both buttons are disabled, the indeterminate bar is visible, and the status text "Decrypting file, please wait…" is shown.
- [ ] A successful decryption creates the plaintext file in the same directory, refreshes the file list, and shows a success toast.
- [ ] The newly created plaintext file appears greyed out in the refreshed file list (decrypt mode does not apply to it).
- [ ] A wrong passphrase causes the backend to return an error, which is displayed inline inside the dialog without crashing the app.
- [ ] If a plaintext file with the same output name already exists it is silently overwritten; no additional confirmation prompt is shown.
- [ ] Switching back to the "Encrypt" tab restores the encrypt-mode file-list filtering (`.gpg` files greyed out).
- [ ] All existing `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) suites continue to pass.
- [ ] `pnpm build:tauri` compiles without errors on macOS, Linux, and Windows.
