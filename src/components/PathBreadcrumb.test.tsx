import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect } from 'vitest'
import PathBreadcrumb from './PathBreadcrumb'

describe('PathBreadcrumb', () => {
  it('renders all segments of a POSIX path', () => {
    render(<PathBreadcrumb path="/home/alice/Documents" onNavigate={vi.fn()} />)

    expect(screen.getByText('home')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('Documents')).toBeInTheDocument()
  })

  it('renders ancestor segments as clickable links', () => {
    render(<PathBreadcrumb path="/home/alice/Documents" onNavigate={vi.fn()} />)

    const homeLink = screen.getByRole('link', { name: 'home' })
    const aliceLink = screen.getByRole('link', { name: 'alice' })
    expect(homeLink).toBeInTheDocument()
    expect(aliceLink).toBeInTheDocument()
  })

  it('renders the last segment as non-clickable', () => {
    render(<PathBreadcrumb path="/home/alice/Documents" onNavigate={vi.fn()} />)

    const page = screen.getByText('Documents')
    expect(page.closest('a')).toBeNull()
    expect(page).toHaveAttribute('aria-current', 'page')
  })

  it('calls onNavigate with correct path when clicking ancestor segment', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<PathBreadcrumb path="/home/alice/Documents" onNavigate={onNavigate} />)

    const aliceLink = screen.getByRole('link', { name: 'alice' })
    await user.click(aliceLink)

    expect(onNavigate).toHaveBeenCalledWith('/home/alice')
  })

  it('calls onNavigate with first segment path when clicking home', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<PathBreadcrumb path="/home/alice/Documents" onNavigate={onNavigate} />)

    const homeLink = screen.getByRole('link', { name: 'home' })
    await user.click(homeLink)

    expect(onNavigate).toHaveBeenCalledWith('/home')
  })

  it('calls onNavigate when pressing Enter on an ancestor breadcrumb link', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(<PathBreadcrumb path="/home/alice/Documents" onNavigate={onNavigate} />)

    const aliceLink = screen.getByRole('link', { name: 'alice' })
    aliceLink.focus()
    await user.keyboard('{Enter}')

    expect(onNavigate).toHaveBeenCalledWith('/home/alice')
  })

  it('renders a single-segment path as a non-clickable page element', () => {
    render(<PathBreadcrumb path="/home" onNavigate={vi.fn()} />)

    const page = screen.getByText('home')
    expect(page.closest('a')).toBeNull()
    expect(page).toHaveAttribute('aria-current', 'page')
  })

  it('handles Windows paths with backslash separators', () => {
    render(<PathBreadcrumb path="C:\\Users\\alice\\Documents" onNavigate={vi.fn()} />)

    expect(screen.getByText('C:')).toBeInTheDocument()
    expect(screen.getByText('Users')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('Documents')).toBeInTheDocument()
    // Last segment is the non-clickable page
    const page = screen.getByText('Documents')
    expect(page.closest('a')).toBeNull()
  })
})
