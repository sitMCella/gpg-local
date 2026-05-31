import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import App from './App'

// Mock resizable primitives so we can inspect the sizing props passed to the sidebar panel.
// jsdom has no layout engine, so actual pixel sizes can't be measured — we verify the props instead.
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="panel-group" {...props}>
      {children}
    </div>
  ),
  ResizablePanel: ({
    children,
    defaultSize,
    minSize,
    maxSize,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & {
    defaultSize?: string | number
    minSize?: string | number
    maxSize?: string | number
  }) => (
    <div
      data-testid="resizable-panel"
      data-default-size={String(defaultSize)}
      data-min-size={String(minSize)}
      data-max-size={String(maxSize)}
      {...props}
    >
      {children}
    </div>
  ),
  ResizableHandle: ({
    withHandle: _withHandle,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { withHandle?: boolean }) => (
    <div data-testid="resizable-handle" {...props} />
  ),
}))

vi.mock('@/lib/platform', () => ({
  getHomeDir: vi.fn().mockResolvedValue('/home/user'),
  openDirectoryPicker: vi.fn().mockResolvedValue(null),
  readDirectory: vi.fn().mockResolvedValue([]),
  isTauri: vi.fn().mockReturnValue(false),
}))

describe('sidebar panel sizing props', () => {
  it('sidebar opens at 200 px default width', () => {
    const { getAllByTestId } = render(<App />)
    const sidebarPanel = getAllByTestId('resizable-panel')[0]
    expect(sidebarPanel).toHaveAttribute('data-default-size', '200px')
  })

  it('sidebar has a 400 px maximum width', () => {
    const { getAllByTestId } = render(<App />)
    const sidebarPanel = getAllByTestId('resizable-panel')[0]
    expect(sidebarPanel).toHaveAttribute('data-max-size', '400px')
  })

  it('sidebar has a 15% minimum width', () => {
    const { getAllByTestId } = render(<App />)
    const sidebarPanel = getAllByTestId('resizable-panel')[0]
    expect(sidebarPanel).toHaveAttribute('data-min-size', '15')
  })
})
