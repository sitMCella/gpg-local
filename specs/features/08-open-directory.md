# Feature: Open Directory in OS File Explorer

Allow the user to open any folder visible in the sidebar tree in the operating system's native file explorer (Finder on macOS, Explorer on Windows, Nautilus/Files on Linux) via a right-click context menu item. The action is available on every folder node in the `FolderTree` sidebar, regardless of the active mode (Encrypt or Decrypt).

---

## Motivation

Features 03–07 let the user browse, encrypt, decrypt, refresh, and open text files — but there is no way to quickly jump from the in-app sidebar into the OS file manager. Users frequently need to move, rename, or inspect files in ways that GPG Local does not support (and should not — it is an encryption tool, not a full file manager). The most natural affordance is the one every desktop file browser already offers: "Show in Finder" / "Open in Explorer". This reuses the `openFilePath` platform helper already wired up for feature 07 (Open Text File) and the context-menu infrastructure already present on sidebar folder nodes from feature 06 (Reload).

---

## Goals

1. Add an **Open in file explorer** item to the right-click context menu on every folder node in the sidebar `FolderTree` component.
2. The item appears above the existing **Reload** item in the context menu.
3. Clicking **Open in file explorer** asks the OS to open the folder's absolute path in its configured default file manager, on macOS, Windows, and Linux.
4. The action never reads the directory's contents into the app and never invokes any encrypt/decrypt command — it only hands the path to the OS.
5. If the OS cannot open the directory (path no longer exists, permission denied, no default handler), the failure is surfaced as a toast rather than crashing the app.

---

## Out of Scope

- Opening individual files from the sidebar (files are not shown in the sidebar tree; only directories are).
- Adding a toolbar button for this action (may be tracked separately).
- A keyboard shortcut for opening a directory in the file explorer.
- Configuring or overriding which application the OS treats as the default file manager — that is entirely OS-level configuration outside the app's control.

---

## Prerequisites

| Requirement         | Notes                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| Feature 03 complete | `FolderTree` component and sidebar tree must be in place                                       |
| Feature 06 complete | Context menu on folder nodes with **Reload** item must exist                                   |
| Feature 07 complete | `tauri-plugin-opener` and the `openFilePath` platform helper must be wired up                  |

---

## Current State

- [FolderTree.tsx](src/components/FolderTree.tsx) renders a `ContextMenuRoot` per folder node via `FolderTreeNode`, with a single **Reload** item added in feature 06.
- [platform.ts](src/lib/platform.ts) exports `openFilePath(path)`, which calls `openPath` from `@tauri-apps/plugin-opener` in Tauri and falls back to a `__E2E_MOCK_OPEN_PATH__` window global in browser/test environments. This helper already works for directories — `openPath` hands the path to the OS, which opens it in the default file manager when the path is a directory.
- The `opener:allow-open-path` permission is already granted in [default.json](src-tauri/capabilities/default.json), scoped to `$HOME/**`.
- Toast infrastructure (`@/components/ui/toast`) is already available and used in [FileList.tsx](src/components/FileList.tsx) for the "Open file" error case.

---

## Implementation Plan

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

### 4. Update Tauri capabilities

No new permissions are required. The `opener:allow-open-path` permission granted in feature 07 already covers opening directory paths.

### 5. Write unit tests

**`src/components/FolderTree.test.tsx`** (additions)

- Right-click context menu contains an "Open in file explorer" item.
- Clicking "Open in file explorer" calls `openFilePath` with the node's path.
- When `openFilePath` rejects, the app does not crash (error is caught and a toast is triggered).

### 6. Write e2e tests

**`e2e/open-directory.spec.ts`** (new file)

- Right-clicking a folder node shows "Open in file explorer".
- Right-clicking a child folder node shows "Open in file explorer".
- "Open in file explorer" appears above "Reload" in the context menu.
- Clicking "Open in file explorer" calls `openPath` with the root node path.
- Clicking "Open in file explorer" on a child folder uses that folder's path.
- Failure to open shows a toast with error details and the app does not crash.
- Toast includes the error message.
- Reload still works after using "Open in file explorer".

**`e2e/refresh.spec.ts`** (update)

- Update the existing test that asserts the context menu item count: from 1 ("Reload" only) to 2 ("Open in file explorer" + "Reload").

---

## File Tree After This Feature

```
src/
└── components/
    └── FolderTree.tsx       # + openFilePath import, toast import, handleOpenInExplorer handler, "Open in file explorer" context menu item
e2e/
├── open-directory.spec.ts   # ← new: e2e tests for opening directories in OS file explorer
└── refresh.spec.ts          # updated context menu item count assertion
```

No new component files are introduced — all changes are additive edits to `FolderTree.tsx` and test files.

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

---

## Security Considerations

- **No directory contents pass through the app.** `openFilePath` only receives the directory's path; the OS-level file manager reads and renders the listing, entirely outside GPG Local's process.
- **The action is a pure passthrough to the OS.** GPG Local does not attempt to sandbox, inspect, or restrict what the file manager does once opened — this is identical in trust model to right-clicking a folder in Finder/Explorer/Nautilus and selecting "Open".
- **The permission scope is already bounded.** `opener:allow-open-path` in `default.json` is scoped to `$HOME/**`, so only paths within the user's home directory can be opened. Paths outside this scope will be rejected by the Tauri capability layer.

---

## Acceptance Criteria

- [ ] Right-clicking any folder node in the sidebar tree shows a context menu with "Open in file explorer" above "Reload".
- [ ] Clicking "Open in file explorer" launches the folder in the OS's configured default file manager on macOS, Windows, and Linux.
- [ ] The action does not invoke `encrypt_file`, `decrypt_file`, or any other GPG command.
- [ ] The action is available in both Encrypt and Decrypt modes — it is not mode-dependent.
- [ ] If the OS fails to open the directory (missing path, permission error), a toast reports the failure and the app does not crash.
- [ ] The toast includes the error details (error message from the OS).
- [ ] The existing "Reload" context menu item continues to work unchanged.
- [ ] All existing `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) suites continue to pass.
- [ ] `pnpm build:tauri` compiles without errors on macOS, Linux, and Windows.
