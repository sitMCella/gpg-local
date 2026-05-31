import { Toast as ToastPrimitive } from '@base-ui/react/toast'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Singleton manager — call toast.add() from anywhere in the app
export const toast = ToastPrimitive.createToastManager()

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return (
    <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          toast={t}
          className={cn(
            'flex items-start gap-3 rounded-lg border border-border bg-sidebar px-4 py-3 shadow-lg text-sidebar-foreground text-sm',
            'data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2 data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right-full data-[state=closed]:fade-out-0'
          )}
        >
          <ToastPrimitive.Content className="flex-1 min-w-0">
            {t.title && (
              <ToastPrimitive.Title className="font-medium leading-snug truncate">
                {t.title}
              </ToastPrimitive.Title>
            )}
            {t.description && (
              <ToastPrimitive.Description className="text-xs text-muted-foreground mt-0.5 truncate">
                {t.description}
              </ToastPrimitive.Description>
            )}
          </ToastPrimitive.Content>
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="shrink-0 rounded-sm opacity-60 hover:opacity-100 outline-none focus-visible:ring-1 focus-visible:ring-ring transition-opacity mt-0.5"
          >
            <X className="size-3.5" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
    </ToastPrimitive.Viewport>
  )
}

export function Toaster() {
  return (
    <ToastPrimitive.Provider toastManager={toast}>
      <ToastList />
    </ToastPrimitive.Provider>
  )
}
