import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { invokeDecryptFile } from '@/lib/platform'
import { decryptedOutputPath } from '@/utils/decryptedOutputPath'
import type { FsEntry } from '@/types/fs'

interface DecryptDialogProps {
  target: FsEntry | null
  onClose: () => void
  onSuccess: (outputPath: string) => void
}

export default function DecryptDialog({ target, onClose, onSuccess }: DecryptDialogProps) {
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleOpenChange(open: boolean) {
    if (!open) {
      onClose()
    }
  }

  async function handleDecrypt() {
    if (!passphrase) {
      setError('Passphrase must not be empty.')
      return
    }

    setError(null)
    setLoading(true)
    try {
      const outputPath = decryptedOutputPath(target!.path)
      await invokeDecryptFile({
        input_path: target!.path,
        output_path: outputPath,
        passphrase,
      })
      onSuccess(outputPath)
    } catch (err) {
      const raw = String(err)
      setError(`Decryption failed. Check your passphrase and try again. (${raw})`)
    } finally {
      setLoading(false)
    }
  }

  const outputName = target ? decryptedOutputPath(target.name) : ''

  return (
    <Dialog open={target !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl p-8 gap-6">
        <DialogHeader>
          <DialogTitle className="text-lg">Decrypt file</DialogTitle>
          {target && (
            <div className="text-sm text-muted-foreground grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 pt-1">
              <span className="shrink-0">File:</span>
              <span className="font-medium text-foreground truncate">{target.name}</span>
              <span className="shrink-0">Output:</span>
              <span className="font-medium text-foreground truncate">{outputName}</span>
            </div>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="decrypt-passphrase" className="text-sm font-medium">
              Passphrase
            </label>
            <div className="relative">
              <Input
                id="decrypt-passphrase"
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !loading) handleDecrypt() }}
                className="pr-10 h-10"
                autoComplete="current-password"
                disabled={loading}
                aria-invalid={!!error}
              />
              <button
                type="button"
                aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                onClick={() => setShowPassphrase((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                tabIndex={-1}
              >
                {showPassphrase ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive flex items-start gap-1.5">
              <span aria-hidden>⚠</span> {error}
            </p>
          )}
        </div>

        {loading && (
          <div className="flex flex-col gap-2">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Decrypting"
            >
              <div className="h-full w-2/5 rounded-full bg-primary animate-indeterminate" />
            </div>
            <p className="text-xs text-muted-foreground">Decrypting file, please wait…</p>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button onClick={handleDecrypt} disabled={loading} className="order-last">
            Decrypt
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={loading}
            className="order-first"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
