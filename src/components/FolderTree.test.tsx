import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import FolderTree from './FolderTree'

vi.mock('@/lib/platform', () => ({
  readDirectory: vi.fn(),
  openFilePath: vi.fn(),
}))

import { readDirectory, openFilePath } from '@/lib/platform'
const mockReadDirectory = readDirectory as ReturnType<typeof vi.fn>
const mockOpenFilePath = openFilePath as ReturnType<typeof vi.fn>

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
    mockOpenFilePath.mockReset()
    mockReadDirectory.mockResolvedValue([])
    mockOpenFilePath.mockResolvedValue(undefined)
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
    renderTree({
      rootPath: '/home/alice',
      selectedPath: null,
      onSelect: vi.fn(),
      onRefreshRequest: vi.fn(),
    })
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
      (resolve) => {
        resolveReload = () => resolve([])
      }
    )
    mockReadDirectory.mockResolvedValueOnce([]).mockReturnValueOnce(reloadPromise)

    renderTree({
      rootPath: '/home/alice',
      selectedPath: null,
      onSelect: vi.fn(),
      onRefreshRequest: vi.fn(),
    })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    const reloadItem = await screen.findByRole('menuitem', { name: /reload/i })
    await user.click(reloadItem)

    // Spinner should be visible while loading
    await waitFor(() => expect(root.querySelector('svg.animate-spin')).toBeInTheDocument())

    // Let the reload finish and spinner should disappear
    resolveReload()
    await waitFor(() => expect(root.querySelector('svg.animate-spin')).not.toBeInTheDocument())
  })

  it('right-click context menu contains "Open in file explorer" item', async () => {
    const user = userEvent.setup()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    expect(await screen.findByRole('menuitem', { name: /open in file explorer/i })).toBeInTheDocument()
  })

  it('clicking "Open in file explorer" calls openFilePath with the node path', async () => {
    const user = userEvent.setup()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    const openItem = await screen.findByRole('menuitem', { name: /open in file explorer/i })
    await user.click(openItem)
    expect(mockOpenFilePath).toHaveBeenCalledWith('/home/alice')
  })

  it('when openFilePath rejects, the app does not crash', async () => {
    const user = userEvent.setup()
    mockOpenFilePath.mockRejectedValueOnce(new Error('No default handler'))
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    const openItem = await screen.findByRole('menuitem', { name: /open in file explorer/i })
    await user.click(openItem)
    expect(mockOpenFilePath).toHaveBeenCalledWith('/home/alice')
  })

  it('calls onSelect and expands when Enter is pressed on a node', async () => {
    const user = userEvent.setup()
    mockReadDirectory.mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
    ])
    const onSelect = vi.fn()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect })
    const docNode = await screen.findByRole('treeitem', { name: /Documents/ })
    docNode.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('/home/alice/Documents')
  })

  it('calls onSelect and expands when Space is pressed on a node', async () => {
    const user = userEvent.setup()
    mockReadDirectory.mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
    ])
    const onSelect = vi.fn()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect })
    const docNode = await screen.findByRole('treeitem', { name: /Documents/ })
    docNode.focus()
    await user.keyboard(' ')
    expect(onSelect).toHaveBeenCalledWith('/home/alice/Documents')
  })

  it('handles loadChildren error gracefully and sets children to empty array', async () => {
    mockReadDirectory
      .mockResolvedValueOnce([{ name: 'BadFolder', isDirectory: true, isSymlink: false }])
      .mockRejectedValueOnce(new Error('Permission denied'))
    const user = userEvent.setup()
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const badNode = await screen.findByRole('treeitem', { name: /BadFolder/ })
    await user.click(badNode)
    await waitFor(() => expect(badNode).toHaveAttribute('aria-expanded', 'true'))
  })

  it('handles root loadChildren error gracefully', async () => {
    mockReadDirectory.mockRejectedValue(new Error('Permission denied'))
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await waitFor(() => expect(root).toHaveAttribute('aria-expanded', 'true'))
  })

  it('toggles expanded to false when clicking already-loaded expanded node', async () => {
    const user = userEvent.setup()
    mockReadDirectory.mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
    ])
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await waitFor(() => expect(root).toHaveAttribute('aria-expanded', 'true'))
    await user.click(root)
    expect(root).toHaveAttribute('aria-expanded', 'false')
    await user.click(root)
    expect(root).toHaveAttribute('aria-expanded', 'true')
  })

  it('filters out non-directory entries from tree', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'Documents', isDirectory: true, isSymlink: false },
      { name: 'file.txt', isDirectory: false, isSymlink: false },
    ])
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    expect(await screen.findByText('Documents')).toBeInTheDocument()
    expect(screen.queryByText('file.txt')).not.toBeInTheDocument()
  })

  it('sorts child directories alphabetically', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'Zebra', isDirectory: true, isSymlink: false },
      { name: 'Alpha', isDirectory: true, isSymlink: false },
      { name: 'Middle', isDirectory: true, isSymlink: false },
    ])
    renderTree({ rootPath: '/home/alice', selectedPath: null, onSelect: vi.fn() })
    await screen.findByText('Alpha')
    const items = screen.getAllByRole('treeitem')
    const names = items.map((i) => i.textContent)
    expect(names).toEqual(['alice', 'Alpha', 'Middle', 'Zebra'])
  })

  it('handleReload sets children to empty array on error', async () => {
    const user = userEvent.setup()
    mockReadDirectory
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Permission denied'))
    renderTree({
      rootPath: '/home/alice',
      selectedPath: null,
      onSelect: vi.fn(),
      onRefreshRequest: vi.fn(),
    })
    const root = await screen.findByRole('treeitem', { name: /alice/ })
    await user.pointer({ keys: '[MouseRight]', target: root })
    const reloadItem = await screen.findByRole('menuitem', { name: /reload/i })
    await user.click(reloadItem)
    await waitFor(() => expect(root).toHaveAttribute('aria-expanded', 'true'))
  })
})
