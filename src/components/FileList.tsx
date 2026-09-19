import { File, FileText, Folder, Loader2, Lock, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ContextMenuRoot, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'
import { useDirectory } from '@/hooks/useDirectory'
import { toast } from '@/components/ui/toast'
import { openFilePath, revealInFileExplorer } from '@/lib/platform'
import DecryptDialog from '@/components/DecryptDialog'
import type { FsEntry } from '@/types/fs'
import type { AppMode } from '@/components/ModeTabBar'

interface FileListProps {
  dirPath: string | null
  mode: AppMode
  refreshKey?: number
  onNavigate: (path: string) => void
  onEncryptRequest?: (entry: FsEntry) => void
}

function isEncryptedFile(entry: FsEntry): boolean {
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  return ext === 'gpg' || ext === 'pgp'
}

const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'rtf',
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

function isDisabled(entry: FsEntry, mode: AppMode): boolean {
  if (entry.isDir) return false
  if (mode === 'encrypt') return isEncryptedFile(entry)
  if (mode === 'decrypt') return !isEncryptedFile(entry)
  return false
}

function fileIcon(entry: FsEntry) {
  if (entry.isDir) return <Folder className="size-4 shrink-0 text-blue-400" aria-hidden />
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'gpg' || ext === 'pgp')
    return <Lock className="size-4 shrink-0 text-amber-400" aria-hidden />
  if (ext === 'txt' || ext === 'md' || ext === 'log')
    return <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  return <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function typeLabel(entry: FsEntry): string {
  if (entry.isDir) return 'Directory'
  const ext = entry.name.split('.').pop()?.toUpperCase() ?? ''
  return ext || 'File'
}

function RowContent({ entry }: { entry: FsEntry }) {
  return (
    <>
      {fileIcon(entry)}
      <span className="flex-1 truncate font-medium">{entry.name}</span>
      <span className="text-xs text-muted-foreground w-24 text-right shrink-0">
        {typeLabel(entry)}
      </span>
    </>
  )
}

interface FileListItemProps {
  entry: FsEntry
  disabled: boolean
  selected: boolean
  mode: AppMode
  rowRef: (path: string, node: HTMLDivElement | null) => void
  onSelect: (entry: FsEntry) => void
  onNavigate: (path: string) => void
  onEncryptRequest?: (entry: FsEntry) => void
  onDecryptRequest?: (entry: FsEntry) => void
  onOpenRequest?: (entry: FsEntry) => void
  onOpenInExplorerRequest?: (entry: FsEntry) => void
}

function FileListItem({
  entry,
  disabled,
  selected,
  mode,
  rowRef,
  onSelect,
  onNavigate,
  onEncryptRequest,
  onDecryptRequest,
  onOpenRequest,
  onOpenInExplorerRequest,
}: FileListItemProps) {
  const handleClick = () => {
    if (!disabled) onSelect(entry)
  }

  const handleDoubleClick = () => {
    if (!disabled && entry.isDir) onNavigate(entry.path)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!disabled && (e.key === 'Enter' || e.key === ' ') && entry.isDir) {
      e.preventDefault()
      onNavigate(entry.path)
    }
  }

  const rowClasses = [
    'flex items-center gap-3 px-4 py-1.5 text-sm rounded select-none outline-none',
    disabled
      ? 'opacity-40 cursor-not-allowed'
      : selected
        ? 'bg-accent text-accent-foreground cursor-default focus-visible:ring-1 focus-visible:ring-ring'
        : 'hover:bg-accent hover:text-accent-foreground cursor-default focus-visible:ring-1 focus-visible:ring-ring',
  ].join(' ')

  if (disabled) {
    return (
      <div role="row" aria-disabled="true" tabIndex={-1} className={rowClasses}>
        <RowContent entry={entry} />
      </div>
    )
  }

  return (
    <ContextMenuRoot>
      <ContextMenuPrimitive.Trigger
        render={
          <div
            ref={(node) => rowRef(entry.path, node)}
            role="row"
            aria-selected={selected}
            tabIndex={0}
            className={rowClasses}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
          >
            <RowContent entry={entry} />
          </div>
        }
      />
      {mode === 'encrypt' && !entry.isDir && (
        <ContextMenuContent>
          {isTextFile(entry) && (
            <ContextMenuItem onClick={() => onOpenRequest?.(entry)}>Open file</ContextMenuItem>
          )}
          <ContextMenuItem onClick={() => onEncryptRequest?.(entry)}>Encrypt file</ContextMenuItem>
          <ContextMenuItem onClick={() => onOpenInExplorerRequest?.(entry)}>
            Open in file explorer
          </ContextMenuItem>
        </ContextMenuContent>
      )}
      {mode === 'decrypt' && !entry.isDir && (
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onDecryptRequest?.(entry)}>Decrypt file</ContextMenuItem>
          <ContextMenuItem onClick={() => onOpenInExplorerRequest?.(entry)}>
            Open in file explorer
          </ContextMenuItem>
        </ContextMenuContent>
      )}
      {entry.isDir && (
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onOpenInExplorerRequest?.(entry)}>
            Open in file explorer
          </ContextMenuItem>
        </ContextMenuContent>
      )}
    </ContextMenuRoot>
  )
}

export default function FileList({
  dirPath,
  mode,
  refreshKey,
  onNavigate,
  onEncryptRequest,
}: FileListProps) {
  const { entries, loading, error, read } = useDirectory()
  const [decryptTarget, setDecryptTarget] = useState<FsEntry | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const rowNodes = useRef(new Map<string, HTMLDivElement>())
  const typeahead = useRef({ buffer: '', time: 0 })

  const dirKey = `${dirPath ?? ''}:${refreshKey ?? 0}`
  const [prevDirKey, setPrevDirKey] = useState(dirKey)
  if (dirKey !== prevDirKey) {
    setPrevDirKey(dirKey)
    setSelectedPath(null)
  }

  useEffect(() => {
    if (dirPath) read(dirPath)
    typeahead.current = { buffer: '', time: 0 }
  }, [dirPath, read, refreshKey])

  function setRowNode(path: string, node: HTMLDivElement | null) {
    if (node) rowNodes.current.set(path, node)
    else rowNodes.current.delete(path)
  }

  function selectEntry(entry: FsEntry) {
    setSelectedPath(entry.path)
    rowNodes.current.get(entry.path)?.focus()
  }

  const TYPEAHEAD_TIMEOUT_MS = 800

  function handleTypeahead(e: React.KeyboardEvent) {
    const char = e.key
    if (char.length !== 1 || char === ' ' || e.ctrlKey || e.metaKey || e.altKey) return

    e.preventDefault()

    const lowerChar = char.toLowerCase()
    const state = typeahead.current
    const now = Date.now()
    if (now - state.time > TYPEAHEAD_TIMEOUT_MS) {
      state.buffer = lowerChar
    } else {
      state.buffer += lowerChar
    }
    state.time = now

    const singleCharCycle = state.buffer.split('').every((c) => c === state.buffer[0])
    const query = singleCharCycle ? state.buffer[0] : state.buffer

    const selectable = entries.filter((entry) => !isDisabled(entry, mode))
    const matches = selectable.filter((entry) => entry.name.toLowerCase().startsWith(query))
    if (matches.length === 0) return

    const currentIndex = matches.findIndex((m) => m.path === selectedPath)
    const next =
      singleCharCycle && currentIndex >= 0
        ? matches[(currentIndex + 1) % matches.length]
        : (matches[currentIndex] ?? matches[0])
    selectEntry(next)
  }

  function refresh() {
    if (dirPath) read(dirPath)
  }

  async function handleOpenRequest(entry: FsEntry) {
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

  async function handleOpenInExplorer(entry: FsEntry) {
    try {
      await revealInFileExplorer(entry.path)
    } catch (err) {
      toast.add({
        title: `Could not open ${entry.name}`,
        description: String(err),
        timeout: 4000,
      })
    }
  }

  function handleDecryptSuccess(outputPath: string) {
    setDecryptTarget(null)
    refresh()
    const outputName = outputPath.split('/').pop() ?? outputPath
    const inputName = `${outputName}.gpg`
    toast.add({
      title: `${inputName} decrypted → ${outputName}`,
      timeout: 4000,
    })
  }

  if (!dirPath) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm italic">
        Select a folder from the sidebar to browse its contents.
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
          <Button variant="ghost" size="icon-sm" onClick={refresh} aria-label="Reload directory">
            <RefreshCw className="size-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {loading ? 'Loading…' : `${entries.length} item${entries.length !== 1 ? 's' : ''}`}
          </span>
        </div>

        {error && (
          <div
            role="alert"
            className="m-4 rounded border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {loading && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm italic">
            Select a folder from the sidebar to browse its contents.
          </div>
        )}

        {!loading && entries.length > 0 && (
          <ScrollArea className="flex-1">
            <div
              role="table"
              className="py-2 px-2"
              aria-label="File list"
              onKeyDown={handleTypeahead}
            >
              {entries.map((entry) => (
                <FileListItem
                  key={entry.path}
                  entry={entry}
                  disabled={isDisabled(entry, mode)}
                  selected={entry.path === selectedPath}
                  mode={mode}
                  rowRef={setRowNode}
                  onSelect={selectEntry}
                  onNavigate={onNavigate}
                  onEncryptRequest={onEncryptRequest}
                  onDecryptRequest={setDecryptTarget}
                  onOpenRequest={handleOpenRequest}
                  onOpenInExplorerRequest={handleOpenInExplorer}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      <DecryptDialog
        key={decryptTarget?.path ?? ''}
        target={decryptTarget}
        onClose={() => setDecryptTarget(null)}
        onSuccess={handleDecryptSuccess}
      />
    </>
  )
}
