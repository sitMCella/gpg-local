import { test, expect, Page } from '@playwright/test'

// ─── types ───────────────────────────────────────────────────────────────────

type MockEntry = { name: string; isDirectory: boolean; isSymlink: boolean }

// ─── constants ────────────────────────────────────────────────────────────────

const HOME = '/home/testuser'

const HOME_ENTRIES: MockEntry[] = [
  { name: 'Documents', isDirectory: true, isSymlink: false },
  { name: 'report.md', isDirectory: false, isSymlink: false },
  { name: 'notes.txt', isDirectory: false, isSymlink: false },
  { name: 'config.yaml', isDirectory: false, isSymlink: false },
  { name: 'data.json', isDirectory: false, isSymlink: false },
  { name: 'budget.xlsx', isDirectory: false, isSymlink: false },
  { name: 'photo.png', isDirectory: false, isSymlink: false },
  { name: 'secret.gpg', isDirectory: false, isSymlink: false },
  { name: 'archive.pgp', isDirectory: false, isSymlink: false },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

interface InjectOptions {
  homeDir?: string
  tree?: Record<string, MockEntry[]>
  openPathResult?: 'success' | 'error'
  openPathErrorMessage?: string
}

async function injectMocks(
  page: Page,
  {
    homeDir = HOME,
    tree = {},
    openPathResult = 'success',
    openPathErrorMessage = 'No default handler registered',
  }: InjectOptions = {}
) {
  await page.addInitScript(
    ({
      h,
      t,
      result,
      errorMsg,
    }: {
      h: string
      t: Record<string, MockEntry[]>
      result: 'success' | 'error'
      errorMsg: string
    }) => {
      ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
      ;(
        window as {
          __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[]
        }
      ).__E2E_MOCK_READ_DIR__ = (path: string) => t[path] ?? []
      ;(
        window as {
          __E2E_MOCK_OPEN_PATH__?: (p: string) => Promise<void>
          __E2E_OPEN_PATH_CALLS__?: string[]
        }
      ).__E2E_OPEN_PATH_CALLS__ = []
      ;(
        window as {
          __E2E_MOCK_OPEN_PATH__?: (p: string) => Promise<void>
          __E2E_OPEN_PATH_CALLS__?: string[]
        }
      ).__E2E_MOCK_OPEN_PATH__ = (path: string) => {
        ;(
          window as {
            __E2E_OPEN_PATH_CALLS__?: string[]
          }
        ).__E2E_OPEN_PATH_CALLS__!.push(path)
        if (result === 'error') {
          return Promise.reject(new Error(errorMsg))
        }
        return Promise.resolve()
      }
    },
    {
      h: homeDir,
      t: tree,
      result: openPathResult,
      errorMsg: openPathErrorMessage,
    }
  )
}

async function switchToDecryptMode(page: Page) {
  const decryptTab = page.getByRole('tab', { name: /^decrypt$/i })
  await expect(decryptTab).toBeVisible()
  await decryptTab.click()
  await expect(decryptTab).toHaveAttribute('aria-selected', 'true')
}

// ─── AC1: "Open file" shown for text files in encrypt mode ──────────────────

test.describe('Open file in encrypt mode for text files', () => {
  test('.txt file context menu shows "Open file" above "Encrypt file"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    const openItem = page.getByRole('menuitem', { name: /open file/i })
    const encryptItem = page.getByRole('menuitem', { name: /encrypt file/i })
    await expect(openItem).toBeVisible()
    await expect(encryptItem).toBeVisible()
  })

  test('.md file context menu shows "Open file"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'report.md' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /open file/i })).toBeVisible()
  })

  test('.yaml file context menu shows "Open file"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'config.yaml' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /open file/i })).toBeVisible()
  })

  test('.json file context menu shows "Open file"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'data.json' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /open file/i })).toBeVisible()
  })
})

// ─── AC2: "Open file" NOT shown for non-text, non-encrypted files ───────────

test.describe('Open file not shown for non-text files in encrypt mode', () => {
  test('.xlsx file context menu shows "Encrypt file" but not "Open file"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'budget.xlsx' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /encrypt file/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /open file/i })).not.toBeVisible()
  })

  test('.png file context menu shows "Encrypt file" but not "Open file"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'photo.png' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /encrypt file/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /open file/i })).not.toBeVisible()
  })
})

// ─── AC3: .gpg/.pgp files remain disabled — no context menu ────────────────

test.describe('encrypted files in encrypt mode remain unchanged', () => {
  test('.gpg file row is disabled and shows no context menu', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const gpgRow = page.getByRole('row').filter({ hasText: 'secret.gpg' }).first()
    await expect(gpgRow).toHaveClass(/cursor-not-allowed/)
    await gpgRow.dispatchEvent('contextmenu')

    await expect(page.getByRole('menuitem', { name: /open file/i })).not.toBeVisible()
    await expect(page.getByRole('menuitem', { name: /encrypt file/i })).not.toBeVisible()
  })

  test('.pgp file row is disabled and shows no context menu', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const pgpRow = page.getByRole('row').filter({ hasText: 'archive.pgp' }).first()
    await expect(pgpRow).toHaveClass(/cursor-not-allowed/)
    await pgpRow.dispatchEvent('contextmenu')

    await expect(page.getByRole('menuitem', { name: /open file/i })).not.toBeVisible()
  })
})

// ─── AC4: no "Open file" in decrypt mode ────────────────────────────────────

test.describe('Open file not available in decrypt mode', () => {
  test('.txt file in decrypt mode does not show "Open file"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    // .txt files are disabled in decrypt mode — no context menu at all
    const txtRow = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await expect(txtRow).toHaveClass(/cursor-not-allowed/)
    await txtRow.dispatchEvent('contextmenu')

    await expect(page.getByRole('menuitem', { name: /open file/i })).not.toBeVisible()
  })

  test('.gpg file in decrypt mode shows only "Decrypt file", not "Open file"', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    const gpgRow = page.getByRole('row').filter({ hasText: 'secret.gpg' }).first()
    await expect(gpgRow).not.toHaveClass(/cursor-not-allowed/)
    await gpgRow.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /decrypt file/i })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /open file/i })).not.toBeVisible()
  })
})

// ─── AC5: clicking "Open file" invokes the OS default handler ───────────────

test.describe('Open file action', () => {
  test('clicking "Open file" calls openPath with the file path', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    const openItem = page.getByRole('menuitem', { name: /open file/i })
    await expect(openItem).toBeVisible()
    await openItem.click()

    // Verify the mock was called with the correct path
    const calls = await page.evaluate(
      () => (window as { __E2E_OPEN_PATH_CALLS__?: string[] }).__E2E_OPEN_PATH_CALLS__
    )
    expect(calls).toEqual([`${HOME}/notes.txt`])
  })

  test('the action does not invoke any encrypt/decrypt command', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'report.md' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    await page.getByRole('menuitem', { name: /open file/i }).click()

    // No encrypt or decrypt dialog should appear
    await expect(page.getByRole('dialog')).not.toBeVisible()

    // Verify the open path mock was called
    const calls = await page.evaluate(
      () => (window as { __E2E_OPEN_PATH_CALLS__?: string[] }).__E2E_OPEN_PATH_CALLS__
    )
    expect(calls).toEqual([`${HOME}/report.md`])
  })
})

// ─── AC6: directories never show "Open file" ───────────────────────────────

test.describe('directories do not show Open file', () => {
  test('directory row in encrypt mode does not show "Open file" in context menu', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    // Scope to the file list table to avoid matching sidebar treeitems
    const fileTable = page.getByRole('table', { name: /file list/i })
    const dirRow = fileTable.getByRole('row').filter({ hasText: 'Documents' }).first()
    await expect(dirRow).toBeVisible()
    await dirRow.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /open file/i })).not.toBeVisible()
  })
})

// ─── AC7: failure toast when OS cannot open file ────────────────────────────

test.describe('Open file failure handling', () => {
  test('failure to open shows a toast and does not crash the app', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      openPathResult: 'error',
      openPathErrorMessage: 'No default handler registered for .txt',
    })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    await page.getByRole('menuitem', { name: /open file/i }).click()

    // Toast should appear with the failure message
    await expect(page.getByText(/could not open notes\.txt/i)).toBeVisible()

    // App should not crash — file list is still visible
    await expect(page.getByRole('table', { name: /file list/i })).toBeVisible()
  })

  test('toast includes the error details', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      openPathResult: 'error',
      openPathErrorMessage: 'Permission denied: /home/testuser/notes.txt',
    })
    await page.goto('/')

    const row = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    await page.getByRole('menuitem', { name: /open file/i }).click()

    await expect(page.getByText(/permission denied/i)).toBeVisible()
  })
})

// ─── All recognized text extensions ─────────────────────────────────────────

test.describe('recognized text extensions', () => {
  const textExtensions = [
    'txt',
    'md',
    'markdown',
    'log',
    'json',
    'csv',
    'tsv',
    'yaml',
    'yml',
    'xml',
    'ini',
    'conf',
    'cfg',
    'toml',
  ]

  for (const ext of textExtensions) {
    test(`.${ext} file shows "Open file" in context menu`, async ({ page }) => {
      const entries: MockEntry[] = [
        { name: `testfile.${ext}`, isDirectory: false, isSymlink: false },
      ]
      await injectMocks(page, { tree: { [HOME]: entries } })
      await page.goto('/')

      const row = page.getByRole('row').filter({ hasText: `testfile.${ext}` }).first()
      await expect(row).toBeVisible()
      await row.click({ button: 'right' })

      await expect(page.getByRole('menuitem', { name: /open file/i })).toBeVisible()
    })
  }
})
