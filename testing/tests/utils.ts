import { type Page } from '@playwright/test';

/**
 * Get the editor content as a string via Monaco's API.
 * Uses the editor model directly so folded regions are included.
 */
export async function getEditorContent(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__editor.getContent());
}
