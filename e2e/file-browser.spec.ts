import { test, expect, Page } from '@playwright/test'

// ─── helpers ────────────────────────────────────────────────────────────────

type MockEntry = { name: string; isDirectory: boolean; isSymlink: boolean }

/** Inject mock filesystem data before the page loads. */
async function injectMocks(
  page: Page,
  {
    homeDir = '/home/testuser',
    tree = {} as Record<string, MockEntry[]>,
  }: {
    homeDir?: string
    tree?: Record<string, MockEntry[]>
  } = {},
) {
  await page.addInitScript(
    ({ h, t }: { h: string; t: Record<string, MockEntry[]> }) => {
      ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
      ;(
        window as {
          __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[]
        }
      ).__E2E_MOCK_READ_DIR__ = (path: string) => t[path] ?? []
    },
    { h: homeDir, t: tree },
  )
}

const HOME = '/home/testuser'
const HOME_ENTRIES: MockEntry[] = [
  { name: 'Desktop', isDirectory: true, isSymlink: false },
  { name: 'Documents', isDirectory: true, isSymlink: false },
  { name: 'Downloads', isDirectory: true, isSymlink: false },
  { name: 'notes.txt', isDirectory: false, isSymlink: false },
  { name: 'report.md', isDirectory: false, isSymlink: false },
  { name: 'secret.gpg', isDirectory: false, isSymlink: false },
  { name: 'key.pgp', isDirectory: false, isSymlink: false },
  { name: 'budget.xlsx', isDirectory: false, isSymlink: false },
]

const DOCS_PATH = `${HOME}/Documents`
const DOCS_ENTRIES: MockEntry[] = [
  { name: 'Projects', isDirectory: true, isSymlink: false },
  { name: 'readme.md', isDirectory: false, isSymlink: false },
]

// ─── AC1: two-panel dashboard ────────────────────────────────────────────────

test.describe('two-panel dashboard layout', () => {
  test('header toolbar is visible with Home and Open-folder buttons', async ({ page }) => {
    await injectMocks(page)
    await page.goto('/')

    await expect(page.getByRole('banner')).toBeVisible()
    await expect(page.getByRole('button', { name: /go to home directory/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /open folder/i })).toBeVisible()
  })

  test('sidebar folder tree and file-list panels both render', async ({ page }) => {
    await injectMocks(page)
    await page.goto('/')

    await expect(page.getByRole('tree', { name: /folder tree/i })).toBeVisible()
    // file list panel is present — either showing content or empty state
    const panel = page.getByRole('table', { name: /file list/i })
    const emptyState = page.getByText(/select a folder from the sidebar/i)
    await expect(panel.or(emptyState)).toBeVisible()
  })

  test('resizable divider handle is present between the two panels', async ({ page }) => {
    await injectMocks(page)
    await page.goto('/')

    // Shadcn ResizableHandle renders with data-slot="resizable-handle"
    const handle = page.locator('[data-slot="resizable-handle"]')
    await expect(handle).toBeVisible()
  })
})

// ─── AC3: folder tree expand + file-list population ──────────────────────────

test.describe('sidebar folder tree navigation', () => {
  test('root node is visible and auto-expanded on load', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: { [HOME]: HOME_ENTRIES },
    })
    await page.goto('/')

    // Root node label matches the last path segment
    const rootItem = page.getByRole('treeitem', { name: /testuser/i })
    await expect(rootItem).toBeVisible()
    await expect(rootItem).toHaveAttribute('aria-expanded', 'true')
  })

  test('clicking a folder node selects it and populates the file list', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: {
        [HOME]: HOME_ENTRIES,
        [DOCS_PATH]: DOCS_ENTRIES,
      },
    })
    await page.goto('/')

    // Wait for root to expand and Documents to appear
    const docsNode = page.getByRole('treeitem', { name: 'Documents' })
    await expect(docsNode).toBeVisible()

    await docsNode.click()

    // File list should now show Documents contents
    await expect(page.getByRole('table', { name: /file list/i })).toBeVisible()
    await expect(page.getByText('readme.md')).toBeVisible()
  })

  test('expanding a folder node reveals its children', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: {
        [HOME]: HOME_ENTRIES,
        [DOCS_PATH]: DOCS_ENTRIES,
      },
    })
    await page.goto('/')

    const docsNode = page.getByRole('treeitem', { name: 'Documents' })
    await expect(docsNode).toBeVisible()
    await docsNode.click()

    // Projects child should appear in the tree
    const projectsNode = page.getByRole('treeitem', { name: 'Projects' })
    await expect(projectsNode).toBeVisible()
  })

  test('keyboard navigation: Enter on a treeitem selects and expands it', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: {
        [HOME]: HOME_ENTRIES,
        [DOCS_PATH]: DOCS_ENTRIES,
      },
    })
    await page.goto('/')

    const docsNode = page.getByRole('treeitem', { name: 'Documents' })
    await docsNode.focus()
    await page.keyboard.press('Enter')

    await expect(docsNode).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('readme.md')).toBeVisible()
  })
})

// ─── AC4: breadcrumb navigation ──────────────────────────────────────────────

test.describe('breadcrumb toolbar', () => {
  test('breadcrumb reflects the selected folder path', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: { [HOME]: HOME_ENTRIES },
    })
    await page.goto('/')

    // /home/testuser → segments: home, testuser (last is current page, non-clickable)
    const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i })
    await expect(breadcrumb).toBeVisible()
    await expect(breadcrumb.getByText('testuser')).toBeVisible()
  })

  test('clicking an ancestor breadcrumb segment navigates to that directory', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: {
        [HOME]: HOME_ENTRIES,
        [DOCS_PATH]: DOCS_ENTRIES,
        '/home': [{ name: 'testuser', isDirectory: true, isSymlink: false }],
      },
    })
    await page.goto('/')

    // Navigate into Documents first
    const docsNode = page.getByRole('treeitem', { name: 'Documents' })
    await expect(docsNode).toBeVisible()
    await docsNode.click()

    // Breadcrumb should now show …/home/testuser/Documents
    const breadcrumb = page.getByRole('navigation', { name: /breadcrumb/i })
    await expect(breadcrumb.getByText('Documents')).toBeVisible()

    // Click the 'testuser' breadcrumb link to navigate back
    // BreadcrumbLink is an <a> with href="#"; BreadcrumbPage has role="link" aria-current="page"
    // So filter to only the clickable (non-disabled) link
    await breadcrumb.locator('a', { hasText: 'testuser' }).click()

    // After navigation to /home/testuser, testuser becomes the current page (aria-current="page")
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('testuser')
    // And it is no longer a clickable <a> element
    await expect(breadcrumb.locator('a', { hasText: 'testuser' })).toHaveCount(0)
  })
})

// ─── AC6: sidebar resize ─────────────────────────────────────────────────────

test.describe('panel resize', () => {
  test('keyboard-resizing the handle changes the sidebar width', async ({ page }) => {
    await injectMocks(page)
    await page.goto('/')

    const handle = page.locator('[data-slot="resizable-handle"]')
    await expect(handle).toBeVisible()

    // Measure sidebar panel width before resize
    const sidebarPanel = page.locator('[data-slot="resizable-panel"]').first()
    const beforeBox = await sidebarPanel.boundingBox()
    expect(beforeBox).not.toBeNull()

    // react-resizable-panels supports keyboard resize: focus handle and use arrow keys.
    // ArrowLeft shrinks the sidebar; verify the width decreases.
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')

    const afterBox = await sidebarPanel.boundingBox()
    expect(afterBox!.width).toBeLessThan(beforeBox!.width)
  })
})

// ─── AC7: file-type icons ────────────────────────────────────────────────────

test.describe('file-type icons in file list', () => {
  test('.gpg file displays the Lock icon', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: { [HOME]: HOME_ENTRIES },
    })
    await page.goto('/')

    // Wait for the home directory to load in the file list
    await expect(page.getByText('secret.gpg')).toBeVisible()

    // The Lock icon has an aria-hidden sibling; verify the row contains the amber lock
    const gpgRow = page.getByRole('row').filter({ has: page.getByText('secret.gpg') })
    // Lock icon is rendered via lucide — it has a recognisable SVG class from Tailwind
    await expect(gpgRow.locator('svg.text-amber-400')).toBeVisible()
  })

  test('.pgp file also displays the Lock icon', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: { [HOME]: HOME_ENTRIES },
    })
    await page.goto('/')

    await expect(page.getByText('key.pgp')).toBeVisible()
    const pgpRow = page.getByRole('row').filter({ has: page.getByText('key.pgp') })
    await expect(pgpRow.locator('svg.text-amber-400')).toBeVisible()
  })

  test('.gpg file shows GPG type badge', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: { [HOME]: HOME_ENTRIES },
    })
    await page.goto('/')

    const gpgRow = page.getByRole('row').filter({ has: page.getByText('secret.gpg') })
    // Use exact: true to avoid matching the filename 'secret.gpg' which contains 'gpg'
    await expect(gpgRow.getByText('GPG', { exact: true })).toBeVisible()
  })

  test('directory entry shows a Directory type badge', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: { [HOME]: HOME_ENTRIES },
    })
    await page.goto('/')

    const dirRow = page.getByRole('row').filter({ has: page.getByText('Desktop') })
    await expect(dirRow.getByText('Directory')).toBeVisible()
  })
})

// ─── AC8: empty directory ─────────────────────────────────────────────────────

test.describe('empty and error states', () => {
  test('shows empty-state message when no folder is selected', async ({ page }) => {
    await injectMocks(page)
    await page.goto('/')

    await expect(page.getByText(/select a folder from the sidebar to browse its contents/i)).toBeVisible()
  })

  test('shows empty-state message when a directory has no entries', async ({ page }) => {
    await injectMocks(page, {
      homeDir: HOME,
      tree: { [HOME]: [] }, // root returns empty
    })
    await page.goto('/')

    await expect(page.getByText(/select a folder from the sidebar to browse its contents/i)).toBeVisible()
  })

  // AC9: permission / error state
  test('shows inline error banner when readDir throws', async ({ page }) => {
    const RESTRICTED = '/home/restricted'
    await page.addInitScript(({ h, r }: { h: string; r: string }) => {
      ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
      ;(
        window as {
          __E2E_MOCK_READ_DIR__?: (p: string) => never
        }
      ).__E2E_MOCK_READ_DIR__ = (path: string) => {
        throw new Error(`Permission denied: ${path}`)
      }
      void r
    }, { h: RESTRICTED, r: RESTRICTED })
    await page.goto('/')

    // Error banner should render — not a crash / blank screen
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByText(/permission denied/i)).toBeVisible()
  })
})

// ─── AC2 smoke: native window (browser-mode parity) ──────────────────────────

test('homepage loads the dashboard with header, tree, and file-list area', async ({ page }) => {
  await injectMocks(page, {
    homeDir: HOME,
    tree: { [HOME]: HOME_ENTRIES },
  })
  await page.goto('/')

  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('tree', { name: /folder tree/i })).toBeVisible()
  // File list renders (has reload button)
  await expect(page.getByRole('button', { name: /reload directory/i })).toBeVisible()
})
