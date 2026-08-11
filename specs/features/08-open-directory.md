# Feature: Open in OS File Explorer

Allow the user to reveal any folder or file in the operating system's native file explorer (Finder on macOS, Explorer on Windows, Nautilus/Files on Linux) via a right-click context menu item. The action is available in two places:

1. **Sidebar tree** — on every folder node in the `FolderTree` component, regardless of the active mode (Encrypt or Decrypt).
2. **File list panel** — on every non-disabled row (files and directories) in the `FileList` component, in both Encrypt and Decrypt modes.

---

## Motivation

Features 03–07 let the user browse, encrypt, decrypt, refresh, and open text files — but there is no way to quickly jump from the in-app view into the OS file manager. Users frequently need to move, rename, or inspect files in ways that GPG Local does not support (and should not — it is an encryption tool, not a full file manager). The most natural affordance is the one every desktop file browser already offers: "Show in Finder" / "Open in Explorer".

In the sidebar, "Open in file explorer" lets the user reveal a folder in the OS without leaving the app. In the file list panel, it extends the same convenience to individual files and directory rows — a user might want to locate an encrypted `.gpg` file in Finder before sharing it, or reveal a plaintext file's location before encrypting it. The action is mode-independent because it has no interaction with GPG operations.

This reuses the `openFilePath` platform helper already wired up for feature 07 (Open Text File) and the context-menu infrastructure already present on sidebar folder nodes from feature 06 (Reload) and on file-list rows from features 04–05 (Encrypt / Decrypt context menus).

---

## Goals

1. Add an **Open in file explorer** item to the right-click context menu on every folder node in the sidebar `FolderTree` component.
2. In the sidebar, the item appears above the existing **Reload** item in the context menu.
3. Add an **Open in file explorer** item to the right-click context menu on every non-disabled row in the `FileList` component, in both Encrypt and Decrypt modes.
4. In the file list, the item appears as the last item in the context menu — after the mode-specific action items ("Open file" / "Encrypt file" in encrypt mode, "Decrypt file" in decrypt mode).
5. For directory rows in the file list (which currently have no context menu), render a context menu containing only **Open in file explorer**.
6. Clicking **Open in file explorer** asks the OS to open the entry's absolute path in its configured default file manager, on macOS, Windows, and Linux. For files, the OS file manager typically reveals the file by opening its containing directory and selecting it.
7. The action never reads the entry's contents into the app and never invokes any encrypt/decrypt command — it only hands the path to the OS.
8. If the OS cannot open the path (path no longer exists, permission denied, no default handler), the failure is surfaced as a toast rather than crashing the app.

---

## Out of Scope

- Opening individual files from the sidebar (files are not shown in the sidebar tree; only directories are).
- Adding a toolbar button for this action (may be tracked separately).
- A keyboard shortcut for opening in the file explorer.
- Configuring or overriding which application the OS treats as the default file manager — that is entirely OS-level configuration outside the app's control.

---

## Prerequisites

| Requirement         | Notes                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Feature 03 complete | `FolderTree` component and sidebar tree must be in place                                       |
| Feature 04 complete | `FileList` context menu with **Encrypt file** item must exist                                  |
| Feature 05 complete | `FileList` context menu with **Decrypt file** item must exist                                  |
| Feature 06 complete | Context menu on folder nodes with **Reload** item must exist                                   |
| Feature 07 complete | `tauri-plugin-opener` and the `openFilePath` platform helper must be wired up                  |

---

## Current State

- [FolderTree.tsx](src/components/FolderTree.tsx) renders a `ContextMenuRoot` per folder node via `FolderTreeNode`, with a single **Reload** item added in feature 06.
- [FileList.tsx](src/components/FileList.tsx) renders a `ContextMenuRoot` per non-disabled row via `FileListItem`. In encrypt mode, non-encrypted file rows show "Open file" (text files only) + "Encrypt file". In decrypt mode, encrypted file rows show "Decrypt file". Directory rows in the file list currently render no `ContextMenuContent` — the `ContextMenuRoot` wrapper exists but the content blocks are gated by `!entry.isDir`, so right-clicking a directory row shows nothing.
- [platform.ts](src/lib/platform.ts) exports `openFilePath(path)`, which calls `openPath` from `@tauri-apps/plugin-opener` in Tauri and falls back to a `__E2E_MOCK_OPEN_PATH__` window global in browser/test environments. This helper already works for both files and directories — `openPath` hands the path to the OS, which opens the default handler (file manager for directories, or reveals-and-selects for files).
- The `opener:allow-open-path` permission is already granted in [default.json](src-tauri/capabilities/default.json), scoped to `$HOME/**`.
- Toast infrastructure (`@/components/ui/toast`) is already available and used in [FileList.tsx](src/components/FileList.tsx) for the "Open file" error case.
- [FileList.tsx](src/components/FileList.tsx) already imports `openFilePath` and `toast`, and has a `handleOpenRequest` handler that calls `openFilePath` — used by the "Open file" text-file action from feature 07. The same handler can be reused for "Open in file explorer".

---

## Implementation Plan

### Part A — Sidebar tree (`FolderTree`)

### 1. Import `openFilePath` and `toast` in `FolderTree.tsx`

Add imports for the platform helper and the toast manager:

```ts
import { readDirectory, openFilePath } from '@/lib/platform'
import { toast } from '@/components/ui/toast'
```

### 2. Add the `handleOpenInExplorer` handler in `FolderTreeNode`

Add a callback that calls `openFilePath` with the node's path and catches errors:

```ts
const handleOpenInExplorer = useCallback(async () => {
  try {
    await openFilePath(node.path)
  } catch (err) {
    toast.add({
      title: `Could not open ${node.name}`,
      description: String(err),
      timeout: 4000,
    })
  }
}, [node.path, node.name])
```

The pattern matches the existing `handleOpenRequest` in `FileList.tsx` — fire-and-forget from the app's perspective; the OS spawns the file manager asynchronously.

### 3. Add the context menu item

Insert an **Open in file explorer** item above the existing **Reload** item in the `ContextMenuContent`:

```tsx
<ContextMenuContent>
  <ContextMenuItem onClick={handleOpenInExplorer}>Open in file explorer</ContextMenuItem>
  <ContextMenuItem onClick={handleReload}>Reload</ContextMenuItem>
</ContextMenuContent>
```

No conditional rendering is needed — the item is available on every folder node regardless of mode.

---

### Part B — File list panel (`FileList`)

### 4. Add an `onOpenInExplorerRequest` callback prop to `FileListItem`

Extend the props interface:

```ts
interface FileListItemProps {
  entry: FsEntry
  disabled: boolean
  mode: AppMode
  onNavigate: (path: string) => void
  onEncryptRequest?: (entry: FsEntry) => void
  onDecryptRequest?: (entry: FsEntry) => void
  onOpenRequest?: (entry: FsEntry) => void
  onOpenInExplorerRequest?: (entry: FsEntry) => void // ← new
}
```

### 5. Add `handleOpenInExplorer` in `FileList`

Reuse the same fire-and-forget pattern already used by `handleOpenRequest`:

```ts
async function handleOpenInExplorer(entry: FsEntry) {
  try {
    await openFilePath(entry.path)
  } catch (err) {
    toast.add({
      title: `Could not open ${entry.name}`,
      description: String(err),
      timeout: 4000,
    })
  }
}
```

`openFilePath` and `toast` are already imported in `FileList.tsx` (added in feature 07) — no new imports needed.

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
  onOpenInExplorerRequest={handleOpenInExplorer}
/>
```

### 6. Extend the context menu in `FileListItem`

Add **Open in file explorer** as the last item in every context menu variant, and add a new context menu for directory rows (which currently have none).

The updated context menu rendering in `FileListItem`:

```tsx
{mode === 'encrypt' && !entry.isDir && (
  <ContextMenuContent>
    {isTextFile(entry) && (
      <ContextMenuItem onClick={() => onOpenRequest?.(entry)}>Open file</ContextMenuItem>
    )}
    <ContextMenuItem onClick={() => onEncryptRequest?.(entry)}>Encrypt file</ContextMenuItem>
    <ContextMenuItem onClick={() => onOpenInExplorerRequest?.(entry)}>Open in file explorer</ContextMenuItem>
  </ContextMenuContent>
)}
{mode === 'decrypt' && !entry.isDir && (
  <ContextMenuContent>
    <ContextMenuItem onClick={() => onDecryptRequest?.(entry)}>Decrypt file</ContextMenuItem>
    <ContextMenuItem onClick={() => onOpenInExplorerRequest?.(entry)}>Open in file explorer</ContextMenuItem>
  </ContextMenuContent>
)}
{entry.isDir && (
  <ContextMenuContent>
    <ContextMenuItem onClick={() => onOpenInExplorerRequest?.(entry)}>Open in file explorer</ContextMenuItem>
  </ContextMenuContent>
)}
```

Key design decisions:

- **Last position in the menu.** The primary GPG actions (Encrypt / Decrypt) and the text-file "Open file" action are more frequent operations and stay at the top. "Open in file explorer" is a navigation convenience and sits at the bottom, separated by position from the primary actions.
- **Available for files in both modes.** In encrypt mode, the user can reveal any non-disabled file (including non-text files like `.xlsx`) in the OS file manager. In decrypt mode, the user can reveal any `.gpg`/`.pgp` file. This is useful for locating the file before or after a GPG operation.
- **Available for directory rows.** Directory rows in the file list previously had no context menu. They now show a single-item menu with "Open in file explorer", giving the user a way to open a subdirectory in the OS without navigating into it within the app.
- **Not shown on disabled rows.** Disabled rows (`.gpg` in encrypt mode, non-encrypted files in decrypt mode) already skip context menu rendering entirely via the early return in `FileListItem`. This remains unchanged — "Open in file explorer" is not added to disabled rows, keeping the existing disabled-row behavior consistent.

---

### Part C — Shared

### 7. Update Tauri capabilities

No new permissions are required. The `opener:allow-open-path` permission granted in feature 07 already covers opening both file and directory paths.

### 8. Write unit tests

**`src/components/FolderTree.test.tsx`** (additions)

- Right-click context menu contains an "Open in file explorer" item.
- Clicking "Open in file explorer" calls `openFilePath` with the node's path.
- When `openFilePath` rejects, the app does not crash (error is caught and a toast is triggered).

**`src/components/FileList.test.tsx`** (additions)

- In `encrypt` mode, a non-encrypted file row's context menu contains "Open in file explorer" as the last item.
- In `encrypt` mode, a text file row (`.txt`) shows three context menu items in order: "Open file", "Encrypt file", "Open in file explorer".
- In `encrypt` mode, a non-text file row (`.xlsx`) shows two context menu items in order: "Encrypt file", "Open in file explorer".
- In `encrypt` mode, a `.gpg` file row (disabled) shows no context menu — unchanged from feature 04.
- In `decrypt` mode, a `.gpg` file row's context menu contains two items in order: "Decrypt file", "Open in file explorer".
- In `decrypt` mode, a non-encrypted file row (disabled) shows no context menu — unchanged from feature 05.
- In both modes, a directory row's context menu contains a single "Open in file explorer" item.
- Clicking "Open in file explorer" on a file row calls `openFilePath` with the entry's absolute path.
- Clicking "Open in file explorer" on a directory row calls `openFilePath` with the entry's absolute path.
- When `openFilePath` rejects, a failure toast is shown and no error is thrown to the test harness.

### 9. Write e2e tests

**`e2e/open-directory.spec.ts`** (new file)

Sidebar tree tests:

- Right-clicking a folder node shows "Open in file explorer".
- Right-clicking a child folder node shows "Open in file explorer".
- "Open in file explorer" appears above "Reload" in the context menu.
- Clicking "Open in file explorer" calls `openPath` with the root node path.
- Clicking "Open in file explorer" on a child folder uses that folder's path.
- Failure to open shows a toast with error details and the app does not crash.
- Toast includes the error message.
- Reload still works after using "Open in file explorer".

File list panel tests:

- In encrypt mode, right-clicking a non-encrypted file shows "Open in file explorer" as the last context menu item.
- In encrypt mode, right-clicking a text file (`.txt`) shows three items: "Open file", "Encrypt file", "Open in file explorer".
- In encrypt mode, right-clicking a non-text file (`.xlsx`) shows two items: "Encrypt file", "Open in file explorer".
- In decrypt mode, right-clicking a `.gpg` file shows two items: "Decrypt file", "Open in file explorer".
- In both modes, right-clicking a directory row shows a single "Open in file explorer" item.
- Clicking "Open in file explorer" on a file row calls `openPath` with the file's path.
- Clicking "Open in file explorer" on a directory row calls `openPath` with the directory's path.
- Failure to open a file shows a toast with error details.

**`e2e/refresh.spec.ts`** (update)

- Update the existing test that asserts the context menu item count: from 1 ("Reload" only) to 2 ("Open in file explorer" + "Reload").

---

## File Tree After This Feature

```
src/
└── components/
    ├── FolderTree.tsx       # + openFilePath import, toast import, handleOpenInExplorer handler, "Open in file explorer" context menu item
    └── FileList.tsx         # + onOpenInExplorerRequest prop, handleOpenInExplorer handler, "Open in file explorer" in all context menus, new directory row context menu
e2e/
├── open-directory.spec.ts   # ← new: e2e tests for opening in file explorer (sidebar + file list)
└── refresh.spec.ts          # updated context menu item count assertion
```

No new component files are introduced — all changes are additive edits to `FolderTree.tsx`, `FileList.tsx`, and test files.

---

## Visual Layout Reference

### Context menu on right-click (sidebar folder node)

```
│ ▼ home                                                      │
│   ▼ Documents                                               │
│     ▶ Projects    ┌──────────────────────────┐              │
│     ▶ Notes       │  Open in file explorer   │              │
│   ▶ Downloads     │  Reload                  │              │
│   ▶ Music         └──────────────────────────┘              │
```

The context menu appears on any folder node, whether expanded or collapsed, and in both Encrypt and Decrypt modes.

### Context menu on right-click (file list — encrypt mode, text file)

```
│ 📄 report.md         MD          Sun      ┌────────────────────────────┐│
│                                           │ Open file                  ││
│                                           │ Encrypt file               ││
│                                           │ Open in file explorer      ││
│                                           └────────────────────────────┘│
```

### Context menu on right-click (file list — encrypt mode, non-text file)

```
│ 📄 budget.xlsx       XLSX        2 wk ago ┌────────────────────────────┐│
│                                           │ Encrypt file               ││
│                                           │ Open in file explorer      ││
│                                           └────────────────────────────┘│
```

### Context menu on right-click (file list — decrypt mode, encrypted file)

```
│ 🔒 report.md.gpg     GPG         Sun      ┌────────────────────────────┐│
│                                           │ Decrypt file               ││
│                                           │ Open in file explorer      ││
│                                           └────────────────────────────┘│
```

### Context menu on right-click (file list — directory row, either mode)

```
│ 📁 Documents         Directory   today    ┌────────────────────────────┐│
│                                           │ Open in file explorer      ││
│                                           └────────────────────────────┘│
```

---

## Security Considerations

- **No file or directory contents pass through the app.** `openFilePath` only receives the entry's path; the OS-level file manager reads and renders the content, entirely outside GPG Local's process.
- **The action is a pure passthrough to the OS.** GPG Local does not attempt to sandbox, inspect, or restrict what the file manager does once opened — this is identical in trust model to right-clicking a file or folder in Finder/Explorer/Nautilus and selecting "Show in Finder" / "Open".
- **Encrypted files can be revealed but not opened as plaintext.** Revealing a `.gpg` file in the OS file manager shows it in the directory listing — the file manager does not attempt to decrypt or open it. This is a navigation action, not a content action.
- **The permission scope is already bounded.** `opener:allow-open-path` in `default.json` is scoped to `$HOME/**`, so only paths within the user's home directory can be opened. Paths outside this scope will be rejected by the Tauri capability layer.

---

## Acceptance Criteria

### Sidebar tree

- [ ] Right-clicking any folder node in the sidebar tree shows a context menu with "Open in file explorer" above "Reload".
- [ ] Clicking "Open in file explorer" launches the folder in the OS's configured default file manager on macOS, Windows, and Linux.
- [ ] The action is available in both Encrypt and Decrypt modes — it is not mode-dependent.
- [ ] The existing "Reload" context menu item continues to work unchanged.

### File list panel

- [ ] In encrypt mode, right-clicking a non-encrypted file row shows "Open in file explorer" as the last item in the context menu.
- [ ] In encrypt mode, a text file row (`.txt`, `.md`, etc.) shows three context menu items in order: "Open file", "Encrypt file", "Open in file explorer".
- [ ] In encrypt mode, a non-text file row (e.g. `.xlsx`) shows two context menu items in order: "Encrypt file", "Open in file explorer".
- [ ] In encrypt mode, a `.gpg`/`.pgp` file row (disabled) shows no context menu — unchanged from feature 04.
- [ ] In decrypt mode, right-clicking a `.gpg`/`.pgp` file row shows two context menu items in order: "Decrypt file", "Open in file explorer".
- [ ] In decrypt mode, non-encrypted file rows (disabled) show no context menu — unchanged from feature 05.
- [ ] In both modes, right-clicking a directory row in the file list shows a context menu with a single "Open in file explorer" item.
- [ ] Clicking "Open in file explorer" on a file row reveals the file in the OS file manager.
- [ ] Clicking "Open in file explorer" on a directory row opens the directory in the OS file manager.

### Shared

- [ ] The action does not invoke `encrypt_file`, `decrypt_file`, or any other GPG command.
- [ ] If the OS fails to open the path (missing path, permission error), a toast reports the failure and the app does not crash.
- [ ] The toast includes the error details (error message from the OS).
- [ ] All existing `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) suites continue to pass.
- [ ] `pnpm build:tauri` compiles without errors on macOS, Linux, and Windows.
