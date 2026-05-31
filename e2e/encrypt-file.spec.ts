import { test, expect, Page } from '@playwright/test'

// ─── types ───────────────────────────────────────────────────────────────────

type MockEntry = { name: string; isDirectory: boolean; isSymlink: boolean }
type EncryptFileOptions = {
  input_path: string
  output_path: string
  recipient_fingerprints: string[]
  passphrase?: string
}

// ─── constants ────────────────────────────────────────────────────────────────

const HOME = '/home/testuser'

const HOME_ENTRIES: MockEntry[] = [
  { name: 'Documents', isDirectory: true, isSymlink: false },
  { name: 'report.md', isDirectory: false, isSymlink: false },
  { name: 'notes.txt', isDirectory: false, isSymlink: false },
  { name: 'secret.gpg', isDirectory: false, isSymlink: false },
  { name: 'key.pgp', isDirectory: false, isSymlink: false },
]

const HOME_ENTRIES_AFTER_ENCRYPT: MockEntry[] = [
  { name: 'Documents', isDirectory: true, isSymlink: false },
  { name: 'report.md', isDirectory: false, isSymlink: false },
  { name: 'report.md.gpg', isDirectory: false, isSymlink: false },
  { name: 'notes.txt', isDirectory: false, isSymlink: false },
  { name: 'secret.gpg', isDirectory: false, isSymlink: false },
  { name: 'key.pgp', isDirectory: false, isSymlink: false },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

interface InjectOptions {
  homeDir?: string
  tree?: Record<string, MockEntry[]>
  encryptResult?: 'success' | 'error'
  encryptErrorMessage?: string
  /** When true the mock switches to the updated tree after encrypt is called */
  treeAfterEncrypt?: Record<string, MockEntry[]>
}

async function injectMocks(
  page: Page,
  {
    homeDir = HOME,
    tree = {},
    encryptResult = 'success',
    encryptErrorMessage = 'Permission denied',
    treeAfterEncrypt,
  }: InjectOptions = {},
) {
  await page.addInitScript(
    ({
      h,
      t,
      t2,
      result,
      errorMsg,
    }: {
      h: string
      t: Record<string, MockEntry[]>
      t2: Record<string, MockEntry[]> | null
      result: 'success' | 'error'
      errorMsg: string
    }) => {
      let encryptCalled = false

      ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
      ;(
        window as {
          __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[]
        }
      ).__E2E_MOCK_READ_DIR__ = (path: string) => {
        const activeTree = encryptCalled && t2 ? t2 : t
        return activeTree[path] ?? []
      }
      ;(
        window as {
          __E2E_MOCK_ENCRYPT_FILE__?: (opts: EncryptFileOptions) => Promise<void>
        }
      ).__E2E_MOCK_ENCRYPT_FILE__ = (_opts: EncryptFileOptions) => {
        encryptCalled = true
        if (result === 'error') {
          return Promise.reject(new Error(errorMsg))
        }
        return Promise.resolve()
      }
    },
    {
      h: homeDir,
      t: tree,
      t2: treeAfterEncrypt ?? null,
      result: encryptResult,
      errorMsg: encryptErrorMessage,
    },
  )
}

/** Open the encrypt dialog for a given file by right-clicking it. */
async function openEncryptDialog(page: Page, fileName: string) {
  const row = page.getByRole('row').filter({ hasText: fileName }).first()
  await expect(row).toBeVisible()
  await row.click({ button: 'right' })
  const menuItem = page.getByRole('menuitem', { name: /encrypt file/i })
  await expect(menuItem).toBeVisible()
  await menuItem.click()
  await expect(page.getByRole('dialog', { name: /encrypt file/i })).toBeVisible()
}

// ─── AC1: tab bar ─────────────────────────────────────────────────────────────

test.describe('mode tab bar', () => {
  test('Encrypt tab is active by default', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const encryptTab = page.getByRole('tab', { name: /^encrypt$/i })
    await expect(encryptTab).toBeVisible()
    await expect(encryptTab).toHaveAttribute('aria-selected', 'true')
  })

  test('Decrypt tab is visible', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const decryptTab = page.getByRole('tab', { name: /^decrypt$/i })
    await expect(decryptTab).toBeVisible()
  })

  test('clicking Decrypt tab makes it active', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const decryptTab = page.getByRole('tab', { name: /^decrypt$/i })
    await decryptTab.click()
    await expect(decryptTab).toHaveAttribute('aria-selected', 'true')

    const encryptTab = page.getByRole('tab', { name: /^encrypt$/i })
    await expect(encryptTab).toHaveAttribute('aria-selected', 'false')
  })
})

// ─── AC2: encrypted files greyed out in encrypt mode ─────────────────────────

test.describe('encrypted files in encrypt mode', () => {
  test('.gpg file row has cursor-not-allowed in encrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    await expect(page.getByText('secret.gpg')).toBeVisible()
    const gpgRow = page.getByRole('row').filter({ hasText: 'secret.gpg' }).first()
    await expect(gpgRow).toHaveClass(/cursor-not-allowed/)
  })

  test('.pgp file row has cursor-not-allowed in encrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    await expect(page.getByText('key.pgp')).toBeVisible()
    const pgpRow = page.getByRole('row').filter({ hasText: 'key.pgp' }).first()
    await expect(pgpRow).toHaveClass(/cursor-not-allowed/)
  })

  test('.gpg file row has reduced opacity in encrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const gpgRow = page.getByRole('row').filter({ hasText: 'secret.gpg' }).first()
    await expect(gpgRow).toHaveClass(/opacity-40/)
  })

  test('.gpg file row does not show context menu on right-click', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    const gpgRow = page.getByRole('row').filter({ hasText: 'secret.gpg' }).first()
    await expect(gpgRow).toBeVisible()
    // Use force because aria-disabled rows are not interactable; we still want to verify no menu appears
    await gpgRow.dispatchEvent('contextmenu')

    // No context menu should appear
    await expect(page.getByRole('menuitem', { name: /encrypt file/i })).not.toBeVisible()
  })
})

// ─── AC3: context menu on non-encrypted files ─────────────────────────────────

test.describe('context menu on non-encrypted files', () => {
  test('right-clicking a plain file shows Encrypt file menu item', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    await expect(page.getByText('report.md')).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'report.md' }).first()
    await row.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /encrypt file/i })).toBeVisible()
  })
})

// ─── AC4: encrypt dialog content ─────────────────────────────────────────────

test.describe('encrypt dialog content', () => {
  test('dialog shows source filename and computed output filename', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    const dialog = page.getByRole('dialog', { name: /encrypt file/i })
    // Use exact match to avoid 'report.md' substring-matching 'report.md.gpg'
    await expect(dialog.getByText('report.md', { exact: true })).toBeVisible()
    await expect(dialog.getByText('report.md.gpg')).toBeVisible()
  })

  test('dialog has a Passphrase field and a Confirm passphrase field', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await expect(page.getByLabel(/^passphrase$/i)).toBeVisible()
    await expect(page.getByLabel(/confirm passphrase/i)).toBeVisible()
  })
})

// ─── AC5: empty passphrase validation ────────────────────────────────────────

test.describe('encrypt dialog validation', () => {
  test('shows error when passphrase is empty', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByRole('button', { name: /^encrypt$/i }).click()

    await expect(page.getByRole('alert')).toContainText(/passphrase must not be empty/i)
    await expect(page.getByRole('dialog', { name: /encrypt file/i })).toBeVisible()
  })

  // ─── AC6: short passphrase validation ──────────────────────────────────────

  test('shows error when passphrase is shorter than 8 characters', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('short')
    await page.getByLabel(/confirm passphrase/i).fill('short')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    await expect(page.getByRole('alert')).toContainText(/at least 8 characters/i)
    await expect(page.getByRole('dialog', { name: /encrypt file/i })).toBeVisible()
  })

  // ─── AC7: mismatched passphrase validation ──────────────────────────────────

  test('shows error when passphrases do not match', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('correcthorsebattery')
    await page.getByLabel(/confirm passphrase/i).fill('differentpassword')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    await expect(page.getByRole('alert')).toContainText(/passphrases do not match/i)
    await expect(page.getByRole('dialog', { name: /encrypt file/i })).toBeVisible()
  })
})

// ─── AC8: eye-toggle visibility ───────────────────────────────────────────────

test.describe('passphrase visibility toggles', () => {
  test('passphrase field defaults to type=password and can be revealed', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    const passphraseInput = page.getByLabel(/^passphrase$/i)
    await expect(passphraseInput).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: /show passphrase/i }).click()
    await expect(passphraseInput).toHaveAttribute('type', 'text')
  })

  test('passphrase field can be hidden again after revealing', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByRole('button', { name: /show passphrase/i }).click()
    await page.getByRole('button', { name: /hide passphrase/i }).click()

    await expect(page.getByLabel(/^passphrase$/i)).toHaveAttribute('type', 'password')
  })

  test('confirm passphrase field defaults to type=password and can be revealed independently', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    const confirmInput = page.getByLabel(/confirm passphrase/i)
    await expect(confirmInput).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: /show confirmation passphrase/i }).click()
    await expect(confirmInput).toHaveAttribute('type', 'text')

    // Main passphrase field is unaffected
    await expect(page.getByLabel(/^passphrase$/i)).toHaveAttribute('type', 'password')
  })
})

// ─── AC9: successful encryption ───────────────────────────────────────────────

test.describe('successful encryption', () => {
  test('dialog closes and success toast appears after encrypt', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      treeAfterEncrypt: { [HOME]: HOME_ENTRIES_AFTER_ENCRYPT },
      encryptResult: 'success',
    })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('supersecret')
    await page.getByLabel(/confirm passphrase/i).fill('supersecret')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    // Dialog should close
    await expect(page.getByRole('dialog', { name: /encrypt file/i })).not.toBeVisible()

    // Success toast should appear
    await expect(page.getByText(/report\.md encrypted → report\.md\.gpg/i)).toBeVisible()
  })

  test('file list refreshes and new .gpg file appears greyed out', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      treeAfterEncrypt: { [HOME]: HOME_ENTRIES_AFTER_ENCRYPT },
      encryptResult: 'success',
    })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('supersecret')
    await page.getByLabel(/confirm passphrase/i).fill('supersecret')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    // New .gpg file should appear in the list (scoped to the file table to avoid matching the toast)
    const fileTable = page.getByRole('table', { name: /file list/i })
    await expect(fileTable.getByText('report.md.gpg')).toBeVisible()

    // It should be greyed out (disabled) in encrypt mode
    const newGpgRow = page.getByRole('row').filter({ hasText: 'report.md.gpg' }).first()
    await expect(newGpgRow).toHaveClass(/cursor-not-allowed/)
  })

  // ─── AC10: silent overwrite ─────────────────────────────────────────────────

  test('no overwrite confirmation when output file already exists', async ({ page }) => {
    // The tree already has report.md.gpg — simulating an overwrite scenario
    const treeWithExistingGpg: MockEntry[] = [
      ...HOME_ENTRIES,
      { name: 'report.md.gpg', isDirectory: false, isSymlink: false },
    ]
    await injectMocks(page, {
      tree: { [HOME]: treeWithExistingGpg },
      treeAfterEncrypt: { [HOME]: treeWithExistingGpg },
      encryptResult: 'success',
    })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('supersecret')
    await page.getByLabel(/confirm passphrase/i).fill('supersecret')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    // No confirmation dialog should appear — encrypt dialog closes directly
    await expect(page.getByRole('dialog', { name: /encrypt file/i })).not.toBeVisible()
    // No second dialog asking about overwrite
    await expect(page.getByText(/already exists|overwrite|replace/i)).not.toBeVisible()
  })
})

// ─── AC12: backend error surfaced inline ─────────────────────────────────────

test.describe('backend error handling', () => {
  test('backend error appears inside dialog without closing it', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      encryptResult: 'error',
      encryptErrorMessage: 'Permission denied: cannot write to /home/testuser/report.md.gpg',
    })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('supersecret')
    await page.getByLabel(/confirm passphrase/i).fill('supersecret')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    // Dialog stays open
    await expect(page.getByRole('dialog', { name: /encrypt file/i })).toBeVisible()

    // Error is surfaced inline
    await expect(page.getByRole('alert')).toContainText(/permission denied/i)
  })

  test('app does not crash on backend error', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      encryptResult: 'error',
      encryptErrorMessage: 'Unexpected failure',
    })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('supersecret')
    await page.getByLabel(/confirm passphrase/i).fill('supersecret')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    // Dialog stays open with an error — proving the app has not crashed or reloaded.
    // (The modal applies aria-hidden to the rest of the page, so we check inside the dialog.)
    await expect(page.getByRole('dialog', { name: /encrypt file/i })).toBeVisible()
    await expect(page.getByRole('alert')).toBeVisible()
  })
})

// ─── Loading state during encryption ──────────────────────────────────────────

test.describe('loading state while encrypting', () => {
  test('Encrypt and Cancel buttons are disabled while encrypting', async ({ page }) => {
    // Use a mock that never resolves so we can observe the loading state
    await page.addInitScript(({ h, t }: { h: string; t: Record<string, MockEntry[]> }) => {
      ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
      ;(
        window as { __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[] }
      ).__E2E_MOCK_READ_DIR__ = (path: string) => t[path] ?? []
      ;(
        window as { __E2E_MOCK_ENCRYPT_FILE__?: () => Promise<void> }
      ).__E2E_MOCK_ENCRYPT_FILE__ = () => new Promise(() => {/* never resolves */})
    }, { h: HOME, t: { [HOME]: HOME_ENTRIES } })

    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('supersecret')
    await page.getByLabel(/confirm passphrase/i).fill('supersecret')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    await expect(page.getByRole('button', { name: /^encrypt$/i })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeDisabled()
  })

  test('progress bar and status text appear while encrypting', async ({ page }) => {
    await page.addInitScript(({ h, t }: { h: string; t: Record<string, MockEntry[]> }) => {
      ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
      ;(
        window as { __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[] }
      ).__E2E_MOCK_READ_DIR__ = (path: string) => t[path] ?? []
      ;(
        window as { __E2E_MOCK_ENCRYPT_FILE__?: () => Promise<void> }
      ).__E2E_MOCK_ENCRYPT_FILE__ = () => new Promise(() => {/* never resolves */})
    }, { h: HOME, t: { [HOME]: HOME_ENTRIES } })

    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByLabel(/^passphrase$/i).fill('supersecret')
    await page.getByLabel(/confirm passphrase/i).fill('supersecret')
    await page.getByRole('button', { name: /^encrypt$/i }).click()

    await expect(page.getByRole('progressbar', { name: /encrypting/i })).toBeVisible()
    await expect(page.getByText(/encrypting file, please wait/i)).toBeVisible()
  })

  test('Cancel button dismisses the dialog', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await openEncryptDialog(page, 'report.md')

    await page.getByRole('button', { name: /^cancel$/i }).click()

    await expect(page.getByRole('dialog', { name: /encrypt file/i })).not.toBeVisible()
  })
})
