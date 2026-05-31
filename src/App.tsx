import { FolderOpen, Home } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Toaster, toast } from '@/components/ui/toast'
import EncryptDialog from '@/components/EncryptDialog'
import FileList from '@/components/FileList'
import FolderTree from '@/components/FolderTree'
import ModeTabBar, { type AppMode } from '@/components/ModeTabBar'
import PathBreadcrumb from '@/components/PathBreadcrumb'
import { getHomeDir, openDirectoryPicker } from '@/lib/platform'
import type { FsEntry } from '@/types/fs'

export default function App() {
  const [rootPath, setRootPath] = useState<string>('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [mode, setMode] = useState<AppMode>('encrypt')
  const [encryptTarget, setEncryptTarget] = useState<FsEntry | null>(null)
  const [fileListKey, setFileListKey] = useState(0)

  useEffect(() => {
    getHomeDir().then((home) => {
      setRootPath(home)
      setSelectedPath(home)
    })
  }, [])

  async function goHome() {
    const home = await getHomeDir()
    setRootPath(home)
    setSelectedPath(home)
  }

  async function pickDirectory() {
    const dir = await openDirectoryPicker(rootPath || undefined)
    if (dir) {
      setRootPath(dir)
      setSelectedPath(dir)
    }
  }

  function handleEncryptSuccess(outputPath: string) {
    setEncryptTarget(null)
    // Refresh the file list by bumping the key
    setFileListKey((k) => k + 1)
    // Show success toast
    const outputName = outputPath.split('/').pop() ?? outputPath
    const inputName = outputName.replace(/\.gpg$/, '')
    toast.add({
      title: `${inputName} encrypted → ${outputName}`,
      timeout: 4000,
    })
  }

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-panel text-panel-foreground">
        {/* Header toolbar */}
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={goHome}
                  aria-label="Go to home directory"
                >
                  <Home className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Home directory</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={pickDirectory}
                  aria-label="Open folder"
                >
                  <FolderOpen className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Open folder</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-5" />

          {selectedPath && <PathBreadcrumb path={selectedPath} onNavigate={setSelectedPath} />}
        </header>

        {/* Mode tab bar */}
        <ModeTabBar mode={mode} onModeChange={setMode} />

        {/* Body — resizable split */}
        <ResizablePanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
          <ResizablePanel
            defaultSize="200px"
            minSize={15}
            maxSize="400px"
            groupResizeBehavior="preserve-pixel-size"
            className="bg-sidebar text-sidebar-foreground"
          >
            {rootPath && (
              <FolderTree
                rootPath={rootPath}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
              />
            )}
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel>
            <FileList
              key={fileListKey}
              dirPath={selectedPath}
              mode={mode}
              onNavigate={setSelectedPath}
              onEncryptRequest={setEncryptTarget}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Encrypt dialog */}
      <EncryptDialog
        target={encryptTarget}
        onClose={() => setEncryptTarget(null)}
        onSuccess={handleEncryptSuccess}
      />

      {/* Toast notifications */}
      <Toaster />
    </TooltipProvider>
  )
}
