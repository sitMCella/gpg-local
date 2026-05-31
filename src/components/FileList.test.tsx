import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import FileList from './FileList'

vi.mock('@/lib/platform', () => ({
  readDirectory: vi.fn().mockResolvedValue([]),
}))

describe('FileList', () => {
  beforeEach(async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  it('shows empty-state message when dirPath is null', () => {
    render(<FileList dirPath={null} mode="encrypt" onNavigate={vi.fn()} />)

    expect(
      screen.getByText('Select a folder from the sidebar to browse its contents.')
    ).toBeInTheDocument()
  })

  it('renders a Lock icon for .gpg files', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'secret.txt.gpg', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)

    const lockIcon = await screen.findByText('secret.txt.gpg')
    const row = lockIcon.closest('[role="row"]')
    expect(row).toBeInTheDocument()

    const svg = row!.querySelector('svg')
    expect(svg).toBeInTheDocument()
  })

  it('renders a Lock icon for .pgp files', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'encrypted.pgp', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)

    expect(await screen.findByText('encrypted.pgp')).toBeInTheDocument()
  })

  it('shows item count after loading', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'file1.txt', isDirectory: false, isSymlink: false },
      { name: 'file2.txt', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)

    expect(await screen.findByText('2 items')).toBeInTheDocument()
  })

  it('shows empty-state message when dirPath is set but directory has no entries', async () => {
    render(<FileList dirPath="/empty/dir" mode="encrypt" onNavigate={vi.fn()} />)
    expect(
      await screen.findByText('Select a folder from the sidebar to browse its contents.')
    ).toBeInTheDocument()
  })

  it('shows an inline error alert when the directory cannot be read', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'))

    render(<FileList dirPath="/restricted" mode="encrypt" onNavigate={vi.fn()} />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/Permission denied/)).toBeInTheDocument()
  })

  it('calls onNavigate when double-clicking a directory entry', async () => {
    const user = userEvent.setup()
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
    ])
    const onNavigate = vi.fn()
    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={onNavigate} />)

    const row = await screen.findByRole('row')
    await user.dblClick(row)

    expect(onNavigate).toHaveBeenCalledWith('/home/user/Documents')
  })

  it('calls onNavigate when pressing Enter on a directory row', async () => {
    const user = userEvent.setup()
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'Downloads', isDirectory: true, isSymlink: false },
    ])
    const onNavigate = vi.fn()
    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={onNavigate} />)

    const row = await screen.findByRole('row')
    row.focus()
    await user.keyboard('{Enter}')

    expect(onNavigate).toHaveBeenCalledWith('/home/user/Downloads')
  })

  // ---- Feature 04 additions ----

  it('in encrypt mode, a .gpg file row has cursor-not-allowed class', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'secret.gpg', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row.className).toContain('cursor-not-allowed')
  })

  it('in encrypt mode, a .gpg file row has aria-disabled=true', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'archive.pgp', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row).toHaveAttribute('aria-disabled', 'true')
  })

  it('in encrypt mode, a non-.gpg file row calls onEncryptRequest on right-click context menu', async () => {
    const user = userEvent.setup()
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'report.md', isDirectory: false, isSymlink: false },
    ])
    const onEncryptRequest = vi.fn()
    render(
      <FileList
        dirPath="/home/user"
        mode="encrypt"
        onNavigate={vi.fn()}
        onEncryptRequest={onEncryptRequest}
      />
    )

    const row = await screen.findByRole('row')
    // Right-click to open context menu
    await user.pointer({ target: row, keys: '[MouseRight]' })

    const encryptItem = await screen.findByText('Encrypt file')
    await user.click(encryptItem)

    expect(onEncryptRequest).toHaveBeenCalledWith(expect.objectContaining({ name: 'report.md' }))
  })

  it('in encrypt mode, a .gpg file row has opacity-40 class', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'secret.gpg', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row.className).toContain('opacity-40')
  })

  it('in encrypt mode, a .pgp file row has cursor-not-allowed class', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'archive.pgp', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row.className).toContain('cursor-not-allowed')
  })

  it('in encrypt mode, directory rows are not disabled', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row).not.toHaveAttribute('aria-disabled', 'true')
    expect(row.className).not.toContain('cursor-not-allowed')
  })

  it('in encrypt mode, a .gpg file row does not call onEncryptRequest on right-click', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'secret.gpg', isDirectory: false, isSymlink: false },
    ])
    const onEncryptRequest = vi.fn()
    render(
      <FileList
        dirPath="/home/user"
        mode="encrypt"
        onNavigate={vi.fn()}
        onEncryptRequest={onEncryptRequest}
      />
    )

    // Wait for the row to appear
    await screen.findByRole('row')
    // The context menu item should not be present because the row is disabled
    expect(screen.queryByText('Encrypt file')).not.toBeInTheDocument()
    expect(onEncryptRequest).not.toHaveBeenCalled()
  })

  // ---- Feature 05 additions ----

  it('in decrypt mode, a .gpg file row does not have cursor-not-allowed', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'secret.gpg', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="decrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row.className).not.toContain('cursor-not-allowed')
    expect(row).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('in decrypt mode, a .gpg file row shows "Decrypt file" context menu item on right-click', async () => {
    const user = userEvent.setup()
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'report.md.gpg', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="decrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    await user.pointer({ target: row, keys: '[MouseRight]' })

    expect(await screen.findByText('Decrypt file')).toBeInTheDocument()
  })

  it('in decrypt mode, a .txt file row has cursor-not-allowed', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'notes.txt', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="decrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row.className).toContain('cursor-not-allowed')
    expect(row).toHaveAttribute('aria-disabled', 'true')
  })

  it('in decrypt mode, a .txt file row does not show context menu on right-click', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'notes.txt', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="decrypt" onNavigate={vi.fn()} />)

    await screen.findByRole('row')
    expect(screen.queryByText('Decrypt file')).not.toBeInTheDocument()
  })

  it('in decrypt mode, a directory row does not have cursor-not-allowed', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="decrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row.className).not.toContain('cursor-not-allowed')
    expect(row).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('in decrypt mode, a .pgp file row does not have cursor-not-allowed and shows "Decrypt file" on right-click', async () => {
    const user = userEvent.setup()
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'archive.pgp', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" mode="decrypt" onNavigate={vi.fn()} />)

    const row = await screen.findByRole('row')
    expect(row.className).not.toContain('cursor-not-allowed')
    expect(row).not.toHaveAttribute('aria-disabled', 'true')

    await user.pointer({ target: row, keys: '[MouseRight]' })
    expect(await screen.findByText('Decrypt file')).toBeInTheDocument()
  })

  // ---- Feature 06 additions ----

  it('re-reads the directory when refreshKey increments', async () => {
    const { readDirectory } = await import('@/lib/platform')
    const mock = readDirectory as ReturnType<typeof vi.fn>
    mock.mockResolvedValue([{ name: 'file.txt', isDirectory: false, isSymlink: false }])

    const { rerender } = render(
      <FileList dirPath="/home/user" mode="encrypt" refreshKey={0} onNavigate={vi.fn()} />
    )
    await screen.findByText('file.txt')
    const callCount = mock.mock.calls.length

    rerender(
      <FileList dirPath="/home/user" mode="encrypt" refreshKey={1} onNavigate={vi.fn()} />
    )
    await screen.findByText('file.txt')

    expect(mock.mock.calls.length).toBeGreaterThan(callCount)
  })

  it('the panel Reload button re-reads the directory when clicked', async () => {
    const user = userEvent.setup()
    const { readDirectory } = await import('@/lib/platform')
    const mock = readDirectory as ReturnType<typeof vi.fn>
    mock.mockResolvedValue([{ name: 'notes.txt', isDirectory: false, isSymlink: false }])

    render(<FileList dirPath="/home/user" mode="encrypt" onNavigate={vi.fn()} />)
    await screen.findByText('notes.txt')
    const callCount = mock.mock.calls.length

    await user.click(screen.getByRole('button', { name: /reload directory/i }))
    await screen.findByText('notes.txt')

    expect(mock.mock.calls.length).toBeGreaterThan(callCount)
  })
})
