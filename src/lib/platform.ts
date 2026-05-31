export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getHomeDir(): Promise<string> {
  if (isTauri()) {
    const { homeDir } = await import('@tauri-apps/api/path')
    return homeDir()
  }
  return '/home/user'
}

export async function readDirectory(path: string): Promise<Array<{
  name: string | undefined
  isDirectory: boolean | undefined
  isSymlink: boolean | undefined
}>> {
  if (isTauri()) {
    const { readDir } = await import('@tauri-apps/plugin-fs')
    return readDir(path)
  }
  return []
}

export async function openDirectoryPicker(defaultPath?: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({ directory: true, multiple: false, defaultPath })
    return typeof result === 'string' ? result : null
  }
  return null
}
