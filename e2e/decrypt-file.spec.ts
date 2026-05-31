import { test, expect, Page } from '@playwright/test'

// ─── types ───────────────────────────────────────────────────────────────────

type MockEntry = { name: string; isDirectory: boolean; isSymlink: boolean }
type DecryptFileOptions = {
  input_path: string
  output_path: string
  passphrase: string
}

// ─── constants ────────────────────────────────────────────────────────────────

const HOME = '/home/testuser'

const HOME_ENTRIES: MockEntry[] = [
  { name: 'Documents', isDirectory: true, isSymlink: false },
  { name: 'report.md.gpg', isDirectory: false, isSymlink: false },
  { name: 'archive.pgp', isDirectory: false, isSymlink: false },
  { name: 'notes.txt', isDirectory: false, isSymlink: false },
  { name: 'budget.xlsx', isDirectory: false, isSymlink: false },
]

const HOME_ENTRIES_AFTER_DECRYPT: MockEntry[] = [
  { name: 'Documents', isDirectory: true, isSymlink: false },
  { name: 'report.md', isDirectory: false, isSymlink: false },
  { name: 'report.md.gpg', isDirectory: false, isSymlink: false },
  { name: 'archive.pgp', isDirectory: false, isSymlink: false },
  { name: 'notes.txt', isDirectory: false, isSymlink: false },
  { name: 'budget.xlsx', isDirectory: false, isSymlink: false },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

interface InjectOptions {
  homeDir?: string
  tree?: Record<string, MockEntry[]>
  decryptResult?: 'success' | 'error'
  decryptErrorMessage?: string
  treeAfterDecrypt?: Record<string, MockEntry[]>
}

async function injectMocks(
  page: Page,
  {
    homeDir = HOME,
    tree = {},
    decryptResult = 'success',
    decryptErrorMessage = 'no matching secret key found',
    treeAfterDecrypt,
  }: InjectOptions = {}
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
      let decryptCalled = false

      ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
      ;(
        window as {
          __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[]
        }
      ).__E2E_MOCK_READ_DIR__ = (path: string) => {
        const activeTree = decryptCalled && t2 ? t2 : t
        return activeTree[path] ?? []
      }
      ;(
        window as {
          __E2E_MOCK_DECRYPT_FILE__?: (opts: DecryptFileOptions) => Promise<void>
        }
      ).__E2E_MOCK_DECRYPT_FILE__ = (_opts: DecryptFileOptions) => {
        decryptCalled = true
        if (result === 'error') {
          return Promise.reject(new Error(errorMsg))
        }
        return Promise.resolve()
      }
    },
    {
      h: homeDir,
      t: tree,
      t2: treeAfterDecrypt ?? null,
      result: decryptResult,
      errorMsg: decryptErrorMessage,
    }
  )
}

/** Switch to the Decrypt tab. */
async function switchToDecryptMode(page: Page) {
  const decryptTab = page.getByRole('tab', { name: /^decrypt$/i })
  await expect(decryptTab).toBeVisible()
  await decryptTab.click()
  await expect(decryptTab).toHaveAttribute('aria-selected', 'true')
}

/** Open the decrypt dialog for a given file by right-clicking it. */
async function openDecryptDialog(page: Page, fileName: string) {
  const row = page.getByRole('row').filter({ hasText: fileName }).first()
  await expect(row).toBeVisible()
  await row.click({ button: 'right' })
  const menuItem = page.getByRole('menuitem', { name: /decrypt file/i })
  await expect(menuItem).toBeVisible()
  await menuItem.click()
  await expect(page.getByRole('dialog', { name: /decrypt file/i })).toBeVisible()
}

// ─── AC1: Decrypt tab activation ──────────────────────────────────────────────

test.describe('decrypt tab activation', () => {
  test('clicking Decrypt tab makes it active and switches to decrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    await switchToDecryptMode(page)

    const encryptTab = page.getByRole('tab', { name: /^encrypt$/i })
    await expect(encryptTab).toHaveAttribute('aria-selected', 'false')
  })
})

// ─── AC2: Non-gpg/pgp files greyed out in decrypt mode ───────────────────────

test.describe('non-encrypted files in decrypt mode', () => {
  test('.txt file row has cursor-not-allowed in decrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    await expect(page.getByText('notes.txt')).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await expect(row).toHaveClass(/cursor-not-allowed/)
  })

  test('.txt file row has reduced opacity in decrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    const row = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await expect(row).toHaveClass(/opacity-40/)
  })

  test('.xlsx file row has cursor-not-allowed in decrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    await expect(page.getByText('budget.xlsx')).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'budget.xlsx' }).first()
    await expect(row).toHaveClass(/cursor-not-allowed/)
  })

  test('.txt file row does not show context menu on right-click in decrypt mode', async ({
    page,
  }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    const row = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await row.dispatchEvent('contextmenu')

    await expect(page.getByRole('menuitem', { name: /decrypt file/i })).not.toBeVisible()
  })
})

// ─── AC3: Directories not greyed out in decrypt mode ─────────────────────────

test.describe('directories in decrypt mode', () => {
  test('directory row does not have cursor-not-allowed in decrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    // Scope to the file list table to avoid matching sidebar treeitems
    const fileTable = page.getByRole('table', { name: /file list/i })
    const row = fileTable.getByRole('row').filter({ hasText: 'Documents' }).first()
    await expect(row).not.toHaveClass(/cursor-not-allowed/)
  })

  test('directory row does not have reduced opacity in decrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    const fileTable = page.getByRole('table', { name: /file list/i })
    const row = fileTable.getByRole('row').filter({ hasText: 'Documents' }).first()
    await expect(row).not.toHaveClass(/opacity-40/)
  })
})

// ─── AC4 & AC5: .gpg/.pgp files selectable and show context menu ──────────────

test.describe('encrypted files in decrypt mode', () => {
  test('.gpg file row does not have cursor-not-allowed in decrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    await expect(page.getByText('report.md.gpg')).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'report.md.gpg' }).first()
    await expect(row).not.toHaveClass(/cursor-not-allowed/)
  })

  test('.pgp file row does not have cursor-not-allowed in decrypt mode', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    await expect(page.getByText('archive.pgp')).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'archive.pgp' }).first()
    await expect(row).not.toHaveClass(/cursor-not-allowed/)
  })

  test('right-clicking a .gpg file shows Decrypt file menu item', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    const row = page.getByRole('row').filter({ hasText: 'report.md.gpg' }).first()
    await row.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /decrypt file/i })).toBeVisible()
  })

  test('right-clicking a .pgp file shows Decrypt file menu item', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)

    const row = page.getByRole('row').filter({ hasText: 'archive.pgp' }).first()
    await row.click({ button: 'right' })

    await expect(page.getByRole('menuitem', { name: /decrypt file/i })).toBeVisible()
  })
})

// ─── AC6: Decrypt dialog content ─────────────────────────────────────────────

test.describe('decrypt dialog content', () => {
  test('dialog shows source filename and computed output filename', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    const dialog = page.getByRole('dialog', { name: /decrypt file/i })
    // Use exact match to avoid 'report.md' substring-matching 'report.md.gpg'
    await expect(dialog.getByText('report.md.gpg', { exact: true })).toBeVisible()
    await expect(dialog.getByText('report.md', { exact: true })).toBeVisible()
  })

  test('dialog has a single Passphrase field and no confirmation field', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await expect(page.getByLabel(/^passphrase$/i)).toBeVisible()
    await expect(page.getByLabel(/confirm/i)).not.toBeVisible()
  })
})

// ─── AC7: Empty passphrase validation ────────────────────────────────────────

test.describe('decrypt dialog validation', () => {
  test('shows error when passphrase is empty', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByRole('button', { name: /^decrypt$/i }).click()

    await expect(page.getByRole('alert')).toContainText(/passphrase must not be empty/i)
    await expect(page.getByRole('dialog', { name: /decrypt file/i })).toBeVisible()
  })
})

// ─── AC8: Eye-toggle visibility ───────────────────────────────────────────────

test.describe('passphrase visibility toggle', () => {
  test('passphrase field defaults to type=password and can be revealed', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    const passphraseInput = page.getByLabel(/^passphrase$/i)
    await expect(passphraseInput).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: /show passphrase/i }).click()
    await expect(passphraseInput).toHaveAttribute('type', 'text')
  })

  test('passphrase field can be hidden again after revealing', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByRole('button', { name: /show passphrase/i }).click()
    await page.getByRole('button', { name: /hide passphrase/i }).click()

    await expect(page.getByLabel(/^passphrase$/i)).toHaveAttribute('type', 'password')
  })
})

// ─── AC9: Loading state during decryption ────────────────────────────────────

test.describe('loading state while decrypting', () => {
  test('Decrypt and Cancel buttons are disabled while decrypting', async ({ page }) => {
    await page.addInitScript(
      ({ h, t }: { h: string; t: Record<string, MockEntry[]> }) => {
        ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
        ;(window as { __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[] }).__E2E_MOCK_READ_DIR__ =
          (path: string) => t[path] ?? []
        ;(window as { __E2E_MOCK_DECRYPT_FILE__?: () => Promise<void> }).__E2E_MOCK_DECRYPT_FILE__ =
          () =>
            new Promise(() => {
              /* never resolves */
            })
      },
      { h: HOME, t: { [HOME]: HOME_ENTRIES } }
    )

    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('correctpassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    await expect(page.getByRole('button', { name: /^decrypt$/i })).toBeDisabled()
    await expect(page.getByRole('button', { name: /^cancel$/i })).toBeDisabled()
  })

  test('progress bar and status text appear while decrypting', async ({ page }) => {
    await page.addInitScript(
      ({ h, t }: { h: string; t: Record<string, MockEntry[]> }) => {
        ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
        ;(window as { __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[] }).__E2E_MOCK_READ_DIR__ =
          (path: string) => t[path] ?? []
        ;(window as { __E2E_MOCK_DECRYPT_FILE__?: () => Promise<void> }).__E2E_MOCK_DECRYPT_FILE__ =
          () =>
            new Promise(() => {
              /* never resolves */
            })
      },
      { h: HOME, t: { [HOME]: HOME_ENTRIES } }
    )

    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('correctpassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    await expect(page.getByRole('progressbar', { name: /decrypting/i })).toBeVisible()
    await expect(page.getByText(/decrypting file, please wait/i)).toBeVisible()
  })

  test('Decrypt button label does not change while loading', async ({ page }) => {
    await page.addInitScript(
      ({ h, t }: { h: string; t: Record<string, MockEntry[]> }) => {
        ;(window as { __E2E_MOCK_HOME_DIR__?: string }).__E2E_MOCK_HOME_DIR__ = h
        ;(window as { __E2E_MOCK_READ_DIR__?: (p: string) => MockEntry[] }).__E2E_MOCK_READ_DIR__ =
          (path: string) => t[path] ?? []
        ;(window as { __E2E_MOCK_DECRYPT_FILE__?: () => Promise<void> }).__E2E_MOCK_DECRYPT_FILE__ =
          () =>
            new Promise(() => {
              /* never resolves */
            })
      },
      { h: HOME, t: { [HOME]: HOME_ENTRIES } }
    )

    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('correctpassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    // The button should still be labelled "Decrypt" (label doesn't change while loading)
    await expect(page.getByRole('button', { name: /^decrypt$/i })).toBeVisible()
  })

  test('Cancel button dismisses the dialog', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByRole('button', { name: /^cancel$/i }).click()

    await expect(page.getByRole('dialog', { name: /decrypt file/i })).not.toBeVisible()
  })
})

// ─── AC10 & AC11: Successful decryption ──────────────────────────────────────

test.describe('successful decryption', () => {
  test('dialog closes and success toast appears after decrypt', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      treeAfterDecrypt: { [HOME]: HOME_ENTRIES_AFTER_DECRYPT },
      decryptResult: 'success',
    })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('correctpassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    await expect(page.getByRole('dialog', { name: /decrypt file/i })).not.toBeVisible()
    await expect(page.getByText(/report\.md\.gpg decrypted → report\.md/i)).toBeVisible()
  })

  test('file list refreshes and new plaintext file appears', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      treeAfterDecrypt: { [HOME]: HOME_ENTRIES_AFTER_DECRYPT },
      decryptResult: 'success',
    })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('correctpassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    // Use exact text match so 'report.md' doesn't match the 'report.md.gpg' span
    const fileTable = page.getByRole('table', { name: /file list/i })
    await expect(fileTable.getByText('report.md', { exact: true })).toBeVisible()
  })

  // AC11: Newly created plaintext file is greyed out (it's a non-.gpg file in decrypt mode)
  test('new plaintext file appears greyed out in refreshed file list (decrypt mode)', async ({
    page,
  }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      treeAfterDecrypt: { [HOME]: HOME_ENTRIES_AFTER_DECRYPT },
      decryptResult: 'success',
    })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('correctpassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    // Find the report.md row specifically (not report.md.gpg) using exact text match on the name span
    const fileTable = page.getByRole('table', { name: /file list/i })
    const newPlainRow = fileTable
      .getByRole('row')
      .filter({ has: page.getByText('report.md', { exact: true }) })
      .first()
    await expect(newPlainRow).toHaveClass(/cursor-not-allowed/)
  })

  // AC13: Silent overwrite — no confirmation dialog when output file already exists
  test('no overwrite confirmation when output file already exists', async ({ page }) => {
    const treeWithExistingPlaintext: MockEntry[] = [
      ...HOME_ENTRIES,
      { name: 'report.md', isDirectory: false, isSymlink: false },
    ]
    await injectMocks(page, {
      tree: { [HOME]: treeWithExistingPlaintext },
      treeAfterDecrypt: { [HOME]: treeWithExistingPlaintext },
      decryptResult: 'success',
    })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('correctpassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    // No confirmation dialog — decrypt dialog closes directly
    await expect(page.getByRole('dialog', { name: /decrypt file/i })).not.toBeVisible()
    await expect(page.getByText(/already exists|overwrite|replace/i)).not.toBeVisible()
  })
})

// ─── AC12: Backend error handling ────────────────────────────────────────────

test.describe('backend error handling', () => {
  test('wrong passphrase error appears inside dialog without closing it', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      decryptResult: 'error',
      decryptErrorMessage: 'no matching secret key found',
    })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('wrongpassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    await expect(page.getByRole('dialog', { name: /decrypt file/i })).toBeVisible()
    await expect(page.getByRole('alert')).toContainText(/decryption failed/i)
    await expect(page.getByRole('alert')).toContainText(/no matching secret key found/i)
  })

  test('backend error message is shown verbatim in parentheses', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      decryptResult: 'error',
      decryptErrorMessage: 'Permission denied: cannot write to /home/testuser/report.md',
    })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('somepassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    await expect(page.getByRole('alert')).toContainText(/permission denied/i)
  })

  test('app does not crash on backend error', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      decryptResult: 'error',
      decryptErrorMessage: 'Unexpected failure',
    })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('somepassword')
    await page.getByRole('button', { name: /^decrypt$/i }).click()

    await expect(page.getByRole('dialog', { name: /decrypt file/i })).toBeVisible()
    await expect(page.getByRole('alert')).toBeVisible()
  })
})

// ─── AC14: Switching back to Encrypt tab restores encrypt-mode filtering ──────

test.describe('tab switching restores mode filtering', () => {
  test('switching back to Encrypt tab greys out .gpg files again', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    // Switch to decrypt mode (gpg files should be enabled)
    await switchToDecryptMode(page)
    const gpgRow = page.getByRole('row').filter({ hasText: 'report.md.gpg' }).first()
    await expect(gpgRow).not.toHaveClass(/cursor-not-allowed/)

    // Switch back to encrypt mode (gpg files should be greyed out again)
    const encryptTab = page.getByRole('tab', { name: /^encrypt$/i })
    await encryptTab.click()
    await expect(encryptTab).toHaveAttribute('aria-selected', 'true')

    await expect(gpgRow).toHaveClass(/cursor-not-allowed/)
  })

  test('switching to Encrypt tab makes non-gpg files selectable again', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')

    // In decrypt mode, notes.txt should be greyed out
    await switchToDecryptMode(page)
    const txtRow = page.getByRole('row').filter({ hasText: 'notes.txt' }).first()
    await expect(txtRow).toHaveClass(/cursor-not-allowed/)

    // Switch back to encrypt mode — notes.txt should be selectable
    const encryptTab = page.getByRole('tab', { name: /^encrypt$/i })
    await encryptTab.click()

    await expect(txtRow).not.toHaveClass(/cursor-not-allowed/)
  })
})

// ─── Enter key in Passphrase field ───────────────────────────────────────────

test.describe('Enter key shortcut in Passphrase field', () => {
  test('pressing Enter in Passphrase field triggers decryption', async ({ page }) => {
    await injectMocks(page, {
      tree: { [HOME]: HOME_ENTRIES },
      treeAfterDecrypt: { [HOME]: HOME_ENTRIES_AFTER_DECRYPT },
      decryptResult: 'success',
    })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    await page.getByLabel(/^passphrase$/i).fill('correctpassword')
    await page.getByLabel(/^passphrase$/i).press('Enter')

    // Dialog should close and success toast should appear, same as clicking Decrypt
    await expect(page.getByRole('dialog', { name: /decrypt file/i })).not.toBeVisible()
    await expect(page.getByText(/report\.md\.gpg decrypted → report\.md/i)).toBeVisible()
  })

  test('pressing Enter in Passphrase field still validates the form', async ({ page }) => {
    await injectMocks(page, { tree: { [HOME]: HOME_ENTRIES } })
    await page.goto('/')
    await switchToDecryptMode(page)
    await openDecryptDialog(page, 'report.md.gpg')

    // Leave passphrase empty and press Enter
    await page.getByLabel(/^passphrase$/i).press('Enter')

    await expect(page.getByRole('alert')).toContainText(/passphrase must not be empty/i)
    await expect(page.getByRole('dialog', { name: /decrypt file/i })).toBeVisible()
  })
})
