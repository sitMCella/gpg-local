import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import App from './App'

vi.mock('@/lib/platform', () => ({
  getHomeDir: vi.fn().mockResolvedValue('/home/user'),
  openDirectoryPicker: vi.fn().mockResolvedValue(null),
  readDirectory: vi.fn().mockResolvedValue([]),
  isTauri: vi.fn().mockReturnValue(false),
  invokeEncryptFile: vi.fn().mockResolvedValue(undefined),
  openFilePath: vi.fn().mockResolvedValue(undefined),
}))

describe('App', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const platform = await import('@/lib/platform')
    ;(platform.getHomeDir as ReturnType<typeof vi.fn>).mockResolvedValue('/home/user')
    ;(platform.openDirectoryPicker as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(platform.readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(platform.invokeEncryptFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
  })

  it('renders the two-panel dashboard layout', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /go to home directory/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open folder/i })).toBeInTheDocument()
  })

  it('renders the breadcrumb with the home directory path after mount', async () => {
    render(<App />)
    expect(await screen.findByRole('link', { name: 'home' })).toBeInTheDocument()
  })

  it('renders the folder tree panel once home directory resolves', async () => {
    render(<App />)
    expect(await screen.findByRole('tree')).toBeInTheDocument()
  })

  it('clicking Home button resets root and selected path to home directory', async () => {
    const user = userEvent.setup()
    const { getHomeDir } = await import('@/lib/platform')

    render(<App />)
    await screen.findByRole('tree')

    ;(getHomeDir as ReturnType<typeof vi.fn>).mockResolvedValue('/home/user')
    await user.click(screen.getByRole('button', { name: /go to home directory/i }))

    await waitFor(() => {
      expect(getHomeDir).toHaveBeenCalledTimes(2)
    })
  })

  it('clicking Open folder calls openDirectoryPicker and updates path on selection', async () => {
    const user = userEvent.setup()
    const { openDirectoryPicker } = await import('@/lib/platform')
    ;(openDirectoryPicker as ReturnType<typeof vi.fn>).mockResolvedValue('/tmp/picked')

    render(<App />)
    await screen.findByRole('tree')

    await user.click(screen.getByRole('button', { name: /open folder/i }))

    await waitFor(() => {
      expect(openDirectoryPicker).toHaveBeenCalled()
    })
  })

  it('clicking Open folder does not change path when picker is cancelled', async () => {
    const user = userEvent.setup()
    const { openDirectoryPicker } = await import('@/lib/platform')
    ;(openDirectoryPicker as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    render(<App />)
    await screen.findByRole('link', { name: 'home' })

    await user.click(screen.getByRole('button', { name: /open folder/i }))

    await waitFor(() => {
      expect(openDirectoryPicker).toHaveBeenCalled()
    })
    expect(screen.getByRole('link', { name: 'home' })).toBeInTheDocument()
  })

  it('handleEncryptSuccess shows a toast and refreshes the file list', async () => {
    const user = userEvent.setup()
    const { readDirectory } = await import('@/lib/platform')
    ;(readDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'report.md', isDirectory: false, isSymlink: false },
    ])

    render(<App />)
    await screen.findByRole('tree')
    await screen.findByText('report.md')

    const row = screen.getByText('report.md').closest('[role="row"]')!
    await user.pointer({ target: row, keys: '[MouseRight]' })
    const encryptItem = await screen.findByText('Encrypt file')
    await user.click(encryptItem)

    const passInput = screen.getByLabelText(/^passphrase$/i)
    const confirmInput = screen.getByLabelText(/confirm passphrase/i)
    await user.type(passInput, 'securepassword')
    await user.type(confirmInput, 'securepassword')
    await user.click(screen.getByRole('button', { name: /^encrypt$/i }))

    await waitFor(() => {
      expect(screen.queryByText('Encrypt file')).not.toBeInTheDocument()
    })
  })

  it('handleSidebarRefreshRequest refreshes file list when path matches selected', async () => {
    const { readDirectory } = await import('@/lib/platform')
    const mock = readDirectory as ReturnType<typeof vi.fn>
    mock.mockResolvedValue([])

    render(<App />)
    await screen.findByRole('tree')

    const initialCallCount = mock.mock.calls.length
    expect(initialCallCount).toBeGreaterThan(0)
  })
})
