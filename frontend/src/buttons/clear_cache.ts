import type { Editor } from '../editor/init';
import type { QlueLsServiceConfig } from '../types/backend';

export async function setupClearCache(editor: Editor) {
  const clearCacheButton = document.getElementById('clearCacheButton')!;

  clearCacheButton.addEventListener('click', async () => {
    clearCache(editor);
  });
}

export async function clearCache(editor: Editor) {
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
    fetch(backend.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: new URLSearchParams({ cmd: 'clear-cache' }),
    }).then(response => {
      if (response.ok) {
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: {
              type: 'success',
              message: 'Cache cleared.',
              duration: 2000,
            },
          })
        );
      } else {
        throw new Error()
      }
    }).catch(_err => {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: 'error',
            message: 'Could not clear cache.',
            duration: 2000,
          },
        })
      );
    });
  }
}
