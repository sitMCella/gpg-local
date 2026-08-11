import { test, expect, Page } from '@playwright/test'

// ─── types ───────────────────────────────────────────────────────────────────

type MockEntry = { name: string; isDirectory: boolean; isSymlink: boolean }

// ─── constants ────────────────────────────────────────────────────────────────

const HOME = '/home/testuser'

const HOME_ENTRIES: MockEntry[] = [
  { name: 'Documents', isDirectory: true, isSymlink: false },
  { name: 'Downloads', isDirectory: true, isSymlink: false },
  { name: 'notes.txt', isDirectory: false, isSymlink: false },
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
    openPathErrorMessage = 'Failed to open directory',
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

// ─── AC1: context menu shows "Open in file explorer" on folder nodes ────────

test.describe('Open in file explorer context menu item', () => {
  test('right-clicking a folder node shows "Open in file explorer"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const rootNode = page.getByRole('treeitem').first()
    await expect(rootNode).toBeVisible()
    await rootNode.click({ button: 'right' })

    await expect(
      page.getByRole('menuitem', { name: /open in file explorer/i })
    ).toBeVisible()
  })

  test('right-clicking a child folder node shows "Open in file explorer"', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const documentsNode = page.getByRole('treeitem', { name: /documents/i })
    await expect(documentsNode).toBeVisible()
    await documentsNode.click({ button: 'right' })

    await expect(
      page.getByRole('menuitem', { name: /open in file explorer/i })
    ).toBeVisible()
  })

  test('"Open in file explorer" appears above "Reload" in the context menu', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const rootNode = page.getByRole('treeitem').first()
    await rootNode.click({ button: 'right' })

    const openItem = page.getByRole('menuitem', { name: /open in file explorer/i })
    const reloadItem = page.getByRole('menuitem', { name: /^reload$/i })
    await expect(openItem).toBeVisible()
    await expect(reloadItem).toBeVisible()

    const openBox = await openItem.boundingBox()
    const reloadBox = await reloadItem.boundingBox()
    expect(openBox).not.toBeNull()
    expect(reloadBox).not.toBeNull()
    expect(openBox!.y).toBeLessThan(reloadBox!.y)
  })
})

// ─── AC2: clicking calls openFilePath with the correct directory path ───────

test.describe('Open in file explorer action', () => {
  test('clicking "Open in file explorer" calls openPath with the root node path', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const rootNode = page.getByRole('treeitem').first()
    await rootNode.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /open in file explorer/i }).click()

    const calls = await page.evaluate(
      () => (window as { __E2E_OPEN_PATH_CALLS__?: string[] }).__E2E_OPEN_PATH_CALLS__
    )
    expect(calls).toEqual([HOME])
  })

  test('clicking "Open in file explorer" on a child folder uses that folder path', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const documentsNode = page.getByRole('treeitem', { name: /documents/i })
    await expect(documentsNode).toBeVisible()
    await documentsNode.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /open in file explorer/i }).click()

    const calls = await page.evaluate(
      () => (window as { __E2E_OPEN_PATH_CALLS__?: string[] }).__E2E_OPEN_PATH_CALLS__
    )
    expect(calls).toEqual([`${HOME}/Documents`])
  })
})

// ─── AC3: failure shows a toast without crashing ────────────────────────────

test.describe('Open in file explorer failure handling', () => {
  test('failure to open shows a toast and the app does not crash', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      openPathResult: 'error',
      openPathErrorMessage: 'Permission denied',
    })
    await page.goto('/')

    const rootNode = page.getByRole('treeitem').first()
    await rootNode.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /open in file explorer/i }).click()

    await expect(page.getByText(/could not open/i)).toBeVisible()

    // App is still functional — sidebar tree is visible
    await expect(page.getByRole('tree', { name: /folder tree/i })).toBeVisible()
  })

  test('toast includes the error details', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      openPathResult: 'error',
      openPathErrorMessage: 'Permission denied: /home/testuser',
    })
    await page.goto('/')

    const rootNode = page.getByRole('treeitem').first()
    await rootNode.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /open in file explorer/i }).click()

    await expect(page.getByText(/permission denied/i)).toBeVisible()
  })
})

// ─── File list panel: "Open in file explorer" context menu ──────────────────

test.describe('File list panel: Open in file explorer', () => {
  const FILE_LIST_ENTRIES: MockEntry[] = [
    { name: 'Documents', isDirectory: true, isSymlink: false },
    { name: 'notes.txt', isDirectory: false, isSymlink: false },
    { name: 'budget.xlsx', isDirectory: false, isSymlink: false },
    { name: 'secret.gpg', isDirectory: false, isSymlink: false },
  ]

  test('in encrypt mode, right-clicking a non-encrypted file shows "Open in file explorer" as the last context menu item', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: FILE_LIST_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row', { name: /budget\.xlsx/i })
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    const items = page.getByRole('menuitem')
    const lastItem = items.last()
    await expect(lastItem).toHaveText(/open in file explorer/i)
  })

  test('in encrypt mode, right-clicking a text file shows three items: Open file, Encrypt file, Open in file explorer', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: FILE_LIST_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row', { name: /notes\.txt/i })
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(3)
    await expect(items.nth(0)).toHaveText(/open file/i)
    await expect(items.nth(1)).toHaveText(/encrypt file/i)
    await expect(items.nth(2)).toHaveText(/open in file explorer/i)
  })

  test('in encrypt mode, right-clicking a non-text file shows two items: Encrypt file, Open in file explorer', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: FILE_LIST_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row', { name: /budget\.xlsx/i })
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveText(/encrypt file/i)
    await expect(items.nth(1)).toHaveText(/open in file explorer/i)
  })

  test('in decrypt mode, right-clicking a .gpg file shows two items: Decrypt file, Open in file explorer', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: FILE_LIST_ENTRIES } })
    await page.goto('/')

    // Switch to decrypt mode
    await page.getByRole('tab', { name: /decrypt/i }).click()

    const row = page.getByRole('row', { name: /secret\.gpg/i })
    await expect(row).toBeVisible()
    await row.click({ button: 'right' })

    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(2)
    await expect(items.nth(0)).toHaveText(/decrypt file/i)
    await expect(items.nth(1)).toHaveText(/open in file explorer/i)
  })

  test('in both modes, right-clicking a directory row shows a single "Open in file explorer" item', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: FILE_LIST_ENTRIES } })
    await page.goto('/')

    // Encrypt mode
    const dirRow = page.getByRole('row', { name: /documents/i })
    await expect(dirRow).toBeVisible()
    await dirRow.click({ button: 'right' })

    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(1)
    await expect(items.first()).toHaveText(/open in file explorer/i)

    // Close the menu by pressing Escape
    await page.keyboard.press('Escape')

    // Switch to decrypt mode
    await page.getByRole('tab', { name: /decrypt/i }).click()

    await dirRow.click({ button: 'right' })
    const decryptItems = page.getByRole('menuitem')
    await expect(decryptItems).toHaveCount(1)
    await expect(decryptItems.first()).toHaveText(/open in file explorer/i)
  })

  test('clicking "Open in file explorer" on a file row calls openPath with the file path', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: FILE_LIST_ENTRIES } })
    await page.goto('/')

    const row = page.getByRole('row', { name: /budget\.xlsx/i })
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /open in file explorer/i }).click()

    const calls = await page.evaluate(
      () => (window as { __E2E_OPEN_PATH_CALLS__?: string[] }).__E2E_OPEN_PATH_CALLS__
    )
    expect(calls).toContain(`${HOME}/budget.xlsx`)
  })

  test('clicking "Open in file explorer" on a directory row calls openPath with the directory path', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: FILE_LIST_ENTRIES } })
    await page.goto('/')

    const dirRow = page.getByRole('row', { name: /documents/i })
    await dirRow.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /open in file explorer/i }).click()

    const calls = await page.evaluate(
      () => (window as { __E2E_OPEN_PATH_CALLS__?: string[] }).__E2E_OPEN_PATH_CALLS__
    )
    expect(calls).toContain(`${HOME}/Documents`)
  })

  test('failure to open a file shows a toast with error details', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: FILE_LIST_ENTRIES },
      openPathResult: 'error',
      openPathErrorMessage: 'Permission denied: /home/testuser/budget.xlsx',
    })
    await page.goto('/')

    const row = page.getByRole('row', { name: /budget\.xlsx/i })
    await row.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /open in file explorer/i }).click()

    await expect(page.getByText(/could not open/i)).toBeVisible()
    await expect(page.getByText(/permission denied/i)).toBeVisible()
  })
})

// ─── AC4: action does not interfere with existing Reload functionality ──────

test.describe('Open in file explorer does not interfere with Reload', () => {
  test('Reload still works after using "Open in file explorer"', async ({ page }) => {
    await injectMocks(page, {
      tree: {
        [HOME]: HOME_ENTRIES,
        [`${HOME}/Documents`]: [],
      },
    })
    await page.goto('/')

    // Use "Open in file explorer" first
    const rootNode = page.getByRole('treeitem').first()
    await rootNode.click({ button: 'right' })
    await page.getByRole('menuitem', { name: /open in file explorer/i }).click()

    // Now use Reload on the same node
    await rootNode.click({ button: 'right' })
    const reloadItem = page.getByRole('menuitem', { name: /^reload$/i })
    await expect(reloadItem).toBeVisible()
    await reloadItem.click()

    // Tree should still be functional
    await expect(rootNode).toBeVisible()
  })
})
