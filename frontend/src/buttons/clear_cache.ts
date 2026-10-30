import type { Editor } from '../editor/init';
import type { QlueLsServiceConfig } from '../types/backend';

// NOTE: The lock next to the `Clear Cache` button latches it: while locked,
// the cache is cleared before every query. The state is kept per browser.
const STORAGE_KEY = 'clearCacheBeforeQuery';

let clearCacheBeforeQuery = false;

export function isClearCacheBeforeQuery(): boolean {
  return clearCacheBeforeQuery;
}

export async function setupClearCache(editor: Editor) {
  const clearCacheButton = document.getElementById('clearCacheButton')!;

  clearCacheButton.addEventListener('click', async () => {
    clearCache(editor);
  });

  setupClearCacheLock();
}

function setupClearCacheLock() {
  const lockButton = document.getElementById('clearCacheLockButton')!;
  clearCacheBeforeQuery = localStorage.getItem(STORAGE_KEY) === 'true';
  updateLockButton(lockButton);

  lockButton.addEventListener('click', () => {
    clearCacheBeforeQuery = !clearCacheBeforeQuery;
    localStorage.setItem(STORAGE_KEY, String(clearCacheBeforeQuery));
    updateLockButton(lockButton);
  });
}

function updateLockButton(lockButton: HTMLElement) {
  lockButton.setAttribute('aria-pressed', String(clearCacheBeforeQuery));
  lockButton.title = clearCacheBeforeQuery
    ? 'The cache is cleared before every query (click to unlock)'
    : 'Clear the cache before every query';
  document.getElementById('clearCacheLockOpen')!.classList.toggle('hidden', clearCacheBeforeQuery);
  document
    .getElementById('clearCacheLockClosed')!
    .classList.toggle('hidden', !clearCacheBeforeQuery);
}

export function toggleClearCacheBeforeQuery() {
  document.getElementById('clearCacheLockButton')!.click();
}

/**
 * Clears the cache of the current backend. Resolves once the backend has
 * answered, so callers can `await` it before running a query. With `quiet`,
 * only failures produce a toast.
 */
export async function clearCache(editor: Editor, quiet = false) {
  const backend = (await editor.languageClient.sendRequest('qlueLs/getBackend', {})) as
    | QlueLsServiceConfig
    | { error: string };
  if ('error' in backend) {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'warning',
          message: 'No SPARQL endpoint configured.',
          duration: 2000,
        },
      })
    );
    return;
  }
  try {
    const response = await fetch(backend.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({ cmd: 'clear-cache' }),
    });
    if (!response.ok) {
      throw new Error();
    }
    if (!quiet) {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: 'success',
            message: 'Cache cleared.',
            duration: 2000,
          },
        })
      );
    }
  } catch (_err) {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: 'Could not clear cache.',
          duration: 2000,
        },
      })
    );
  }
}
