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
import { invokeEncryptFile } from '@/lib/platform'
import type { FsEntry } from '@/types/fs'

interface EncryptDialogProps {
  target: FsEntry | null
  onClose: () => void
  onSuccess: (outputPath: string) => void
}

function getOutputPath(inputPath: string): string {
  return `${inputPath}.gpg`
}

export default function EncryptDialog({ target, onClose, onSuccess }: EncryptDialogProps) {
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function reset() {
    setPassphrase('')
    setConfirm('')
    setShowPass(false)
    setShowConfirm(false)
    setError(null)
    setLoading(false)
  }

  function handleOpenChange(open: boolean) {
    if (!open) {
      reset()
      onClose()
    }
  }

  function validate(): string | null {
    if (!passphrase) return 'Passphrase must not be empty.'
    if (passphrase.length < 8) return 'Passphrase must be at least 8 characters.'
    if (passphrase !== confirm) return 'Passphrases do not match.'
    return null
  }

  async function handleEncrypt() {
    const validationError = validate()
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setLoading(true)
    try {
      const outputPath = getOutputPath(target!.path)
      await invokeEncryptFile({
        input_path: target!.path,
        output_path: outputPath,
        recipient_fingerprints: [],
        passphrase,
      })
      reset()
      onSuccess(outputPath)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  const outputName = target ? `${target.name}.gpg` : ''

  return (
    <Dialog open={target !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg sm:max-w-xl p-8 gap-6">
        <DialogHeader>
          <DialogTitle className="text-lg">Encrypt file</DialogTitle>
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
          {/* Passphrase field */}
          <div className="flex flex-col gap-2">
            <label htmlFor="encrypt-passphrase" className="text-sm font-medium">
              Passphrase
            </label>
            <div className="relative">
              <Input
                id="encrypt-passphrase"
                type={showPass ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase((e.target as HTMLInputElement).value)}
                className="pr-10 h-10"
                autoComplete="new-password"
                disabled={loading}
                aria-invalid={!!error}
              />
              <button
                type="button"
                aria-label={showPass ? 'Hide passphrase' : 'Show passphrase'}
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                tabIndex={-1}
              >
                {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Confirm passphrase field */}
          <div className="flex flex-col gap-2">
            <label htmlFor="encrypt-passphrase-confirm" className="text-sm font-medium">
              Confirm passphrase
            </label>
            <div className="relative">
              <Input
                id="encrypt-passphrase-confirm"
                type={showConfirm ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm((e.target as HTMLInputElement).value)}
                className="pr-10 h-10"
                autoComplete="new-password"
                disabled={loading}
                aria-invalid={!!error}
              />
              <button
                type="button"
                aria-label={
                  showConfirm ? 'Hide confirmation passphrase' : 'Show confirmation passphrase'
                }
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          {/* Inline error */}
          {error && (
            <p role="alert" className="text-sm text-destructive flex items-center gap-1.5">
              <span aria-hidden>⚠</span> {error}
            </p>
          )}
        </div>

        {/* Progress indicator */}
        {loading && (
          <div className="flex flex-col gap-2">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Encrypting"
            >
              <div className="h-full w-2/5 rounded-full bg-primary animate-indeterminate" />
            </div>
            <p className="text-xs text-muted-foreground">Encrypting file, please wait…</p>
          </div>
        )}

        <DialogFooter className="pt-2">
          <Button onClick={handleEncrypt} disabled={loading} className="order-last">
            Encrypt
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              reset()
              onClose()
            }}
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
