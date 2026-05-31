import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import { cn } from '@/lib/utils'

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col', className)} {...props} />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('flex h-10 items-center border-b border-border px-3 gap-1', className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        'relative h-full px-4 text-sm font-medium text-muted-foreground transition-colors',
        'hover:text-foreground',
        'outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'data-[active]:text-foreground data-[active]:font-semibold',
        'after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[3px] after:rounded-t after:bg-primary after:scale-x-0 after:transition-transform',
        'data-[active]:after:scale-x-100',
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn('flex-1 overflow-hidden', className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
