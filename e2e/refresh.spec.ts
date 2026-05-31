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
// Refresh button in the ModeTabBar
// ---------------------------------------------------------------------------

test('refresh button is present in the mode tab bar', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  const refreshBtn = page.getByRole('button', { name: /refresh current directory/i })
  await expect(refreshBtn).toBeVisible()
})

test('refresh button is positioned after the Encrypt/Decrypt tabs', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  const tabBar = page
    .locator('.flex.h-10')
    .filter({ has: page.getByRole('tab', { name: /encrypt/i }) })
  const refreshBtn = tabBar.getByRole('button', { name: /refresh current directory/i })
  await expect(refreshBtn).toBeVisible()

  // Tabs come before the Refresh button in the DOM
  const encryptTab = tabBar.getByRole('tab', { name: /encrypt/i })
  const encryptBox = await encryptTab.boundingBox()
  const refreshBox = await refreshBtn.boundingBox()
  expect(encryptBox).not.toBeNull()
  expect(refreshBox).not.toBeNull()
  expect(refreshBox!.x).toBeGreaterThan(encryptBox!.x)
})

test('refresh button in tab bar shows tooltip on hover', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  const refreshBtn = page.getByRole('button', { name: /refresh current directory/i })
  await refreshBtn.hover()
  await expect(page.getByText('Refresh')).toBeVisible()
})

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

test('context menu on folder node contains only Reload as menu item', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  const treeRoot = page.getByRole('treeitem').first()
  await treeRoot.click({ button: 'right' })

  const menuItems = page.getByRole('menuitem')
  await expect(menuItems).toHaveCount(1)
  await expect(menuItems.first()).toHaveText(/^reload$/i)
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
// Clicking Refresh button (tab bar) updates the file list
// ---------------------------------------------------------------------------

test('tab bar refresh button re-reads the current directory and updates the file list', async ({
  page,
}) => {
  await setupMocks(page)
  await page.goto('/')

  // Wait for initial load: 3 items (Documents, notes.txt, secret.gpg)
  await expect(page.getByText('3 items')).toBeVisible()

  // Update the mock to return one extra file
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
          { name: 'secret.gpg', isDirectory: false, isSymlink: false },
          { name: 'new-file.txt', isDirectory: false, isSymlink: false },
        ]
      }
      return []
    }
  })

  await page.getByRole('button', { name: /refresh current directory/i }).click()

  await expect(page.getByText('4 items')).toBeVisible()
  await expect(page.getByText('new-file.txt')).toBeVisible()
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

test('refreshing via tab bar button does not trigger a full page reload', async ({ page }) => {
  await setupMocks(page)
  await page.goto('/')

  let reloaded = false
  page.on('load', () => {
    reloaded = true
  })

  await page.getByRole('button', { name: /refresh current directory/i }).click()
  // Allow any pending microtasks to settle
  await page.waitForTimeout(200)

  expect(reloaded).toBe(false)
})

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

// ---------------------------------------------------------------------------
// Refreshing does not collapse sidebar tree state
// ---------------------------------------------------------------------------

test('refreshing via tab bar button preserves the sidebar expanded/collapsed state', async ({
  page,
}) => {
  await setupMocks(page)
  await page.goto('/')

  // The root node starts expanded after initial load; expand Documents too
  const documentsNode = page.getByRole('treeitem', { name: /documents/i })
  await expect(documentsNode).toBeVisible()
  await documentsNode.click()

  // Verify Documents is now expanded (aria-expanded="true")
  await expect(documentsNode).toHaveAttribute('aria-expanded', 'true')

  // Trigger a refresh from the tab bar button
  await page.getByRole('button', { name: /refresh current directory/i }).click()
  await page.waitForTimeout(200)

  // Documents node should remain expanded after refresh
  await expect(documentsNode).toBeVisible()
  await expect(documentsNode).toHaveAttribute('aria-expanded', 'true')
})

// ---------------------------------------------------------------------------
// Refreshing does not reset the file list scroll position
// ---------------------------------------------------------------------------

test('refreshing does not unmount the file list panel (scroll position is preserved)', async ({
  page,
}) => {
  // The spec requires that refresh does not reset scroll position.
  // In the test environment the scroll area grows unconstrained so we cannot
  // read a non-zero scrollTop. Instead we verify the stronger underlying
  // guarantee: the FileList DOM node is NOT recreated on refresh.  If the
  // component were remounted (old behaviour with React `key`) the DOM node
  // would be brand-new and any custom attribute stamped on it would be gone.
  await setupMocks(page)
  await page.goto('/')

  await expect(page.getByText('3 items')).toBeVisible()

  // Stamp a sentinel attribute on the file-list scroll-area viewport so we
  // can detect a remount.
  await page.evaluate(() => {
    const viewports = document.querySelectorAll('[data-slot="scroll-area-viewport"]')
    const fileListViewport = viewports[viewports.length - 1]
    fileListViewport?.setAttribute('data-refresh-test-marker', 'alive')
  })

  // Verify the marker was set
  const markerBefore = await page.evaluate(() => {
    const viewports = document.querySelectorAll('[data-slot="scroll-area-viewport"]')
    return viewports[viewports.length - 1]?.getAttribute('data-refresh-test-marker')
  })
  expect(markerBefore).toBe('alive')

  // Trigger refresh from the tab bar button
  await page.getByRole('button', { name: /refresh current directory/i }).click()
  await expect(page.getByText('3 items')).toBeVisible()

  // The same DOM node must still exist — marker is preserved ↔ no remount
  const markerAfter = await page.evaluate(() => {
    const viewports = document.querySelectorAll('[data-slot="scroll-area-viewport"]')
    return viewports[viewports.length - 1]?.getAttribute('data-refresh-test-marker')
  })
  expect(markerAfter).toBe('alive')
})
