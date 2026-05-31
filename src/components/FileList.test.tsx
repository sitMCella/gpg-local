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
    render(<FileList dirPath={null} onNavigate={vi.fn()} />)

    expect(
      screen.getByText('Select a folder from the sidebar to browse its contents.')
    ).toBeInTheDocument()
  })

  it('renders a Lock icon for .gpg files', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'secret.txt.gpg', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" onNavigate={vi.fn()} />)

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

    render(<FileList dirPath="/home/user" onNavigate={vi.fn()} />)

    expect(await screen.findByText('encrypted.pgp')).toBeInTheDocument()
  })

  it('shows item count after loading', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'file1.txt', isDirectory: false, isSymlink: false },
      { name: 'file2.txt', isDirectory: false, isSymlink: false },
    ])

    render(<FileList dirPath="/home/user" onNavigate={vi.fn()} />)

    expect(await screen.findByText('2 items')).toBeInTheDocument()
  })

  it('shows empty-state message when dirPath is set but directory has no entries', async () => {
    render(<FileList dirPath="/empty/dir" onNavigate={vi.fn()} />)
    expect(
      await screen.findByText('Select a folder from the sidebar to browse its contents.')
    ).toBeInTheDocument()
  })

  it('shows an inline error alert when the directory cannot be read', async () => {
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'))

    render(<FileList dirPath="/restricted" onNavigate={vi.fn()} />)

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
    render(<FileList dirPath="/home/user" onNavigate={onNavigate} />)

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
    render(<FileList dirPath="/home/user" onNavigate={onNavigate} />)

    const row = await screen.findByRole('row')
    row.focus()
    await user.keyboard('{Enter}')

    expect(onNavigate).toHaveBeenCalledWith('/home/user/Downloads')
  })
})
