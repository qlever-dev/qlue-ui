import type { Editor } from '../editor/init';
import { settings } from '../settings/init';
import type { ExecuteOperationResult } from '../types/lsp_messages';
import type { ExecuteQueryEventDetails } from './init';
import { renderTableRows } from './table';
import { hideReloadingAnimation, showReloadingAnimation } from './utils';

let windowSize = 0;
let offset = windowSize;
let mutex = false;
let pendingResults = false;
let originalQuery: string | null = null;
let originalQueryId: string | null = null;

export function setupInfiniteScroll(editor: Editor) {
  window.addEventListener('scroll', () => onScroll(editor));

  window.addEventListener('execute-cancle-request', () => {
    if (mutex && originalQueryId != null) {
      const queryId = getSubQueryId(originalQueryId);
      editor.languageClient.sendRequest('qlueLs/cancelQuery', { queryId }).catch((err) => {
        console.error('The query cancelation failed:', err);
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'error', message: 'Query could not be canceled', duration: 2000 },
          })
        );
      });
    }
    originalQueryId = null;
    originalQuery = null;
    pendingResults = false;
  });

  window.addEventListener('execute-query', (e: Event) => {
    const { queryId, query, pageSize } = (e as CustomEvent<ExecuteQueryEventDetails>).detail;
    originalQuery = query;
    originalQueryId = queryId;
    pendingResults = false;
    windowSize = pageSize;
  });

  window.addEventListener('infinite-scroll-start', () => {
    offset = windowSize;
    pendingResults = true;
    hideReloadingAnimation();
  });
}

async function onScroll(editor: Editor) {
  if (mutex || !pendingResults || originalQuery == null || originalQueryId == null) return;

  const scrollPosition = window.innerHeight + window.scrollY;
  const pageHeight = document.body.offsetHeight;
  if (scrollPosition >= pageHeight - 1000) {
    showReloadingAnimation();
    mutex = true;
    const currentQueryId = originalQueryId;
    const queryId = getSubQueryId(originalQueryId);
    await editor.languageClient
      .sendRequest('qlueLs/executeOperation', {
        query: originalQuery,
        queryId,
        accessToken: settings.general.accessToken,
        maxResultSize: windowSize,
        resultOffset: offset,
        lazy: false,
      })
      .then((result) => {
        if (originalQueryId !== currentQueryId) {
          mutex = false;
          hideReloadingAnimation();
          return;
        }
        const exec_result = result as ExecuteOperationResult;
        if ('queryResult' in exec_result && 'results' in exec_result.queryResult.result) {
          if (exec_result.queryResult.result.results.bindings.length === 0) {
            pendingResults = false;
            mutex = false;
            hideReloadingAnimation();
            return;
          }
          renderTableRows(
            exec_result.queryResult.result.head,
            exec_result.queryResult.result.results.bindings,
            offset
          );
          hideReloadingAnimation();
        } else {
          pendingResults = false;
          mutex = false;
          hideReloadingAnimation();
          return;
        }

        offset += windowSize;
        mutex = false;
      })
      .catch((err) => {
        console.error('An error ocurred while loading more results', err);
        pendingResults = false;
        mutex = false;
        hideReloadingAnimation();
      });
  }
}

function getSubQueryId(queryId: string) {
  return `${queryId}-page(${offset / windowSize})`;
}
