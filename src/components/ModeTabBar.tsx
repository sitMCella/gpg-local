import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type AppMode = 'encrypt' | 'decrypt'

interface ModeTabBarProps {
  mode: AppMode
  onModeChange: (mode: AppMode) => void
  onRefresh: () => void
}

export default function ModeTabBar({ mode, onModeChange, onRefresh }: ModeTabBarProps) {
  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border px-3 gap-2">
      <Tabs value={mode} onValueChange={(v) => onModeChange(v as AppMode)} className="flex-1">
        <TabsList>
          <TabsTrigger value="encrypt">Encrypt</TabsTrigger>
          <TabsTrigger value="decrypt">Decrypt</TabsTrigger>
        </TabsList>
      </Tabs>

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRefresh}
        aria-label="Refresh current directory"
      >
        <RefreshCw className="size-4" />
      </Button>
    </div>
  )
}
