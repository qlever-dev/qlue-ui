import { type Page } from '@playwright/test';

/**
 * Get the editor content as a string via Monaco's API.
 * Uses the editor model directly so folded regions are included.
 */
export async function getEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__editor.getContent());
}

/**
 * Replace the editor content.
 *
 * Lets a test start from an exact query instead of building one up through
 * completions, which keeps a regression test focused on the one interaction
 * it is about.
 */
export async function setEditorContent(page: Page, content: string): Promise<void> {
  await page.evaluate((text) => (window as any).__editor.setContent(text), content);
}

/** Focus the editor and put the cursor at a 1-based line/column. */
export async function placeCursor(page: Page, lineNumber: number, column: number): Promise<void> {
  await page.evaluate(
    ([line, col]) => {
      const editor = (window as any).__editor.editorApp.getEditor();
      editor.focus();
      editor.setPosition({ lineNumber: line, column: col });
    },
    [lineNumber, column],
  );
}

/**
 * The key that stands in for Monaco's `CtrlCmd` modifier.
 *
 * Monaco reads the platform off the user agent, and Playwright's WebKit build
 * claims to be a Macintosh even on Linux -- so inside WebKit the editor's
 * Ctrl + <key> bindings answer to Meta, exactly as they would on a real Mac.
 */
export function ctrlCmd(browserName: string): 'Control' | 'Meta' {
  return browserName === 'webkit' ? 'Meta' : 'Control';
}
