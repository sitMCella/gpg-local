import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import App from './App'

vi.mock('@/lib/platform', () => ({
  getHomeDir: vi.fn().mockResolvedValue('/home/user'),
  openDirectoryPicker: vi.fn().mockResolvedValue(null),
  readDirectory: vi.fn().mockResolvedValue([]),
  isTauri: vi.fn().mockReturnValue(false),
}))

describe('App', () => {
  it('renders the two-panel dashboard layout', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /go to home directory/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open folder/i })).toBeInTheDocument()
  })

  it('renders the breadcrumb with the home directory path after mount', async () => {
    render(<App />)
    // getHomeDir mock returns '/home/user' → breadcrumb: home (link) > user (non-clickable page)
    expect(await screen.findByRole('link', { name: 'home' })).toBeInTheDocument()
  })

  it('renders the folder tree panel once home directory resolves', async () => {
    render(<App />)
    // FolderTree only mounts after getHomeDir resolves and sets rootPath
    expect(await screen.findByRole('tree')).toBeInTheDocument()
  })
})
