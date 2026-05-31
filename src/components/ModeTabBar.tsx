import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type AppMode = 'encrypt' | 'decrypt'

interface ModeTabBarProps {
  mode: AppMode
  onModeChange: (mode: AppMode) => void
}

export default function ModeTabBar({ mode, onModeChange }: ModeTabBarProps) {
  return (
    <Tabs
      value={mode}
      onValueChange={(v) => onModeChange(v as AppMode)}
      className="shrink-0"
    >
      <TabsList>
        <TabsTrigger value="encrypt">Encrypt</TabsTrigger>
        <TabsTrigger value="decrypt">Decrypt</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
