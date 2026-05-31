export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getHomeDir(): Promise<string> {
  if (isTauri()) {
    const { homeDir } = await import('@tauri-apps/api/path')
    return homeDir()
  }
  return getHomeDirBrowser()
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
  // Allow Playwright e2e tests to inject mock directory data via window globals
  if (typeof window !== 'undefined' && (window as { __E2E_MOCK_READ_DIR__?: (p: string) => unknown[] }).__E2E_MOCK_READ_DIR__) {
    return (window as { __E2E_MOCK_READ_DIR__: (p: string) => Array<{ name: string; isDirectory: boolean; isSymlink: boolean }> }).__E2E_MOCK_READ_DIR__(path)
  }
  return []
}

export async function getHomeDirBrowser(): Promise<string> {
  if (typeof window !== 'undefined' && (window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__) {
    return (window as { __E2E_MOCK_HOME_DIR__: string }).__E2E_MOCK_HOME_DIR__
  }
  return '/home/user'
}

export async function openDirectoryPicker(defaultPath?: string): Promise<string | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({ directory: true, multiple: false, defaultPath })
    return typeof result === 'string' ? result : null
  }
  return null
}
