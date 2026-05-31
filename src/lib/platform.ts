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

export async function readDirectory(path: string): Promise<
  Array<{
    name: string | undefined
    isDirectory: boolean | undefined
    isSymlink: boolean | undefined
  }>
> {
  if (isTauri()) {
    const { readDir } = await import('@tauri-apps/plugin-fs')
    return readDir(path)
  }
  // Allow Playwright e2e tests to inject mock directory data via window globals
  const win = window as unknown as {
    __E2E_MOCK_READ_DIR__?: (
      p: string
    ) => Array<{ name: string; isDirectory: boolean; isSymlink: boolean }>
  }
  if (typeof window !== 'undefined' && win.__E2E_MOCK_READ_DIR__) {
    return win.__E2E_MOCK_READ_DIR__(path)
  }
  return []
}

export async function getHomeDirBrowser(): Promise<string> {
  const win = window as unknown as { __E2E_MOCK_HOME_DIR__?: string }
  if (typeof window !== 'undefined' && win.__E2E_MOCK_HOME_DIR__) {
    return win.__E2E_MOCK_HOME_DIR__
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

export interface EncryptFileOptions {
  input_path: string
  output_path: string
  recipient_fingerprints: string[]
  passphrase?: string
}

export async function invokeEncryptFile(options: EncryptFileOptions): Promise<void> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke('encrypt_file', { options })
  }
  // Allow Playwright e2e tests to inject mock encrypt behavior via window globals
  const win = window as unknown as {
    __E2E_MOCK_ENCRYPT_FILE__?: (opts: EncryptFileOptions) => Promise<void>
  }
  if (typeof window !== 'undefined' && win.__E2E_MOCK_ENCRYPT_FILE__) {
    return win.__E2E_MOCK_ENCRYPT_FILE__(options)
  }
  return Promise.resolve()
}
