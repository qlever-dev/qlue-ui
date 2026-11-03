import type { Editor } from '../editor/init';
import { setClearCacheBeforeExecute } from '../settings/init';
import type { QlueLsServiceConfig } from '../types/backend';

let cacheCleared = false;

export async function setupClearCache(editor: Editor) {
  const clearCacheButton = document.getElementById('clearCacheButton')!;
  const clearCachePinButton = document.getElementById('clearCachePinButton')! as HTMLButtonElement;
  clearCacheButton.addEventListener('click', async () => {
    clearCache(editor);
  });
  clearCachePinButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    const pinned = clearCachePinButton.ariaPressed !== 'true';
    setClearCacheBeforeExecute(pinned);
  });
}

/**
 * Asks the configured SPARQL endpoint to clear its cache.
 *
 * Also used as the `clearCache` command handler, so options come in as
 * command parameters:
 * - `quiet`: don't show the "Cache cleared." / "Could not clear cache." toasts.
 *   The "No SPARQL endpoint configured." warning is still shown.
 *
 * @example clearCache(editor, ['quiet']); // or `clearCache quiet` in the command prompt
 */
export async function clearCache(editor: Editor, params: string[] = []) {
  const quiet = params.includes('quiet');
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
  } else {
    return fetch(backend.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({ cmd: 'clear-cache' }),
    })
      .then((response) => {
        if (response.ok) {
          cacheCleared = true;
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
        } else {
          throw new Error();
        }
      })
      .catch((_err) => {
        if (!quiet) {
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
      });
  }
}

/** True if the cache was cleared since the last query started. Resets the flag. */
export function takeCacheCleared(): boolean {
  const cleared = cacheCleared;
  cacheCleared = false;
  return cleared;
}
