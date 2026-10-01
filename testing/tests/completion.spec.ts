import { expect, test } from '@playwright/test';
import { ctrlCmd, getEditorContent, placeCursor, setEditorContent } from './utils';

// Regression tests for the custom completion controller
// (frontend/src/editor/completion/). Each test pins one bug that shipped, so
// the name says what must not happen again rather than what is exercised.

const RDFS = 'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>';
const EX = 'PREFIX ex: <http://example.org/>';

test.beforeEach(async ({ page }) => {
  await page.goto('./test');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 15000 });
});

test.describe('completion', () => {
  test('a term that is not a valid regex still filters', async ({ page }) => {
    // "?abas" compiled to an invalid regex, was dropped, and an empty keyword
    // list matched everything -- so the list never narrowed.
    await setEditorContent(page, [RDFS, 'SELECT * WHERE {', '  ?a rdfs:label ', '}'].join('\n'));
    await placeCursor(page, 3, 17);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('?la', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });
    await expect(widget.getByTestId('completion-item').filter({ hasText: '?label' })).toHaveCount(
      1,
    );

    await editor.pressSequentially('bas', { delay: 60 });
    await expect(widget.getByTestId('completion-item')).toHaveCount(0);
  });

  test('the matched part of the term is highlighted when typing from cold', async ({ page }) => {
    // The widget anchor falls back to the cursor at request time, which sits
    // after what was already typed. Using it as the term start yielded an empty
    // term, so nothing highlighted -- but only when typing without a preceding
    // explicit trigger, which is what made it easy to miss.
    await setEditorContent(page, ['SELECT * WHERE {', '}', ''].join('\n'));
    await placeCursor(page, 3, 1);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('G', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });

    const item = widget.getByTestId('completion-item').filter({ hasText: 'GROUP BY' }).first();
    await expect(item.locator('.text-amber-600')).toHaveText('G');
  });

  test('accepting replaces the whole term, not just what the server saw', async ({ page }) => {
    // A complete list is filtered locally rather than re-requested, so the
    // server's replace range is several keystrokes old by the time an item is
    // accepted. Applying it verbatim left the typed "la" behind.
    await setEditorContent(page, [RDFS, 'SELECT * WHERE {', '  ?a rdfs:label ', '}'].join('\n'));
    await placeCursor(page, 3, 17);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('?la', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });
    await widget.getByTestId('completion-item').filter({ hasText: '?label' }).first().click();

    await expect.poll(() => getEditorContent(page), { timeout: 5000 }).toContain(
      '?a rdfs:label ?label',
    );
    // The leftover showed up as a bare "la" on a line of its own.
    expect(await getEditorContent(page)).not.toMatch(/^\s*la\s*$/m);
  });

  test('a variable suggestion drops out once the term cannot match it', async ({
    page,
    browserName,
  }) => {
    // Variable items are merged into the entity list, which is isIncomplete and
    // so was rendered unfiltered -- leaving "?acted_in" on screen next to
    // entities matching a completely different term.
    await setEditorContent(page, [EX, 'SELECT * WHERE {', '  ?a ex:actedIn ', '}'].join('\n'));
    await placeCursor(page, 3, 17);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await page.keyboard.press(`${ctrlCmd(browserName)}+Space`);
    await expect(widget).toBeVisible({ timeout: 15000 });
    await expect(
      widget.getByTestId('completion-item').filter({ hasText: '?acted_in' }),
    ).not.toHaveCount(0);

    // "The Iron Lady" is an object of ex:actedIn; "?acted_in" is not a prefix
    // of it, so the variable suggestion has to go while the entities stay.
    await editor.pressSequentially('The Iron', { delay: 60 });
    await expect(
      widget.getByTestId('completion-item').filter({ hasText: 'The Iron Lady' }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(widget.getByTestId('completion-item').filter({ hasText: '?acted_in' })).toHaveCount(
      0,
    );
  });

  test('a freshly typed variable dismisses instead of reporting no match', async ({ page }) => {
    // The server only suggests the other variables in the query and drops the
    // one being typed, so "?abc" in an otherwise variable free query returns a
    // truthful empty list -- which was rendered as "Nothing matches" for a name
    // the user had just finished writing.
    await setEditorContent(page, ['SELECT * WHERE {', '  ', '}'].join('\n'));
    await placeCursor(page, 2, 3);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('?abc', { delay: 60 });
    // NOTE: the widget starts hidden, so it has to be given the time to come
    // back with the empty response before "still hidden" means anything.
    await page.waitForTimeout(2000);
    await expect(widget).toBeHidden();
  });

  test('an inserted snippet is indented onto the line it lands on', async ({ page }) => {
    // The snippet carries its own relative indentation, which was inserted
    // verbatim -- so the sub select came out flat against the left margin.
    await setEditorContent(page, ['SELECT * WHERE {', '  ', '}'].join('\n'));
    await placeCursor(page, 2, 3);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('Sub', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });
    await widget.getByTestId('completion-item').filter({ hasText: 'Sub select' }).first().click();

    await expect
      .poll(() => getEditorContent(page), { timeout: 5000 })
      .toBe(
        [
          'SELECT * WHERE {',
          '  {',
          '    SELECT * WHERE {',
          '      ',
          '    }',
          '  }',
          '}',
        ].join('\n')
      );
  });

  test('the object suffix keeps the indentation the server gave it', async ({ page }) => {
    // The suffix carries the absolute indentation the server worked out from
    // the brace nesting depth, and says so with `insertTextMode: AsIs`. Adding
    // the current line's indentation on top of it put the next triple 2 columns
    // too far in.
    await setEditorContent(
      page,
      [EX, 'SELECT * WHERE {', '  ?a ex:actedIn ', '}'].join('\n')
    );
    await placeCursor(page, 3, 17);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('Th', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 15000 });
    await widget.getByTestId('completion-item').filter({ hasText: 'The Iron Lady' }).first().click();

    await expect
      .poll(() => getEditorContent(page), { timeout: 5000 })
      .toBe(
        [EX, 'SELECT * WHERE {', '  ?a ex:actedIn ex:the_iron_lady .', '  ', '}'].join('\n')
      );
  });

  test('a snippet accepted inside a snippet keeps the outer tabstops', async ({ page }) => {
    // Monaco's `apply` cancels a running snippet session before inserting, so
    // accepting YEAR in the first stop of "BIND ($1 AS ?$0)" threw away the
    // variable stop and Tab could no longer reach it.
    await setEditorContent(page, ['SELECT * WHERE {', '  ?a ?B ?c .', '  ', '}'].join('\n'));
    await placeCursor(page, 3, 3);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('B', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });
    await widget.getByTestId('completion-item').filter({ hasText: 'BIND' }).first().click();

    await editor.pressSequentially('Ye', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });
    await widget.getByTestId('completion-item').filter({ hasText: 'YEAR' }).first().click();

    // The outer stop is the one after "AS ?".
    await editor.press('Tab');
    await editor.pressSequentially('year');

    await expect
      .poll(() => getEditorContent(page), { timeout: 5000 })
      .toContain('BIND (YEAR(datetime) AS ?year)');
  });

  test('the header spins while a request is out', async ({ page }) => {
    await setEditorContent(page, [EX, 'SELECT * WHERE {', '  ', '}'].join('\n'));
    await placeCursor(page, 3, 3);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');
    const spinner = page.getByTestId('completion-spinner');

    await editor.pressSequentially('Mery', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 15000 });
    await expect(spinner).toBeHidden();

    // The keystroke queues a request synchronously, so the spinner is on for
    // the debounce and the round trip, then off once the answer lands.
    await editor.press('l');
    await expect(spinner).toBeVisible();
    await expect(spinner).toBeHidden({ timeout: 15000 });
  });

  test('the header names the term as it is typed', async ({ page }) => {
    // An entity list is isIncomplete, so a keystroke re-requests rather than
    // re-renders. The header used to name the term the last response was for,
    // catching up only once the round trip finished.
    await page.route(/7878\/query/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await setEditorContent(page, [EX, 'SELECT * WHERE {', '  ', '}'].join('\n'));
    await placeCursor(page, 3, 3);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('Mery', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 15000 });

    // The header follows the keystroke, while the request for it is still out.
    await editor.press('l');
    await expect(widget.getByTestId('completion-spinner')).toBeVisible();
    // NOTE: well inside the 1500ms route delay, so only the keystroke can have
    // put this on screen. A generous timeout here would simply outlast the
    // request and watch the stale header catch up on the answer instead.
    await expect(widget).toContainText('matching Meryl', { timeout: 800 });
  });

  test('a list answering an older term is marked stale', async ({ page }) => {
    // An entity list is isIncomplete, so the rows on screen keep answering the
    // term the last response was for. They used to look exactly as current as
    // a fresh list while the answer for what had been typed since was still
    // out.
    await page.route(/7878\/query/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await setEditorContent(page, [EX, 'SELECT * WHERE {', '  ', '}'].join('\n'));
    await placeCursor(page, 3, 3);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');
    const stale = widget.getByTestId('completion-stale');

    await editor.pressSequentially('Mery', { delay: 60 });
    await expect(widget.getByTestId('completion-item').first()).toBeVisible({ timeout: 15000 });
    await expect(stale).toBeHidden();

    // NOTE: well inside the 1500ms route delay, so the mark can only come from
    // the keystroke. It names the term the rows still answer, not the live one.
    await editor.press('l');
    await expect(stale).toBeVisible({ timeout: 800 });
    await expect(stale).toHaveText('showing results for Mery');
    // The rows stay put and stay selectable while their replacement is out.
    await expect(widget.getByTestId('completion-item').filter({ hasText: 'Meryl Streep' })).toHaveCount(1);

    // And the answer for the live term clears the mark.
    await expect(stale).toBeHidden({ timeout: 15000 });
  });

  test('a slow first request opens on a searching panel', async ({ page }) => {
    // An entity completion goes to the endpoint. Nothing was shown until the
    // answer came back, so a slow endpoint meant typing into silence.
    await page.route(/7878\/query/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await setEditorContent(page, [EX, 'SELECT * WHERE {', '  ', '}'].join('\n'));
    await placeCursor(page, 3, 3);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    // NOTE: "The" matches no keyword, so nothing reaches the screen ahead of
    // the endpoint -- the panel is deliberately suppressed once something has.
    await editor.pressSequentially('The', { delay: 60 });
    await expect(widget).toContainText('Searching…', { timeout: 5000 });
    await expect(widget.getByTestId('completion-spinner')).toBeVisible();

    // And the answer replaces it.
    await expect(
      widget.getByTestId('completion-item').filter({ hasText: 'The Iron Lady' }),
    ).toHaveCount(1, { timeout: 15000 });
    await expect(widget).not.toContainText('Searching…');
  });

  test('backspacing out of an inserted snippet dismisses the list', async ({ page }) => {
    // FILTER inserts "FILTER ($0)" and chains a request for the built in calls.
    // That list is complete and carries no ranges, so it was filtered locally
    // against a word scan forever. Deleting the "FILTER (" it belongs inside
    // left it on screen -- and an empty term is a prefix of everything, so the
    // full list came back and could still be accepted.
    await setEditorContent(page, ['SELECT * WHERE {', '  ', '}'].join('\n'));
    await placeCursor(page, 2, 3);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('F', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });
    await widget.getByTestId('completion-item').filter({ hasText: 'FILTER' }).first().click();

    // The chained request for the built in calls.
    await expect(
      widget.getByTestId('completion-item').filter({ hasText: 'ABS' }).first(),
    ).toBeVisible({ timeout: 10000 });

    await editor.press('Backspace');
    await expect(widget).toBeHidden();

    // And the dismissed list must not be acceptable on the way out.
    await editor.press('Enter');
    expect(await getEditorContent(page)).not.toContain('ABS');
  });

  test('ctrl+enter ends the session and executes', async ({ page, browserName }) => {
    // Ctrl+Enter was handled below the "is the widget visible" guard, so a
    // request queued by the keystroke just before it was never cancelled: the
    // query ran and the popup then opened on top of it. Pressing Ctrl+Enter
    // straight after a keystroke is what reproduces it -- once the widget is up
    // and settled there is nothing in flight left to land.
    await setEditorContent(page, [EX, 'SELECT * WHERE {', '  ?s ?p ?o', '}'].join('\n'));
    await placeCursor(page, 3, 11);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await page.evaluate(() => {
      (window as any).__executed = 0;
      window.addEventListener('execute-started', () => {
        (window as any).__executed++;
      });
    });

    await editor.press('a');
    await page.keyboard.press(`${ctrlCmd(browserName)}+Enter`);

    await expect.poll(() => page.evaluate(() => (window as any).__executed)).toBe(1);
    // The queued request has to be gone, not merely late.
    await expect(widget).toBeHidden();
    await page.waitForTimeout(1500);
    await expect(widget).toBeHidden();
  });

  // The first word of a multi word keyword lexes as that keyword's own token,
  // so a space after it used to localize as Unknown and drop every completion.
  // Needs the get_location fix from qlue-ls 3.4.4.
  test('a partially typed multi word keyword keeps its completions', async ({ page }) => {
    await setEditorContent(page, ['SELECT * WHERE {', '  ?a ?b ?c .', '}', ''].join('\n'));
    await placeCursor(page, 4, 1);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('GROUP B', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });
    await expect(
      widget.getByTestId('completion-item').filter({ hasText: 'GROUP BY' }),
    ).toHaveCount(1);

    await widget.getByTestId('completion-item').filter({ hasText: 'GROUP BY' }).first().click();
    // The whole "GROUP B" is the term, so accepting must not double it.
    await expect.poll(() => getEditorContent(page), { timeout: 5000 }).toContain('GROUP BY');
    expect(await getEditorContent(page)).not.toContain('GROUP BGROUP BY');
  });

  // A code action's edit reaches the content-change handler exactly like a
  // keystroke, and the trigger heuristic only looked at the last character of
  // the inserted text: "Add to result" writing "?o" over the "*" ended in a
  // word character, so the popup opened on whatever the cursor sat on.
  test('a code action editing elsewhere does not open the popup', async ({
    page,
    browserName,
  }) => {
    await setEditorContent(page, ['SELECT * WHERE {', '  ?s ?p ?o', '}'].join('\n'));
    // Right after the "?" of "?o" -- where the bug found a term to complete.
    await placeCursor(page, 2, 10);

    const widget = page.getByTestId('completion-widget');

    await page.keyboard.press(`${ctrlCmd(browserName)}+Period`);
    const action = page.locator('.action-widget .monaco-list-row.action');
    await expect(action.filter({ hasText: 'Add to result' })).toHaveCount(1, { timeout: 10000 });
    // NOTE: the rows sit under a pointer-blocking overlay, so they are reached
    // by keyboard. "Add to result" is the first one and starts out focused.
    await page.keyboard.press('Enter');

    await expect.poll(() => getEditorContent(page), { timeout: 5000 }).toContain('SELECT ?o');
    await page.waitForTimeout(1500);
    await expect(widget).toBeHidden();
  });

  // The server completes inside comments too, so typing prose that happens to
  // end in a keyword -- "# blabla select" -- opened the keyword list.
  test('typing inside a comment does not open the popup', async ({ page }) => {
    await setEditorContent(page, ['# blabla ', 'SELECT * WHERE {', '  ?s ?p ?o', '}'].join('\n'));
    await placeCursor(page, 1, 10);

    const editor = page.getByRole('textbox', { name: 'Editor content' });
    const widget = page.getByTestId('completion-widget');

    await editor.pressSequentially('select', { delay: 60 });
    await page.waitForTimeout(1500);
    await expect(widget).toBeHidden();

    // An open list is dismissed once the "#" turns the line into a comment.
    await placeCursor(page, 3, 10);
    await editor.pressSequentially('?', { delay: 60 });
    await expect(widget).toBeVisible({ timeout: 10000 });
    await placeCursor(page, 3, 1);
    await editor.pressSequentially('# ', { delay: 60 });
    await expect(widget).toBeHidden();
  });
});
