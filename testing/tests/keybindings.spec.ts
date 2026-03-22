import { test, expect } from '@playwright/test';

test('help keybinding', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 15000 });
  await page.getByRole('textbox', { name: 'Editor content' }).press('?');
  await expect(page.locator('#helpModal')).toBeVisible({ visible: false });
});
