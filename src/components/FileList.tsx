import { File, FileText, Folder, Loader2, Lock, RefreshCw } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useDirectory } from '@/hooks/useDirectory'
import type { FsEntry } from '@/types/fs'

interface FileListProps {
  dirPath: string | null
  onNavigate: (path: string) => void
}

function fileIcon(entry: FsEntry) {
  if (entry.isDir) return <Folder className="size-4 shrink-0 text-blue-400" aria-hidden />
  const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'gpg' || ext === 'pgp') return <Lock className="size-4 shrink-0 text-amber-400" aria-hidden />
  if (ext === 'txt' || ext === 'md' || ext === 'log') return <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  return <File className="size-4 shrink-0 text-muted-foreground" aria-hidden />
}

function typeLabel(entry: FsEntry): string {
  if (entry.isDir) return 'Directory'
  const ext = entry.name.split('.').pop()?.toUpperCase() ?? ''
  return ext || 'File'
}

function FileListItem({ entry, onNavigate }: { entry: FsEntry; onNavigate: (path: string) => void }) {
  const handleDoubleClick = () => {
    if (entry.isDir) onNavigate(entry.path)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && entry.isDir) {
      e.preventDefault()
      onNavigate(entry.path)
    }
  }

  return (
    <div
      role="row"
      tabIndex={0}
      className="flex items-center gap-3 px-4 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground rounded cursor-default outline-none focus-visible:ring-1 focus-visible:ring-ring select-none"
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      {fileIcon(entry)}
      <span className="flex-1 truncate font-medium">{entry.name}</span>
      <span className="text-xs text-muted-foreground w-24 text-right shrink-0">{typeLabel(entry)}</span>
    </div>
  )
}

export default function FileList({ dirPath, onNavigate }: FileListProps) {
  const { entries, loading, error, read } = useDirectory()

  useEffect(() => {
    if (dirPath) read(dirPath)
  }, [dirPath, read])

  if (!dirPath) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm italic">
        Select a folder from the sidebar to browse its contents.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => read(dirPath)}
          aria-label="Reload directory"
        >
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
              <FileListItem key={entry.path} entry={entry} onNavigate={onNavigate} />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
