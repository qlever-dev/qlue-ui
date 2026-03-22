import { test, expect } from '@playwright/test';

test('clear cache button', async ({ page }) => {
  await page.goto('./wikidata');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 15000 });
  await page.click("#clearCacheButton");
  const request = await page.waitForResponse(
    req => {
      return req.request().method() === 'POST'
    });
  expect(request).toBeTruthy();
});


test('format button', async ({ page }) => {
  await page.goto('./wikidata');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 15000 });
  await page.getByRole('textbox', { name: 'Editor content' }).type('SELECT   * WHERE { ?s     ?p ?o}');
  await page.click('#formatButton');
  await expect(page.locator('.view-lines > div:nth-child(1)')).toHaveText('SELECT * WHERE {');
  await expect(page.locator('.view-lines > div:nth-child(2)')).toHaveText('?s ?p ?o');
  await expect(page.locator('.view-lines > div:nth-child(3)')).toHaveText('}');
});
