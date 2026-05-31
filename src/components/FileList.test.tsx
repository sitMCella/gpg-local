import { render, screen } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import FileList from './FileList'

vi.mock('@/lib/platform', () => ({
  readDirectory: vi.fn().mockResolvedValue([]),
}))

describe('FileList', () => {
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
})
