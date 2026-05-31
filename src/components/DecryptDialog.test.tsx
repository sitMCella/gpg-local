import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import DecryptDialog from './DecryptDialog'
import type { FsEntry } from '@/types/fs'

vi.mock('@/lib/platform', () => ({
  invokeDecryptFile: vi.fn().mockResolvedValue(undefined),
}))

const mockTarget: FsEntry = {
  name: 'report.md.gpg',
  path: '/home/user/report.md.gpg',
  isDir: false,
  isSymlink: false,
  modifiedAt: null,
}

describe('DecryptDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders file name and computed output path when target is set', () => {
    render(<DecryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.getByText('report.md.gpg')).toBeInTheDocument()
    expect(screen.getByText('report.md')).toBeInTheDocument()
  })

  it('does not render when target is null', () => {
    render(<DecryptDialog target={null} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.queryByText('Decrypt file')).not.toBeInTheDocument()
  })

  it('shows "must not be empty" error when submitting with blank passphrase', async () => {
    const user = userEvent.setup()
    render(<DecryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /^decrypt$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Passphrase must not be empty.')
  })

  it('does not render a confirmation passphrase field', () => {
    render(<DecryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.queryByLabelText(/confirm/i)).not.toBeInTheDocument()
    // Only one <input> element (no confirm field)
    expect(document.querySelectorAll('input')).toHaveLength(1)
  })

  it('calls onSuccess when decryption succeeds', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<DecryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={onSuccess} />)

    await user.type(screen.getByLabelText(/^passphrase$/i), 'correctpassword')
    await user.click(screen.getByRole('button', { name: /^decrypt$/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('/home/user/report.md')
    })
  })

  it('shows backend error inline without closing when decryption fails', async () => {
    const user = userEvent.setup()
    const { invokeDecryptFile } = await import('@/lib/platform')
    ;(invokeDecryptFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('no matching secret key found')
    )

    render(<DecryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.type(screen.getByLabelText(/^passphrase$/i), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /^decrypt$/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Decryption failed. Check your passphrase and try again.')
    expect(alert).toHaveTextContent('no matching secret key found')
    // Dialog stays open
    expect(screen.getByLabelText(/^passphrase$/i)).toBeInTheDocument()
  })

  it('calls onClose when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<DecryptDialog target={mockTarget} onClose={onClose} onSuccess={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalled()
  })

  it('Decrypt and Cancel buttons are disabled and progress bar shown while loading', async () => {
    const user = userEvent.setup()
    const { invokeDecryptFile } = await import('@/lib/platform')
    ;(invokeDecryptFile as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {}) // never resolves
    )

    render(<DecryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.type(screen.getByLabelText(/^passphrase$/i), 'mypassword')
    await user.click(screen.getByRole('button', { name: /^decrypt$/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^decrypt$/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled()
      expect(screen.getByRole('progressbar')).toBeInTheDocument()
      expect(screen.getByText(/decrypting file, please wait/i)).toBeInTheDocument()
    })
  })

  it('Decrypt button label does not change while loading', async () => {
    const user = userEvent.setup()
    const { invokeDecryptFile } = await import('@/lib/platform')
    ;(invokeDecryptFile as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {})
    )

    render(<DecryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.type(screen.getByLabelText(/^passphrase$/i), 'mypassword')
    await user.click(screen.getByRole('button', { name: /^decrypt$/i }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^decrypt$/i })).toBeInTheDocument()
    })
  })

  it('toggles passphrase visibility when the eye icon is clicked', async () => {
    const user = userEvent.setup()
    render(<DecryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const passInput = screen.getByLabelText(/^passphrase$/i)
    expect(passInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: /show passphrase/i }))
    expect(passInput).toHaveAttribute('type', 'text')

    await user.click(screen.getByRole('button', { name: /hide passphrase/i }))
    expect(passInput).toHaveAttribute('type', 'password')
  })

  it('clears passphrase when dialog reopens with a new target', async () => {
    const user = userEvent.setup()

    function Wrapper({ target }: { target: typeof mockTarget | null }) {
      return <DecryptDialog target={target} onClose={vi.fn()} onSuccess={vi.fn()} />
    }

    const { rerender } = render(<Wrapper target={mockTarget} />)

    await user.type(screen.getByLabelText(/^passphrase$/i), 'somepass')
    expect(screen.getByLabelText(/^passphrase$/i)).toHaveValue('somepass')

    rerender(<Wrapper target={null} />)
    rerender(<Wrapper target={mockTarget} />)

    expect(screen.getByLabelText(/^passphrase$/i)).toHaveValue('')
  })

  it('clears error when dialog reopens after a backend failure', async () => {
    const user = userEvent.setup()
    const { invokeDecryptFile } = await import('@/lib/platform')
    ;(invokeDecryptFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('no matching secret key found')
    )

    function Wrapper({ target }: { target: typeof mockTarget | null }) {
      return <DecryptDialog target={target} onClose={vi.fn()} onSuccess={vi.fn()} />
    }

    const { rerender } = render(<Wrapper target={mockTarget} />)

    // Trigger a backend error
    await user.type(screen.getByLabelText(/^passphrase$/i), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /^decrypt$/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    // Close and reopen the dialog
    rerender(<Wrapper target={null} />)
    rerender(<Wrapper target={mockTarget} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/^passphrase$/i)).toHaveValue('')
  })

  it('calls onClose when the dialog X button closes the dialog', async () => {
    const onClose = vi.fn()
    render(<DecryptDialog target={mockTarget} onClose={onClose} onSuccess={vi.fn()} />)

    // Shadcn Dialog renders a close button with an accessible label
    const closeButton = screen.getByRole('button', { name: /close/i })
    closeButton.click()

    expect(onClose).toHaveBeenCalled()
  })

  it('resets showPassphrase to false when dialog reopens with a new target', async () => {
    const user = userEvent.setup()

    function Wrapper({ target }: { target: typeof mockTarget | null }) {
      return <DecryptDialog target={target} onClose={vi.fn()} onSuccess={vi.fn()} />
    }

    const { rerender } = render(<Wrapper target={mockTarget} />)

    // Reveal the passphrase
    await user.click(screen.getByRole('button', { name: /show passphrase/i }))
    expect(screen.getByLabelText(/^passphrase$/i)).toHaveAttribute('type', 'text')

    // Close and reopen the dialog
    rerender(<Wrapper target={null} />)
    rerender(<Wrapper target={mockTarget} />)

    // Passphrase field should be hidden again after reopening
    expect(screen.getByLabelText(/^passphrase$/i)).toHaveAttribute('type', 'password')
  })
})
