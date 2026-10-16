import { test, expect } from '@playwright/test';
import { ctrlCmd, getEditorContent } from './utils';

// Builds a two-triple query purely through completions served by the local
// Oxigraph endpoint (see testing/fixtures/). Exercises subject, predicate and
// object completions, including context-sensitive predicate completion on a
// variable subject.
test('query building with completions against the local endpoint', async ({
  page,
  browserName,
}) => {
  test.setTimeout(60_000);

  await page.goto('./test');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 15000 });

  const editor = page.getByRole('textbox', { name: 'Editor content' });
  const suggestWidget = page.getByTestId('completion-widget');

  // Insert the "SELECT * WHERE {}" snippet, then Tab past the SelectClause stop
  // into the body.
  await editor.pressSequentially('sel', { delay: 100 });
  await expect(suggestWidget).toBeVisible({ timeout: 10000 });
  await suggestWidget.getByTestId('completion-item').filter({ hasText: /SELECT/ }).first().click();
  await editor.press('Tab');

  // Subject completion: "Meryl" -> "Meryl Streep" (ex:meryl_streep).
  await editor.pressSequentially('Meryl');
  await expect(suggestWidget).toBeVisible({ timeout: 15000 });
  await suggestWidget.getByTestId('completion-item').filter({ hasText: /Meryl Streep/ }).first().click();

  // Predicate completion -> ex:actedIn.
  await expect(suggestWidget).toBeVisible({ timeout: 15000 });
  await suggestWidget.getByTestId('completion-item').filter({ hasText: /actedIn/ }).first().click();

  // Object is a fresh variable; dismiss any object completions and end the triple.
  await editor.pressSequentially('?movie .');
  await editor.press('Escape');
  await editor.press('Enter');

  await expect
    .poll(() => getEditorContent(page), { timeout: 5000 })
    .toContain('ex:meryl_streep ex:actedIn ?movie');

  // Second triple, variable subject ?movie. Context-sensitive predicate
  // completion should suggest predicates of Meryl's movies -> ex:hasGenre.
  await editor.pressSequentially('?movie ');
  await page.keyboard.press(`${ctrlCmd(browserName)}+Space`);
  await expect(suggestWidget).toBeVisible({ timeout: 15000 });
  await suggestWidget.getByTestId('completion-item').filter({ hasText: /hasGenre/ }).first().click();

  // Object is a fresh variable.
  await editor.pressSequentially('?genre');

  // Poll to let onTypeFormatting settle the final line's indentation.
  await expect
    .poll(() => getEditorContent(page), { timeout: 5000 })
    .toBe(
      [
        'PREFIX ex: <http://example.org/>',
        'SELECT * WHERE {',
        '  ex:meryl_streep ex:actedIn ?movie .',
        '  ?movie ex:hasGenre ?genre',
        '}',
      ].join('\n'),
    );
});
