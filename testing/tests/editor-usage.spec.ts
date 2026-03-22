import { test, expect } from '@playwright/test';
import { getEditorContent } from './utils';

test('standard query building with completions', async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto('./wikidata');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 15000 });

  const editor = page.getByRole('textbox', { name: 'Editor content' });
  const suggestWidget = page.locator('.suggest-widget');

  // Step 1: Type to trigger snippet completions and select "SELECT * WHERE {}"
  await editor.pressSequentially('sel');
  await expect(suggestWidget).toBeVisible({ timeout: 10000 });
  await suggestWidget.locator('.monaco-list-row', { hasText: /SELECT/ }).first().click();

  // Snippet has two tab stops: SelectClause and body. Press Tab to skip to the body.
  await editor.press('Tab');

  // Step 2: Type "Meryl" inside the WHERE clause
  await editor.pressSequentially('Meryl');

  // Step 3-4: Wait for subject completions and select "Meryl Streep"
  await expect(suggestWidget).toBeVisible({ timeout: 30000 });
  await suggestWidget.locator('.monaco-list-row', { hasText: /wd:Q873/ }).first().click();

  // Step 5-6: Wait for predicate completions and select "p:P166"
  await expect(suggestWidget).toBeVisible({ timeout: 30000 });
  await suggestWidget.locator('.monaco-list-row', { hasText: /P166/ }).first().click();

  // Step 7-8: Wait for object completions and select "?award_received"
  await expect(suggestWidget).toBeVisible({ timeout: 30000 });
  await suggestWidget.locator('.monaco-list-row', { hasText: /\?award_received/ }).click();

  // Verify editor content after first triple
  const content1 = await getEditorContent(page);
  expect(content1).toBe(
    [
      'PREFIX p: <http://www.wikidata.org/prop/>',
      'PREFIX wd: <http://www.wikidata.org/entity/>',
      'SELECT * WHERE {',
      '  wd:Q873 p:P166 ?award_received .',
      '  ',
      '}',
    ].join('\n'),
  );

  // Wait for subject completions and select "?award_received"
  await expect(suggestWidget).toBeVisible({ timeout: 30000 });
  await suggestWidget.locator('.monaco-list-row', { hasText: /\?award_received/ }).click();

  // Wait for predicate completions and select "pq:P1686"
  await expect(suggestWidget).toBeVisible({ timeout: 30000 });
  await suggestWidget.locator('.monaco-list-row', { hasText: /P1686/ }).first().click();

  // Type the object, dismiss any completions triggered by ".", then newline
  await editor.pressSequentially('?work .');
  await editor.press('Escape');
  await editor.press('Enter');

  // Verify editor content after second triple (poll to wait for onTypeFormatting)
  await expect
    .poll(() => getEditorContent(page), { timeout: 5000 })
    .toBe(
      [
        'PREFIX pq: <http://www.wikidata.org/prop/qualifier/>',
        'PREFIX p: <http://www.wikidata.org/prop/>',
        'PREFIX wd: <http://www.wikidata.org/entity/>',
        'SELECT * WHERE {',
        '  wd:Q873 p:P166 ?award_received .',
        '  ?award_received pq:P1686 ?work .',
        '  ',
        '}',
      ].join('\n'),
    );

  // Type "?" to trigger variable completions and select "?award_received"
  await editor.pressSequentially('?');
  await expect(suggestWidget).toBeVisible({ timeout: 30000 });
  await suggestWidget.locator('.monaco-list-row', { hasText: /\?award_received/ }).click();

  // Wait for predicate completions and select "ps:P166"
  await expect(suggestWidget).toBeVisible({ timeout: 30000 });
  await suggestWidget.locator('.monaco-list-row', { hasText: /ps:P166/ }).first().click();

  // Type the object
  await editor.pressSequentially('?award');

  // Verify final editor content with semicolon notation
  const content3 = await getEditorContent(page);
  expect(content3).toBe(
    [
      'PREFIX ps: <http://www.wikidata.org/prop/statement/>',
      'PREFIX pq: <http://www.wikidata.org/prop/qualifier/>',
      'PREFIX p: <http://www.wikidata.org/prop/>',
      'PREFIX wd: <http://www.wikidata.org/entity/>',
      'SELECT * WHERE {',
      '  wd:Q873 p:P166 ?award_received .',
      '  ?award_received pq:P1686 ?work ;',
      '                  ps:P166 ?award',
      '}',
    ].join('\n'),
  );
});
