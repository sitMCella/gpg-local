import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import FolderTree from './FolderTree'

vi.mock('@/lib/platform', () => ({
  readDirectory: vi.fn(),
}))

import { readDirectory } from '@/lib/platform'
const mockReadDirectory = readDirectory as ReturnType<typeof vi.fn>

function renderTree(props: Parameters<typeof FolderTree>[0]) {
  return render(
    <TooltipProvider>
      <FolderTree {...props} />
    </TooltipProvider>
  )
}

describe('FolderTree', () => {
  beforeEach(() => {
    mockReadDirectory.mockReset()
    mockReadDirectory.mockResolvedValue([])
  })

  it('renders the root node labelled with the last path segment', async () => {
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    expect(await screen.findByText('alice')).toBeInTheDocument()
  })

  it('auto-expands the root on mount and shows child directories', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
      { name: 'Downloads', isDirectory: true, isSymlink: false },
    ])
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    expect(await screen.findByText('Documents')).toBeInTheDocument()
    expect(await screen.findByText('Downloads')).toBeInTheDocument()
  })

  it('filters out hidden directories (names starting with .) by default', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: '.hidden', isDirectory: true, isSymlink: false },
      { name: 'visible', isDirectory: true, isSymlink: false },
    ])
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    expect(await screen.findByText('visible')).toBeInTheDocument()
    expect(screen.queryByText('.hidden')).not.toBeInTheDocument()
  })

  it('shows hidden directories when showHidden is true', async () => {
    mockReadDirectory.mockResolvedValue([{ name: '.config', isDirectory: true, isSymlink: false }])
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn(), showHidden: true })
    expect(await screen.findByText('.config')).toBeInTheDocument()
  })

  it('calls onSelect with the folder path when a child node is clicked', async () => {
    const user = userEvent.setup()
    mockReadDirectory.mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
    ])
    const onSelect = vi.fn()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect })
    const docNode = await screen.findByText('Documents')
    await user.click(docNode)
    expect(onSelect).toHaveBeenCalledWith('/home/alice/Documents')
  })

  it('marks the currently selected path node with aria-selected=true', async () => {
    renderTree({ rootPath: '/home/alice', selectedPath: '/home/alice', onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    expect(root).toHaveAttribute('aria-selected', 'true')
  })

  it('sets aria-expanded to true on the root node after auto-expand', async () => {
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await waitFor(() => expect(root).toHaveAttribute('aria-expanded', 'true'))
  })

  it('collapses an expanded node when ArrowLeft is pressed', async () => {
    const user = userEvent.setup()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await waitFor(() => expect(root).toHaveAttribute('aria-expanded', 'true'))
    root.focus()
    await user.keyboard('{ArrowLeft}')
    expect(root).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands a collapsed node when ArrowRight is pressed', async () => {
    const user = userEvent.setup()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    // Wait for auto-expand, then collapse it
    await waitFor(() => expect(root).toHaveAttribute('aria-expanded', 'true'))
    root.focus()
    await user.keyboard('{ArrowLeft}')
    expect(root).toHaveAttribute('aria-expanded', 'false')
    // Now expand again with ArrowRight
    await user.keyboard('{ArrowRight}')
    expect(root).toHaveAttribute('aria-expanded', 'true')
  })

  it('right-clicking a folder node opens a context menu with a Reload item', async () => {
    const user = userEvent.setup()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    expect(await screen.findByRole('menuitem', { name: /reload/i })).toBeInTheDocument()
  })

  it('clicking Reload calls onRefreshRequest with the node path', async () => {
    const user = userEvent.setup()
    const onRefreshRequest = vi.fn()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn(), onRefreshRequest })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    const reloadItem = await screen.findByRole('menuitem', { name: /reload/i })
    await user.click(reloadItem)
    await waitFor(() => expect(onRefreshRequest).toHaveBeenCalledWith('/home/alice'))
  })

  it('after Reload is triggered, the node children are re-fetched', async () => {
    const user = userEvent.setup()
    mockReadDirectory
      .mockResolvedValueOnce([{ name: 'OldFolder', isDirectory: true, isSymlink: false }])
      .mockResolvedValueOnce([{ name: 'NewFolder', isDirectory: true, isSymlink: false }])
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn(), onRefreshRequest: vi.fn() })
    expect(await screen.findByText('OldFolder')).toBeInTheDocument()
    const root = screen.getByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    const reloadItem = await screen.findByRole('menuitem', { name: /reload/i })
    await user.click(reloadItem)
    expect(await screen.findByText('NewFolder')).toBeInTheDocument()
    expect(screen.queryByText('OldFolder')).not.toBeInTheDocument()
  })

  it('shows Loader2 spinner on the reloaded node while reload is in progress', async () => {
    const user = userEvent.setup()
    // First call resolves immediately; second (reload) never resolves so we can inspect loading state
    let resolveReload!: () => void
    const reloadPromise = new Promise<{ name: string; isDirectory: boolean; isSymlink: boolean }[]>(
      (resolve) => { resolveReload = () => resolve([]) }
    )
    mockReadDirectory
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(reloadPromise)

    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn(), onRefreshRequest: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    const reloadItem = await screen.findByRole('menuitem', { name: /reload/i })
    await user.click(reloadItem)

    // Spinner should be visible while loading
    await waitFor(() =>
      expect(root.querySelector('svg.animate-spin')).toBeInTheDocument()
    )

    // Let the reload finish and spinner should disappear
    resolveReload()
    await waitFor(() =>
      expect(root.querySelector('svg.animate-spin')).not.toBeInTheDocument()
    )
  })
})
