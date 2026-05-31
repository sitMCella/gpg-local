import { useCallback, useState } from 'react'
import { readDirectory } from '../lib/platform'
import type { FsEntry } from '../types/fs'

interface State {
  entries: FsEntry[]
  loading: boolean
  error: string | null
}

export function useDirectory() {
  const [state, setState] = useState<State>({ entries: [], loading: false, error: null })

  const read = useCallback(async (path: string, showHidden = false) => {
    setState({ entries: [], loading: true, error: null })
    try {
      const raw = await readDirectory(path)
      const entries: FsEntry[] = raw
        .filter((e) => e.name != null)
        .filter((e) => showHidden || !e.name!.startsWith('.'))
        .map((e) => ({
          name: e.name!,
          path: `${path}/${e.name}`,
          isDir: e.isDirectory ?? false,
          isSymlink: e.isSymlink ?? false,
          modifiedAt: null,
        }))
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      setState({ entries, loading: false, error: null })
    } catch (err) {
      setState({ entries: [], loading: false, error: String(err) })
    }
  }, [])

  return { ...state, read }
}
