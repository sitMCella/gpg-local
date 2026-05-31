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
})
