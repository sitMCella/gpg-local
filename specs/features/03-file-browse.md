# Feature: File Browser Dashboard

Replace the placeholder `App.tsx` content with a full-screen dashboard that gives the user a navigable filesystem view: a resizable sidebar showing a collapsible folder tree on the left, and a file-list panel on the right. This is the primary UI surface from which all future encrypt/decrypt operations will be triggered.

Built with **Tailwind CSS v4**, **Shadcn UI**, and **Lucide React** icons.

---

## Motivation

Features 01 and 02 delivered the Tauri shell and the GPG backend. The application still shows the Vite/React starter placeholder. This feature replaces it with the actual product UI: a file browser that lets the user navigate their local filesystem, select files, and (in future features) initiate GPG operations on them. A sidebar folder tree is the canonical mental model for filesystem navigation — familiar from VS Code, Finder, and File Explorer.

---

## Goals

1. Replace the placeholder `App.tsx` with a two-panel dashboard layout that fills the entire Tauri window.
2. Left panel — a collapsible folder tree that lazy-loads directory contents on expand, rooted at the user's home directory by default.
3. Right panel — a file list showing the contents of the folder selected in the tree, with columns for name, type, and last-modified date.
4. A header toolbar with a breadcrumb path display and a button to open a native directory picker to re-root the tree.
5. All panels are styled exclusively with Tailwind CSS v4 utility classes, Shadcn UI components, and Lucide React icons — no custom CSS beyond the Tailwind theme setup.
6. The UI is fully navigable without a mouse (keyboard: Tab, Enter, arrow keys).
7. The layout is responsive within the window: the sidebar can be resized by dragging the divider.

---

## Out of Scope

- Encrypt/decrypt actions on selected files (tracked in a future feature).
- File search or filtering.
- File sorting options.
- Drag-and-drop file operations.
- Showing hidden files/dot-files by default (toggling hidden files is a future enhancement).
- Preview pane for file contents.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| Feature 01 complete | Tauri shell must exist; `fs:allow-read-dir`, `path:allow-home-dir` permissions needed |
| Feature 02 complete | Confirms Tauri command plumbing works; no direct dependency on GPG commands |
| Node ≥ 20, pnpm ≥ 9 | Already required by the project |

---

## Implementation Plan

### 1. Install Tailwind CSS v4

Tailwind CSS v4 uses a CSS-first configuration model — no `tailwind.config.js`. Install the Vite plugin:

```bash
pnpm add -D tailwindcss@^4 @tailwindcss/vite
```

Update `vite.config.ts` to add the plugin:

```ts
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 5173,
    strictPort: true,
    open: false,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'esnext',
  },
})
```

Replace the contents of `src/index.css` with the v4 import and CSS theme tokens:

```css
@import "tailwindcss";

@theme {
  --color-sidebar: oklch(0.145 0 0);
  --color-sidebar-foreground: oklch(0.985 0 0);
  --color-panel: oklch(0.09 0 0);
  --color-panel-foreground: oklch(0.985 0 0);
  --color-muted: oklch(0.269 0 0);
  --color-muted-foreground: oklch(0.708 0 0);
  --color-accent: oklch(0.269 0 0);
  --color-accent-foreground: oklch(0.985 0 0);
  --color-border: oklch(1 0 0 / 10%);
  --color-selection: oklch(0.488 0.243 264.376 / 30%);
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --radius: 0.375rem;
}

* {
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  margin: 0;
  background-color: var(--color-panel);
  color: var(--color-panel-foreground);
  font-family: var(--font-sans);
}
```

Delete `src/App.css` — all styling moves to Tailwind utilities.

### 2. Install Shadcn UI

Shadcn UI v2 supports Tailwind CSS v4 via its `canary` channel:

```bash
pnpm dlx shadcn@canary init
```

Answer the prompts:
- **Style:** Default
- **Base color:** Zinc
- **CSS variables:** Yes

Add the components used in this feature:

```bash
pnpm dlx shadcn@canary add resizable scroll-area separator tooltip button breadcrumb
```

This scaffolds the components under `src/components/ui/`.

### 3. Install Lucide React

```bash
pnpm add lucide-react
```

Icons used in this feature:

| Icon | Usage |
|---|---|
| `Home` | Toolbar — go to home directory |
| `FolderOpen` | Toolbar / open directory picker |
| `ChevronRight` | Collapsed folder node in tree |
| `ChevronDown` | Expanded folder node in tree |
| `Folder` | Closed folder in tree and file list |
| `FolderOpen` | Open folder in tree |
| `File` | Generic file in file list |
| `FileText` | Text file (`.txt`, `.md`) |
| `Lock` | Encrypted file (`.gpg`, `.pgp`) |
| `RefreshCw` | Reload current directory |
| `Loader2` | Spinner while reading a directory |

### 4. Update Tauri capabilities

The sidebar tree reads directory listings via the Tauri filesystem plugin. Add the required permissions to `src-tauri/capabilities/default.json`:

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
    "path:allow-app-data-dir",
    "path:allow-home-dir"
  ]
}
```

Install the Tauri path plugin (if not already present) to resolve the home directory:

```bash
cargo add tauri-plugin-path
```

Register it in `src-tauri/src/lib.rs`:

```rust
.plugin(tauri_plugin_path::init())
```

### 5. Define TypeScript types

Create `src/types/fs.ts`:

```ts
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  modifiedAt: number | null  // Unix timestamp ms, null if unavailable
}

export interface TreeNode extends FsEntry {
  children: TreeNode[] | null   // null = not yet loaded; [] = loaded, empty
  expanded: boolean
}
```

### 6. Create the filesystem hook

Create `src/hooks/useDirectory.ts`. This hook reads a directory path using the Tauri `fs` plugin and returns sorted entries (directories first, then files, both alphabetically):

```ts
import { readDir } from '@tauri-apps/plugin-fs'
import { useCallback, useState } from 'react'
import type { FsEntry } from '../types/fs'

interface State {
  entries: FsEntry[]
  loading: boolean
  error: string | null
}

export function useDirectory() {
  const [state, setState] = useState<State>({ entries: [], loading: false, error: null })

  const read = useCallback(async (path: string) => {
    setState({ entries: [], loading: true, error: null })
    try {
      const raw = await readDir(path)
      const entries: FsEntry[] = raw
        .filter((e) => e.name != null)
        .map((e) => ({
          name: e.name!,
          path: `${path}/${e.name}`,
          isDir: e.isDirectory ?? false,
          isSymlink: e.isSymlink ?? false,
          modifiedAt: null,
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      setState({ entries, loading: false, error: null })
    } catch (err) {
      setState({ entries: [], loading: false, error: String(err) })
    }
  }, [])

  return { ...state, read }
}
```

### 7. Create the `FolderTree` component

Create `src/components/FolderTree.tsx`.

The tree maintains its own internal node map as `Map<string, TreeNode>`. Expanding a node triggers a lazy `readDir` call and populates its children. Collapsing a node hides children without discarding them (so re-expanding is instant unless a refresh is triggered).

```
FolderTree
├── FolderTreeNode          (recursive)
│   ├── ChevronRight / ChevronDown  (expand toggle)
│   ├── Folder / FolderOpen icon
│   └── node label (truncated with Tooltip for long names)
└── ScrollArea              (Shadcn — sidebar scroll)
```

Key props:

```ts
interface FolderTreeProps {
  rootPath: string                          // initial root directory
  selectedPath: string | null               // currently selected folder
  onSelect: (path: string) => void          // callback when user selects a folder
}
```

Behaviour:
- Root node is auto-expanded on mount.
- Clicking a folder node selects it (fires `onSelect`) and toggles its expanded state.
- A `Loader2` spinner replaces the chevron while children are loading.
- Keyboard: `ArrowRight` expands, `ArrowLeft` collapses or moves focus to parent, `Enter` selects.
- Folders whose names start with `.` are filtered out unless `showHidden` prop is `true` (default `false`).

### 8. Create the `FileList` component

Create `src/components/FileList.tsx`.

Displays the entries inside the selected folder as a table-like list. Uses Shadcn `ScrollArea` for the scroll container.

```
FileList
├── Toolbar row
│   ├── RefreshCw button      (re-read the current directory)
│   └── entry count label
└── ScrollArea
    └── list of FileListItem rows
        ├── file-type icon (File / FileText / Lock / Folder)
        ├── name (bold)
        ├── type badge ("Directory" / extension uppercase)
        └── modified date (locale string)
```

Key props:

```ts
interface FileListProps {
  dirPath: string | null     // path to display; null = show empty state
  onNavigate: (path: string) => void  // double-click on a directory navigates into it
}
```

File-type icon mapping:

| Condition | Icon |
|---|---|
| `isDir` | `Folder` (muted blue) |
| extension `.gpg` or `.pgp` | `Lock` (amber) |
| extension `.txt`, `.md`, `.log` | `FileText` (muted) |
| everything else | `File` (muted) |

Empty state: when `dirPath` is `null` or returns zero entries, render a centered message:
> *Select a folder from the sidebar to browse its contents.*

Error state: when the read fails (permission denied, path gone), render an inline error banner using Shadcn `Alert` (destructive variant).

### 9. Create the `Breadcrumb` toolbar

Create `src/components/PathBreadcrumb.tsx`.

Splits the current path on `/` (macOS/Linux) or `\` (Windows) and renders each segment as a Shadcn `BreadcrumbItem`. Clicking a segment navigates to that ancestor directory (calls `onNavigate`). The final segment is non-clickable. Long paths are scrolled horizontally inside a `ScrollArea` with `overflow-x: auto`.

```ts
interface PathBreadcrumbProps {
  path: string
  onNavigate: (path: string) => void
}
```

### 10. Compose the dashboard in `App.tsx`

Replace all existing content in `src/App.tsx` with the dashboard layout. The layout uses Shadcn `ResizablePanelGroup` for the sidebar + main split:

```tsx
import { homeDir } from '@tauri-apps/plugin-path'
import { open } from '@tauri-apps/plugin-dialog'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './components/ui/resizable'
import { Button } from './components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './components/ui/tooltip'
import { Separator } from './components/ui/separator'
import { FolderOpen, Home, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import FolderTree from './components/FolderTree'
import FileList from './components/FileList'
import PathBreadcrumb from './components/PathBreadcrumb'

export default function App() {
  const [rootPath, setRootPath] = useState<string>('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  useEffect(() => {
    homeDir().then((home) => {
      setRootPath(home)
      setSelectedPath(home)
    })
  }, [])

  async function pickDirectory() {
    const dir = await open({ directory: true, multiple: false, defaultPath: rootPath || undefined })
    if (typeof dir === 'string') {
      setRootPath(dir)
      setSelectedPath(dir)
    }
  }

  return (
    <div className="flex h-full flex-col bg-panel text-panel-foreground">
      {/* Header toolbar */}
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => homeDir().then((h) => { setRootPath(h); setSelectedPath(h) })}>
              <Home className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Home directory</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" onClick={pickDirectory}>
              <FolderOpen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open folder</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-5" />

        {selectedPath && (
          <PathBreadcrumb path={selectedPath} onNavigate={setSelectedPath} />
        )}
      </header>

      {/* Body — resizable split */}
      <ResizablePanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        <ResizablePanel defaultSize={25} minSize={15} maxSize={50} className="bg-sidebar text-sidebar-foreground">
          {rootPath && (
            <FolderTree
              rootPath={rootPath}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
            />
          )}
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={75}>
          <FileList
            dirPath={selectedPath}
            onNavigate={setSelectedPath}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
```

Install the dialog and path plugins:

```bash
cargo add tauri-plugin-dialog tauri-plugin-path
pnpm add @tauri-apps/plugin-dialog @tauri-apps/plugin-fs @tauri-apps/plugin-path
```

Register both plugins in `src-tauri/src/lib.rs`:

```rust
.plugin(tauri_plugin_dialog::init())
.plugin(tauri_plugin_fs::init())
.plugin(tauri_plugin_path::init())
```

### 11. Update `tsconfig.app.json`

Ensure path aliases resolve correctly for the Shadcn `@/` convention:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
    "types": ["@tauri-apps/api"]
  }
}
```

Mirror the alias in `vite.config.ts`:

```ts
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // ...rest unchanged
})
```

### 12. Write unit tests

Add tests for the pure logic used by the components:

**`src/hooks/useDirectory.test.ts`** — mock `@tauri-apps/plugin-fs`, assert that entries are sorted (directories first, then files, both alphabetically) and that hidden entries (names starting with `.`) are filtered when `showHidden` is false.

**`src/components/PathBreadcrumb.test.tsx`** — assert that a POSIX path `/home/alice/Documents` renders three clickable breadcrumb items plus the final non-clickable segment, and that clicking the second item calls `onNavigate` with `/home/alice`.

**`src/components/FileList.test.tsx`** — assert that passing `dirPath={null}` renders the empty-state message and that a `.gpg` file entry renders the `Lock` icon.

---

## File Tree After This Feature

```
src/
├── App.tsx                        # ← replaced with dashboard layout
├── index.css                      # ← replaced with Tailwind v4 import + theme
├── main.tsx                       # unchanged
├── types/
│   └── fs.ts                      # FsEntry, TreeNode types
├── hooks/
│   └── useDirectory.ts            # readDir wrapper with sort + filter
├── components/
│   ├── FolderTree.tsx             # sidebar tree component
│   ├── FileList.tsx               # right-panel file list
│   ├── PathBreadcrumb.tsx         # header breadcrumb
│   └── ui/                        # Shadcn generated components
│       ├── resizable.tsx
│       ├── scroll-area.tsx
│       ├── separator.tsx
│       ├── tooltip.tsx
│       ├── button.tsx
│       └── breadcrumb.tsx
└── test/
    └── setup.ts                   # unchanged
```

---

## Visual Layout Reference

```
┌─────────────────────────────────────────────────────────┐
│ [⌂] [📂]  │  home  /  Documents  /  Projects           │ ← header (40 px)
├──────────────┬──────────────────────────────────────────┤
│ ▼ home       │ [↺ Reload]                   42 items    │
│   ▶ Desktop  │                                          │
│   ▼ Documents│ 📁 Desktop           Directory  today    │
│     ▶ Proj…  │ 📁 Documents         Directory  today    │
│     ▶ Notes  │ 📁 Downloads         Directory  today    │
│   ▶ Downloads│ 🔒 secret.txt.gpg    GPG        Mon      │
│   ▶ Music    │ 📄 report.md         MD         Sun      │
│   ▶ Pictures │ 📄 notes.txt         TXT        Sat      │
│              │ 📄 budget.xlsx       XLSX       2 wk ago │
│              │                                          │
│ ◀────drag────▶                                          │
└──────────────┴──────────────────────────────────────────┘
```

---

## Security Considerations

- **Path traversal**: the component only reads directories the user navigates to explicitly. No glob or recursive traversal runs without user interaction.
- **Read-only**: this feature makes no filesystem writes. The Tauri capability grants only `fs:allow-read-dir` and `path:allow-home-dir`.
- **Symlinks**: `isSymlink` is surfaced in `FsEntry` but symlinks are treated as their resolved type (file or directory) for display purposes. The app does not follow symlinks to read outside the user-visible tree.

---

## Acceptance Criteria

- [ ] `pnpm dev` opens in the browser and shows the two-panel dashboard (no Tauri required for UI development).
- [ ] `pnpm dev:tauri` opens the native window; the sidebar tree renders the user's home directory on first launch.
- [ ] Clicking a folder in the sidebar expands it and populates the right panel with its contents.
- [ ] The breadcrumb in the toolbar reflects the selected folder; clicking a segment navigates to it.
- [ ] The "Open folder" button opens a native directory picker and re-roots both panels to the chosen directory.
- [ ] The sidebar panel can be resized by dragging the divider handle between min 15% and max 50% of window width.
- [ ] Files with `.gpg` or `.pgp` extensions display the `Lock` icon in the file list.
- [ ] Navigating to a directory with no readable contents shows the empty-state message, not a crash.
- [ ] Attempting to expand a directory with insufficient permissions shows an inline error without crashing the app.
- [ ] All existing `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright) suites continue to pass.
- [ ] `pnpm build:tauri` compiles without errors on macOS, Linux, and Windows.
