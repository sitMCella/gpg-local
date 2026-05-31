import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useDirectory } from './useDirectory'

vi.mock('@/lib/platform', () => ({
  readDirectory: vi.fn(),
}))

import { readDirectory } from '@/lib/platform'
const mockReadDirectory = readDirectory as ReturnType<typeof vi.fn>

describe('useDirectory', () => {
  beforeEach(() => {
    mockReadDirectory.mockReset()
  })

  it('sorts directories before files, both alphabetically', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: 'zebra.txt', isDirectory: false, isSymlink: false },
      { name: 'alpha', isDirectory: true, isSymlink: false },
      { name: 'apple.txt', isDirectory: false, isSymlink: false },
      { name: 'beta', isDirectory: true, isSymlink: false },
    ])

    const { result } = renderHook(() => useDirectory())
    await act(() => result.current.read('/test'))

    const names = result.current.entries.map((e) => e.name)
    expect(names).toEqual(['alpha', 'beta', 'apple.txt', 'zebra.txt'])
  })

  it('filters hidden entries (starting with .) by default', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: '.hidden', isDirectory: true, isSymlink: false },
      { name: 'visible', isDirectory: true, isSymlink: false },
      { name: '.dotfile', isDirectory: false, isSymlink: false },
      { name: 'normal.txt', isDirectory: false, isSymlink: false },
    ])

    const { result } = renderHook(() => useDirectory())
    await act(() => result.current.read('/test'))

    const names = result.current.entries.map((e) => e.name)
    expect(names).not.toContain('.hidden')
    expect(names).not.toContain('.dotfile')
    expect(names).toContain('visible')
    expect(names).toContain('normal.txt')
  })

  it('includes hidden entries when showHidden is true', async () => {
    mockReadDirectory.mockResolvedValue([
      { name: '.hidden', isDirectory: true, isSymlink: false },
      { name: 'visible', isDirectory: false, isSymlink: false },
    ])

    const { result } = renderHook(() => useDirectory())
    await act(() => result.current.read('/test', true))

    const names = result.current.entries.map((e) => e.name)
    expect(names).toContain('.hidden')
    expect(names).toContain('visible')
  })

  it('sets error state when readDirectory throws', async () => {
    mockReadDirectory.mockRejectedValue(new Error('Permission denied'))

    const { result } = renderHook(() => useDirectory())
    await act(() => result.current.read('/restricted'))

    expect(result.current.error).toContain('Permission denied')
    expect(result.current.entries).toHaveLength(0)
  })
})
