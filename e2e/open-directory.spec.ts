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
