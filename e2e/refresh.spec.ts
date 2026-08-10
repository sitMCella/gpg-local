import { test, expect, Page } from '@playwright/test'

// Inject mock filesystem data before the app initialises so the platform
// abstraction layer (src/lib/platform.ts) picks up __E2E_MOCK_* globals.
async function setupMocks(
  page: Page,
  opts: {
    homeEntries?: Array<{ name: string; isDirectory: boolean; isSymlink: boolean }>
    childEntries?: Record<string, Array<{ name: string; isDirectory: boolean; isSymlink: boolean }>>
  } = {}
) {
  const homeEntries = opts.homeEntries ?? [
    { name: 'Documents', isDirectory: true, isSymlink: false },
    { name: 'notes.txt', isDirectory: false, isSymlink: false },
    { name: 'secret.gpg', isDirectory: false, isSymlink: false },
  ]
  const childEntries = opts.childEntries ?? {
    '/home/testuser/Documents': [{ name: 'report.md', isDirectory: false, isSymlink: false }],
  }

  await page.addInitScript(
    ({ home, homeEntries, childEntries }) => {
      const w = window as unknown as {
        __E2E_MOCK_HOME_DIR__?: string
        __E2E_MOCK_READ_DIR__?: (path: string) => Array<{
          name: string
          isDirectory: boolean
          isSymlink: boolean
        }>
      }
      w.__E2E_MOCK_HOME_DIR__ = home
      w.__E2E_MOCK_READ_DIR__ = (path: string) => {
        if (path === home) return homeEntries
        return (childEntries as Record<string, typeof homeEntries>)[path] ?? []
      }
    },
    { home: '/home/testuser', homeEntries, childEntries }
  )
}

// ---------------------------------------------------------------------------
// File list panel reload button (pre-existing, must not be removed)
// ---------------------------------------------------------------------------

test('file list panel still has its own reload button', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  await expect(page.getByRole('button', { name: /reload directory/i })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Sidebar context menu
// ---------------------------------------------------------------------------

test('right-clicking a folder node shows a context menu with Reload', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  const treeRoot = page.getByRole('treeitem').first()
  await expect(treeRoot).toBeVisible()
  await treeRoot.click({ button: 'right' })

  await expect(page.getByRole('menuitem', { name: /^reload$/i })).toBeVisible()
})

test('context menu on folder node contains Reload and Open in file explorer', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  const treeRoot = page.getByRole('treeitem').first()
  await treeRoot.click({ button: 'right' })

  const menuItems = page.getByRole('menuitem')
  await expect(menuItems).toHaveCount(2)
  await expect(page.getByRole('menuitem', { name: /open in file explorer/i })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: /^reload$/i })).toBeVisible()
})

test('right-clicking a child folder node also shows the Reload context menu', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  // Wait for the root to expand and the child folder to appear
  const documentsNode = page.getByRole('treeitem', { name: /documents/i })
  await expect(documentsNode).toBeVisible()
  await documentsNode.click({ button: 'right' })

  await expect(page.getByRole('menuitem', { name: /^reload$/i })).toBeVisible()
})

// ---------------------------------------------------------------------------
// Clicking file list panel reload button updates the file list
// ---------------------------------------------------------------------------

test('file list panel reload button re-reads the current directory', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  await expect(page.getByText('3 items')).toBeVisible()

  await page.evaluate(() => {
    const w = window as unknown as {
      __E2E_MOCK_READ_DIR__?: (path: string) => Array<{
        name: string
        isDirectory: boolean
        isSymlink: boolean
      }>
    }
    w.__E2E_MOCK_READ_DIR__ = (path: string) => {
      if (path === '/home/testuser') {
        return [
          { name: 'Documents', isDirectory: true, isSymlink: false },
          { name: 'notes.txt', isDirectory: false, isSymlink: false },
        ]
      }
      return []
    }
  })

  await page.getByRole('button', { name: /reload directory/i }).click()

  await expect(page.getByText('2 items')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Context menu Reload on selected folder refreshes the file list
// ---------------------------------------------------------------------------

test('Reload on currently selected folder also refreshes the file list panel', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  await expect(page.getByText('3 items')).toBeVisible()

  await page.evaluate(() => {
    const w = window as unknown as {
      __E2E_MOCK_READ_DIR__?: (path: string) => Array<{
        name: string
        isDirectory: boolean
        isSymlink: boolean
      }>
    }
    w.__E2E_MOCK_READ_DIR__ = (path: string) => {
      if (path === '/home/testuser') {
        return [
          { name: 'Documents', isDirectory: true, isSymlink: false },
          { name: 'notes.txt', isDirectory: false, isSymlink: false },
          { name: 'added.txt', isDirectory: false, isSymlink: false },
          { name: 'secret.gpg', isDirectory: false, isSymlink: false },
        ]
      }
      return []
    }
  })

  // Right-click the root node (currently selected) and click Reload
  const treeRoot = page.getByRole('treeitem').first()
  await treeRoot.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^reload$/i }).click()

  await expect(page.getByText('4 items')).toBeVisible()
  await expect(page.getByText('added.txt')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Context menu Reload on non-selected folder does NOT change the file list
// ---------------------------------------------------------------------------

test('Reload on a non-selected folder does not affect the file list panel', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  // Navigate into Documents so it becomes the selected directory
  const documentsNode = page.getByRole('treeitem', { name: /documents/i })
  await expect(documentsNode).toBeVisible()
  await documentsNode.click()

  // File list should now show Documents content: 1 item (report.md)
  await expect(page.getByText('1 item')).toBeVisible()

  // Right-click the root node (not the selected directory) and reload it
  const treeRoot = page.getByRole('treeitem').first()
  await treeRoot.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^reload$/i }).click()

  // File list panel must still show Documents content
  await expect(page.getByText('1 item')).toBeVisible()
  await expect(page.getByText('report.md')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Refreshing does not reload the whole page
// ---------------------------------------------------------------------------

test('refreshing via file list panel button does not trigger a full page reload', async ({
  page,
}) => {
  await setupMocks(page)
  await page.goto('/')

  let reloaded = false
  page.on('load', () => {
    reloaded = true
  })

  await page.getByRole('button', { name: /reload directory/i }).click()
  await page.waitForTimeout(200)

  expect(reloaded).toBe(false)
})
