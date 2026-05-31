import { Input as InputPrimitive } from '@base-ui/react/input'
import { cn } from '@/lib/utils'

export type InputProps = InputPrimitive.Props

function Input({ className, ...props }: InputProps) {
  return (
    <InputPrimitive
      data-slot="input"
      className={cn(
        'flex h-9 w-full rounded-md border border-border bg-input px-3 py-1 text-sm text-foreground',
        'placeholder:text-muted-foreground',
        'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Input }
