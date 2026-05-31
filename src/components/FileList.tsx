import { File, FileText, Folder, Loader2, Lock, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ContextMenuRoot, ContextMenuContent, ContextMenuItem } from '@/components/ui/context-menu'
import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu'
import { useDirectory } from '@/hooks/useDirectory'
import { toast } from '@/components/ui/toast'
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
  mode: AppMode
  onNavigate: (path: string) => void
  onEncryptRequest?: (entry: FsEntry) => void
  onDecryptRequest?: (entry: FsEntry) => void
}

function FileListItem({
  entry,
  disabled,
  mode,
  onNavigate,
  onEncryptRequest,
  onDecryptRequest,
}: FileListItemProps) {
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
            role="row"
            tabIndex={0}
            className={rowClasses}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
          >
            <RowContent entry={entry} />
          </div>
        }
      />
      {mode === 'encrypt' && !entry.isDir && (
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onEncryptRequest?.(entry)}>Encrypt file</ContextMenuItem>
        </ContextMenuContent>
      )}
      {mode === 'decrypt' && !entry.isDir && (
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onDecryptRequest?.(entry)}>Decrypt file</ContextMenuItem>
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

  useEffect(() => {
    if (dirPath) read(dirPath)
  }, [dirPath, read, refreshKey])

  function refresh() {
    if (dirPath) read(dirPath)
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
            <div role="table" className="py-2 px-2" aria-label="File list">
              {entries.map((entry) => (
                <FileListItem
                  key={entry.path}
                  entry={entry}
                  disabled={isDisabled(entry, mode)}
                  mode={mode}
                  onNavigate={onNavigate}
                  onEncryptRequest={onEncryptRequest}
                  onDecryptRequest={setDecryptTarget}
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
