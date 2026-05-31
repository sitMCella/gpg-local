import { FolderOpen, Home } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import FileList from '@/components/FileList'
import FolderTree from '@/components/FolderTree'
import PathBreadcrumb from '@/components/PathBreadcrumb'
import { getHomeDir, openDirectoryPicker } from '@/lib/platform'

export default function App() {
  const [rootPath, setRootPath] = useState<string>('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

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

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-panel text-panel-foreground">
        {/* Header toolbar */}
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={goHome} aria-label="Go to home directory">
                  <Home className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Home directory</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button variant="ghost" size="icon-sm" onClick={pickDirectory} aria-label="Open folder">
                  <FolderOpen className="size-4" />
                </Button>
              }
            />
            <TooltipContent>Open folder</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-5" />

          {selectedPath && (
            <PathBreadcrumb path={selectedPath} onNavigate={setSelectedPath} />
          )}
        </header>

        {/* Body — resizable split */}
        <ResizablePanelGroup orientation="horizontal" className="flex-1 overflow-hidden">
          <ResizablePanel
            defaultSize={25}
            minSize={15}
            maxSize={50}
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

          <ResizablePanel defaultSize={75}>
            <FileList dirPath={selectedPath} onNavigate={setSelectedPath} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  )
}
