import { test, expect } from '@playwright/test'

test('homepage loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('button', { name: /go to home directory/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /open folder/i })).toBeVisible()
})

test('dashboard shows two-panel layout', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('tree', { name: /folder tree/i })).toBeVisible()
})

test('shows empty state when no folder selected', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText(/select a folder from the sidebar/i)).toBeVisible()
})
