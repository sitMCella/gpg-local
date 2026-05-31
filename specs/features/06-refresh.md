# Feature: Refresh Current Directory

Provide two convenient ways for the user to reload the contents of the currently open directory: a **Reload** item in the right-click context menu on folder nodes in the sidebar tree, and a **Refresh** button in the top bar placed to the right of the Encrypt/Decrypt mode tab bar.

---

## Motivation

Features 03–05 deliver a working file browser. The file list panel already has a small reload button inside its own toolbar, but it is easy to overlook and requires the user to shift attention to the right panel. As files are encrypted or decrypted (or created/deleted by external processes) the user needs a prominent, reachable way to reload the current view from wherever their focus already is — either in the sidebar tree or in the header bar. This feature adds two natural trigger points that match common desktop file-browser conventions.

---

## Goals

1. Add a **Reload** item to the right-click context menu on folder nodes in the sidebar `FolderTree`. Triggering it re-reads that folder's children in the tree and, if the folder is the currently selected directory, also refreshes the file list panel.
2. Add a **Refresh** icon button in the top bar, positioned to the right of the `ModeTabBar` (Encrypt / Decrypt tabs). Clicking it re-reads the currently selected directory and updates the file list panel.
3. The two new controls are visually consistent with the existing `RefreshCw` button already present inside `FileList`'s own panel toolbar — same icon, same ghost-button style.
4. The existing `RefreshCw` button inside the file list panel toolbar is **not removed**; it remains as a third entry point for users already focused on that panel.

---

## Out of Scope

- Auto-refresh (polling for filesystem changes).
- Refreshing the entire sidebar tree recursively.
- Keyboard shortcut for refresh (tracked separately).
- Refresh progress indication beyond the existing `Loader2` spinner already used during directory reads.

---

## Prerequisites

| Requirement         | Notes                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| Feature 03 complete | `FolderTree`, `FileList`, and the `useDirectory` hook must be in place                 |
| Feature 04 complete | Mode tab bar and `App.tsx` state structure must exist                                  |
| Feature 05 complete | Decrypt mode and all context-menu plumbing must be complete before touching these files |

---

## Current State

- `FileList.tsx` renders a `RefreshCw` ghost button in its own panel toolbar (line ~167). It calls `read(dirPath)` from `useDirectory` to reload the current directory.
- `FolderTree.tsx` has no right-click context menu. Folder nodes only respond to left-click (select + expand/collapse) and keyboard events.
- `ModeTabBar.tsx` renders the Encrypt / Decrypt `Tabs` component with no adjacent controls.
- `App.tsx` uses a `fileListKey` integer that it increments to force-remount `FileList` when a successful encryption or decryption occurs. That key bump is not the right mechanism for a user-triggered refresh — calling `read` directly is preferred.

---

## Implementation Plan

### 1. Add a context menu to `FolderTree` nodes

Install the Shadcn `ContextMenu` component if not already present (it was added in feature 04 for `FileList`):

```bash
pnpm dlx shadcn@canary add context-menu   # no-op if already installed
```

#### 1a. Extend `FolderTreeProps`

Add an optional callback so the tree can notify `App` when the user triggers a reload on the currently selected folder:

```ts
interface FolderTreeProps {
  rootPath: string
  selectedPath: string | null
  onSelect: (path: string) => void
  onRefreshRequest?: (path: string) => void  // ← new
  showHidden?: boolean
}
```

#### 1b. Add the context menu in `FolderTreeNode`

Wrap the existing node `<div>` in a `ContextMenu` trigger, and render a **Reload** item in the menu content:

```tsx
import {
  ContextMenuRoot,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu'
import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'

// Inside FolderTreeNode render:
<ContextMenuRoot>
  <ContextMenuPrimitive.Trigger
    render={
      <div
        ref={ref}
        role="treeitem"
        // ...existing props unchanged...
      >
        {/* ...existing chevron + icon + label... */}
      </div>
    }
  />
  <ContextMenuContent>
    <ContextMenuItem onClick={handleReload}>Reload</ContextMenuItem>
  </ContextMenuContent>
</ContextMenuRoot>
```

#### 1c. Implement `handleReload` in `FolderTreeNode`

Reload discards the node's cached children and re-fetches them from the filesystem:

```ts
const handleReload = useCallback(async () => {
  setLoading(true)
  try {
    const children = await loadChildren(node, showHidden)
    onUpdate(node.path, { children, expanded: true })
  } catch {
    onUpdate(node.path, { children: [], expanded: true })
  } finally {
    setLoading(false)
    onReload?.(node.path)   // notify parent if this node is the selected dir
  }
}, [node, showHidden, onUpdate, onReload])
```

`onReload` is threaded down from `FolderTree` through `NodeProps` alongside the existing `onUpdate` prop:

```ts
interface NodeProps {
  // ...existing props...
  onReload?: (path: string) => void
}
```

`FolderTree` passes its own `onRefreshRequest` prop down as `onReload`:

```tsx
<FolderTreeNode
  // ...
  onReload={onRefreshRequest}
/>
```

### 2. Wire the sidebar reload into `App.tsx`

Pass a handler to `FolderTree` that refreshes the `FileList` when the reloaded node is the currently selected directory:

```tsx
function handleSidebarRefreshRequest(path: string) {
  if (path === selectedPath) {
    setFileListRefreshKey((k) => k + 1)
  }
}

// In JSX:
<FolderTree
  rootPath={rootPath}
  selectedPath={selectedPath}
  onSelect={setSelectedPath}
  onRefreshRequest={handleSidebarRefreshRequest}
/>
```

Replace the existing `fileListKey` state (used for post-encrypt/decrypt forced remount) with a `fileListRefreshKey` state that is passed to `FileList` as a dedicated `refreshKey` prop instead of being used as the React `key` — this avoids unmounting and remounting the component on every refresh. See §4 below for how `FileList` consumes it.

### 3. Add the Refresh button to `ModeTabBar`

Extend `ModeTabBarProps` to accept a refresh callback:

```ts
interface ModeTabBarProps {
  mode: AppMode
  onModeChange: (mode: AppMode) => void
  onRefresh: () => void   // ← new
}
```

Add the button to the right of the `TabsList`, inside the same flex container. Use the Lucide `RefreshCw` icon at the same size and style as elsewhere in the app:

```tsx
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export default function ModeTabBar({ mode, onModeChange, onRefresh }: ModeTabBarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border px-3 gap-2">
      <Tabs value={mode} onValueChange={(v) => onModeChange(v as AppMode)} className="flex-1">
        <TabsList>
          <TabsTrigger value="encrypt">Encrypt</TabsTrigger>
          <TabsTrigger value="decrypt">Decrypt</TabsTrigger>
        </TabsList>
      </Tabs>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRefresh}
              aria-label="Refresh current directory"
            >
              <RefreshCw className="size-4" />
            </Button>
          }
        />
        <TooltipContent>Refresh</TooltipContent>
      </Tooltip>
    </div>
  )
}
```

The `ModeTabBar` is already rendered inside `TooltipProvider` in `App.tsx`, so no wrapper change is needed.

### 4. Replace `fileListKey` remount with a `refreshKey` prop in `FileList`

The current `fileListKey` used as the React `key` prop on `FileList` destroys and recreates the component on each post-encrypt/decrypt operation. Replace this with a prop-driven refresh:

**In `FileListProps`:**

```ts
interface FileListProps {
  dirPath: string | null
  mode: AppMode
  refreshKey?: number      // ← new; incrementing triggers a re-read
  onNavigate: (path: string) => void
  onEncryptRequest?: (entry: FsEntry) => void
}
```

**In `FileList`:**

```ts
useEffect(() => {
  if (dirPath) read(dirPath)
}, [dirPath, read, refreshKey])   // re-read when refreshKey changes
```

**In `App.tsx`:**

```tsx
// Replace:
const [fileListKey, setFileListKey] = useState(0)
// With:
const [fileListRefreshKey, setFileListRefreshKey] = useState(0)

function refreshFileList() {
  setFileListRefreshKey((k) => k + 1)
}

// In JSX:
<FileList
  dirPath={selectedPath}
  mode={mode}
  refreshKey={fileListRefreshKey}   // no longer used as React key
  onNavigate={setSelectedPath}
  onEncryptRequest={setEncryptTarget}
/>
```

Pass `refreshFileList` to `ModeTabBar`:

```tsx
<ModeTabBar mode={mode} onModeChange={setMode} onRefresh={refreshFileList} />
```

Also update `handleEncryptSuccess` and `handleDecryptSuccess` in `App.tsx` to call `refreshFileList()` instead of bumping `fileListKey`.

> **Why:** using `key` remounts the component and resets all internal state (scroll position, loading state, any pending UI). Incrementing a `refreshKey` prop triggers a targeted re-read without discarding the component instance.

### 5. Update `ModeTabBar.test.tsx`

Add tests for the new Refresh button:

- Renders a button with `aria-label="Refresh current directory"`.
- Clicking it calls `onRefresh`.
- The Refresh button is rendered to the right of the tab list in the DOM.

### 6. Update `FolderTree.test.tsx`

Add tests for the new context menu behaviour:

- Right-clicking a folder node opens a context menu containing a "Reload" item.
- Clicking "Reload" calls `onRefreshRequest` with the node's path.
- After "Reload" is triggered, the node's children are re-fetched (mock `readDirectory` returns updated content).
- While the reload is in progress, the `Loader2` spinner is visible on the reloaded node.

---

## File Tree After This Feature

```
src/
├── App.tsx                  # fileListKey → fileListRefreshKey; onRefresh wired to ModeTabBar; onRefreshRequest wired to FolderTree
├── components/
│   ├── FolderTree.tsx       # + ContextMenu on each node; onRefreshRequest prop; handleReload
│   ├── ModeTabBar.tsx       # + onRefresh prop; Refresh button to the right of TabsList
│   └── FileList.tsx         # + refreshKey prop; useEffect dependency on refreshKey
```

No new files are introduced — all changes are additive edits to existing components.

---

## Visual Layout Reference

### Top bar with Refresh button

```
┌─────────────────────────────────────────────────────────────┐
│ [⌂] [📂]  │  home  /  Documents  /  Projects               │ ← header (40 px)
├─────────────────────────────────────────────────────────────┤
│  ▸ ENCRYPT ▂▂▂   Decrypt                        [↺]        │ ← tab bar (40 px); Refresh at right edge
├──────────────┬──────────────────────────────────────────────┤
│ sidebar tree │ file list                                    │
└──────────────┴──────────────────────────────────────────────┘
```

### Sidebar context menu on right-click

```
│ ▼ home                                                      │
│   ▼ Documents                                               │
│     ▶ Projects    ┌──────────┐                              │
│     ▶ Notes       │  Reload  │                              │
│   ▶ Downloads     └──────────┘                              │
│   ▶ Music                                                   │
```

The context menu appears on any folder node, whether expanded or collapsed.

---

## Acceptance Criteria

- [ ] Right-clicking any folder node in the sidebar tree shows a context menu with a single "Reload" item.
- [ ] Clicking "Reload" on a sidebar folder node re-fetches that folder's children; the `Loader2` spinner replaces the chevron while loading.
- [ ] When "Reload" is triggered on the currently selected directory, the file list panel also refreshes its contents.
- [ ] When "Reload" is triggered on a folder that is **not** currently selected, only the tree node is reloaded — the file list panel is not affected.
- [ ] A **Refresh** icon button (`RefreshCw`) appears to the right of the Encrypt/Decrypt tab bar, with tooltip text "Refresh".
- [ ] Clicking the Refresh button re-reads the currently selected directory and updates the file list.
- [ ] The existing `RefreshCw` button inside the file list panel toolbar continues to work and is not removed.
- [ ] All three refresh entry points (sidebar context menu, top-bar button, file list panel button) produce the same visible result: updated file list contents without reloading the entire page.
- [ ] Refreshing does not reset the scroll position of the file list panel.
- [ ] Refreshing does not collapse or reset the sidebar tree state (expanded/collapsed state of all nodes is preserved).
- [ ] `pnpm build:tauri` compiles without errors on macOS, Linux, and Windows.
- [ ] All existing `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) suites continue to pass.
