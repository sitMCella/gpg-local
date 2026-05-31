import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import EncryptDialog from './EncryptDialog'
import type { FsEntry } from '@/types/fs'

vi.mock('@/lib/platform', () => ({
  invokeEncryptFile: vi.fn().mockResolvedValue(undefined),
}))

const mockTarget: FsEntry = {
  name: 'report.md',
  path: '/home/user/report.md',
  isDir: false,
  isSymlink: false,
  modifiedAt: null,
}

describe('EncryptDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders file name and computed output path when target is set', () => {
    render(
      <EncryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />
    )

    expect(screen.getByText('report.md')).toBeInTheDocument()
    expect(screen.getByText('report.md.gpg')).toBeInTheDocument()
  })

  it('does not render when target is null', () => {
    render(<EncryptDialog target={null} onClose={vi.fn()} onSuccess={vi.fn()} />)

    expect(screen.queryByText('Encrypt file')).not.toBeInTheDocument()
  })

  it('shows "must not be empty" error when submitting with blank passphrase', async () => {
    const user = userEvent.setup()
    render(<EncryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /^encrypt$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Passphrase must not be empty.')
  })

  it('shows "at least 8 characters" error when passphrase is too short', async () => {
    const user = userEvent.setup()
    render(<EncryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const passInput = screen.getByLabelText(/^passphrase$/i)
    const confirmInput = screen.getByLabelText(/confirm passphrase/i)
    await user.type(passInput, 'short')
    await user.type(confirmInput, 'short')
    await user.click(screen.getByRole('button', { name: /^encrypt$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Passphrase must be at least 8 characters.')
  })

  it('shows "do not match" error when passphrase fields differ', async () => {
    const user = userEvent.setup()
    render(<EncryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const passInput = screen.getByLabelText(/^passphrase$/i)
    const confirmInput = screen.getByLabelText(/confirm passphrase/i)
    await user.type(passInput, 'password123')
    await user.type(confirmInput, 'differentpass')
    await user.click(screen.getByRole('button', { name: /^encrypt$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Passphrases do not match.')
  })

  it('calls onSuccess when encryption succeeds', async () => {
    const user = userEvent.setup()
    const onSuccess = vi.fn()
    render(<EncryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={onSuccess} />)

    const passInput = screen.getByLabelText(/^passphrase$/i)
    const confirmInput = screen.getByLabelText(/confirm passphrase/i)
    await user.type(passInput, 'securepassword')
    await user.type(confirmInput, 'securepassword')
    await user.click(screen.getByRole('button', { name: /^encrypt$/i }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith('/home/user/report.md.gpg')
    })
  })

  it('shows backend error inline without closing when encryption fails', async () => {
    const user = userEvent.setup()
    const { invokeEncryptFile } = await import('@/lib/platform')
    ;(invokeEncryptFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Permission denied: cannot write to /home/user')
    )

    render(<EncryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const passInput = screen.getByLabelText(/^passphrase$/i)
    const confirmInput = screen.getByLabelText(/confirm passphrase/i)
    await user.type(passInput, 'securepassword')
    await user.type(confirmInput, 'securepassword')
    await user.click(screen.getByRole('button', { name: /^encrypt$/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Permission denied')
    // Dialog stays open
    expect(screen.getByLabelText(/^passphrase$/i)).toBeInTheDocument()
  })

  it('calls onClose when Cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<EncryptDialog target={mockTarget} onClose={onClose} onSuccess={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalled()
  })

  it('toggles passphrase visibility when the eye icon is clicked', async () => {
    const user = userEvent.setup()
    render(<EncryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const passInput = screen.getByLabelText(/^passphrase$/i)
    expect(passInput).toHaveAttribute('type', 'password')

    const toggleBtn = screen.getByRole('button', { name: /show passphrase/i })
    await user.click(toggleBtn)

    expect(passInput).toHaveAttribute('type', 'text')

    const hideBtn = screen.getByRole('button', { name: /hide passphrase/i })
    await user.click(hideBtn)

    expect(passInput).toHaveAttribute('type', 'password')
  })

  it('Encrypt button is disabled while loading', async () => {
    const user = userEvent.setup()
    // Make the invoke hang so we can observe the loading state
    const { invokeEncryptFile } = await import('@/lib/platform')
    ;(invokeEncryptFile as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise(() => {}) // never resolves
    )

    render(<EncryptDialog target={mockTarget} onClose={vi.fn()} onSuccess={vi.fn()} />)

    const passInput = screen.getByLabelText(/^passphrase$/i)
    const confirmInput = screen.getByLabelText(/confirm passphrase/i)
    await user.type(passInput, 'securepassword')
    await user.type(confirmInput, 'securepassword')

    await user.click(screen.getByRole('button', { name: /^encrypt$/i }))

    // After click, the button should be disabled (shows spinner)
    await waitFor(() => {
      const encryptBtn = screen.getByRole('button', { name: /encrypting/i })
      expect(encryptBtn).toBeDisabled()
    })
  })
})
