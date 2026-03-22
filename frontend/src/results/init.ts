// NOTE: This is the "result" module.
// It's task is executing a SPARQL operation and display the results.
// Query execution can be triggered from 4 locations:
// - from the execute button
// - from the editor via the CTRL + Enter keybinding
// - from the url-searchparam: "?exec=true"
// - from the analysis modal: "clear cache & rerun query"
// There MUST always be at most one query in exection!
// To handle this there are 4 signals, send over the "window":
// - "cancel-or-execute"      : request to cancel or execute the current query
// - "execute-cancle-request" : request cancelation of the currently executed op
// - "execute-start-request"  : requests the execution
// - "execute-started"        : execution has started
// - "execute-ended"          : execution has ended
// Who ever wants to execute a new query has to request the cancelation of the
// current query and wait for it to end. Only then will a new query be executed.

import type { Editor } from '../editor/init';
import { settings } from '../settings/init';
import type { QlueLsServiceConfig } from '../types/backend';
import type { ExecuteOperationResult, Head, PartialResult } from '../types/lsp_messages';
import type { QueryExecutionTree } from '../types/query_execution_tree';
import type { ExecuteUpdateResultEntry } from '../types/update';
import { renderTableHeader, renderTableRows } from './table';
import {
  clearQueryStats,
  type QueryStatus,
  scrollToResults,
  showLoadingScreen,
  showQueryMetaData,
  showResults,
  startQueryTimer,
  stopQueryTimer,
  showMapViewButton,
  escapeHtml,
  showFullResultButton,
  hideFullResultButton,
} from './utils';

export interface ExecuteQueryEventDetails {
  queryId: string;
}

export interface ExecuteQueryEndEventDetails {
  queryExecutionTree: QueryExecutionTree;
}

export interface QueryResultSizeDetails {
  size: number;
}

export interface CancelOrExecuteDetails {
  limited: boolean;
}

let queryStatus: QueryStatus = 'idle';

export async function setupResults(editor: Editor) {
  window.addEventListener('cancel-or-execute', (event) => {
    const limited = (event as CustomEvent<CancelOrExecuteDetails>).detail?.limited ?? true;
    if (queryStatus == 'running') {
      window.dispatchEvent(new Event('execute-cancle-request'));
    } else if (queryStatus == 'idle') {
      window.dispatchEvent(new CustomEvent('execute-start-request', { detail: { limited } }));
    }
  });
  handleSignals(editor);
}

function handleSignals(editor: Editor) {
  window.addEventListener('execute-start-request', (event) => {
    const limited = (event as CustomEvent<{ limited: boolean }>).detail?.limited ?? true;
    if (queryStatus == 'idle') {
      queryStatus = 'running';
      window.dispatchEvent(new CustomEvent('execute-started'));
      executeQueryAndShowResults(editor, limited);
    } else {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: 'warning',
            message: 'There already a query in execution',
            duration: 2000,
          },
        })
      );
    }
  });
  window.addEventListener('execute-cancle-request', () => {
    queryStatus = 'canceling';
  });
  window.addEventListener('execute-ended', () => {
    queryStatus = 'idle';
  });
}

async function executeQueryAndShowResults(editor: Editor, limited = true) {
  // TODO: infinite scrolling
  // document.dispatchEvent(new Event('infinite-reset'));

  // NOTE: Check if SPARQL endpoint is configured.
  const backend = (await editor.languageClient.sendRequest('qlueLs/getBackend', {})) as
    | QlueLsServiceConfig
    | { error: string };
  if ('error' in backend) {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: 'No SPARQL endpoint configured.',
          duration: 2000,
        },
      })
    );
    window.dispatchEvent(new CustomEvent('execute-ended', { detail: { result: 'error' } }));
    return;
  }

  showLoadingScreen();
  clearQueryStats();
  hideFullResultButton();
  const timer = startQueryTimer();
  // NOTE: here the limit is increased by one to check if the result is larger then the limit.
  const limit = limited ? settings.results.limit + 1 : null;
  executeQuery(editor, limit, 0)
    .then((timeMs) => {
      showResults();
      stopQueryTimer(timer);
      document.getElementById('queryTimeTotal')!.innerText = timeMs.toLocaleString('en-US') + 'ms';
      window.dispatchEvent(new CustomEvent('execute-ended', { detail: { result: 'success' } }));
    })
    .catch(() => {
      stopQueryTimer(timer);
      const result = queryStatus === 'canceling' ? 'canceled' : 'error';
      window.dispatchEvent(new CustomEvent('execute-ended', { detail: { result } }));
    });
  renderLazyResults(editor, limited);
}

// Executes the query in a layz manner.
// Returns the time the query took end-to-end.
async function executeQuery(
  editor: Editor,
  limit: number | null,
  offset: number = 0
): Promise<number> {
  const queryId =
    crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.dispatchEvent(
    new CustomEvent('execute-query', {
      detail: {
        queryId,
      },
    })
  );

  window.addEventListener('execute-cancle-request', () => {
    editor.languageClient
      .sendRequest('qlueLs/cancelQuery', {
        queryId,
      })
      .catch((err) => {
        console.error('The query cancelation failed:', err);
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'error', message: 'Query could not be canceled', duration: 2000 },
          })
        );
      });
  });

  let response = (await editor.languageClient
    .sendRequest('qlueLs/executeOperation', {
      textDocument: {
        uri: editor.getDocumentUri(),
      },
      queryId: queryId,
      accessToken: settings.general.accessToken,
      maxResultSize: limit,
      resultOffset: offset,
      lazy: true,
    })
    .catch((err) => {
      const resultsErrorMessage = document.getElementById('resultErrorMessage')! as HTMLSpanElement;
      const resultsErrorQuery = document.getElementById('resultsErrorQuery')! as HTMLPreElement;
      if (err.data) {
        switch (err.data.type) {
          case 'QLeverException':
            resultsErrorMessage.textContent = err.data.exception;
            if (err.data.metadata) {
              resultsErrorQuery.innerHTML =
                escapeHtml(err.data.query.substring(0, err.data.metadata.startIndex)) +
                `<span class="text-red-500 dark:text-red-600 font-bold">${escapeHtml(err.data.query.substring(err.data.metadata.startIndex, err.data.metadata.stopIndex + 1))}</span>` +
                escapeHtml(err.data.query.substring(err.data.metadata.stopIndex + 1));
            } else {
              resultsErrorQuery.innerHTML = err.data.query;
            }
            break;
          case 'Connection':
            resultsErrorMessage.innerHTML = `The connection to the SPARQL endpoint is broken (${err.data.statusText}).<br> The most common cause is that the QLever server is down. Please try again later and contact us if the error perists`;
            resultsErrorQuery.innerText = err.data.query;
            break;
          case 'Canceled':
            resultsErrorMessage.innerHTML = `Operation was manually cancelled.`;
            resultsErrorQuery.innerText = err.data.query;
            break;
          case 'InvalidFormat':
            resultsErrorMessage.innerHTML = `Update result could not be deserialized: ${err.data.message}`;
            resultsErrorQuery.innerText = err.data.query;
            break;
          case 'Deserialization':
            resultsErrorMessage.innerHTML = `Query result could not be deserialized: ${err.data.message}`;
            resultsErrorQuery.innerText = err.data.query;
            break;
          default:
            console.log('uncaught error:', err);
            resultsErrorMessage.innerHTML = `Something went wrong but we don't know what...`;
            break;
        }
      }
      const resultsContainer = document.getElementById('results') as HTMLSelectElement;
      resultsContainer.classList.add('hidden');
      const resultsError = document.getElementById('resultsError') as HTMLSelectElement;
      resultsError.classList.remove('hidden');
      window.scrollTo({
        top: resultsError.offsetTop + 10,
        behavior: 'smooth',
      });
      throw new Error('Query processing error');
    })) as ExecuteOperationResult;
  if ('queryResult' in response) {
    return response.queryResult.timeMs;
  } else {
    renderUpdateResult(response.updateResult);
    return response.updateResult.reduce((acc, op) => acc + op.time.total, 0);
  }
}

function renderUpdateResult(result: ExecuteUpdateResultEntry[]) {
  let head = { vars: ['insertions', 'deletions'] };
  renderTableHeader(head);
  renderTableRows(
    head,
    result.map((operation) => {
      return {
        insertions: {
          type: 'literal',
          value: operation.deltaTriples.operation.inserted.toLocaleString('en-US'),
        },
        deletions: {
          type: 'literal',
          value: operation.deltaTriples.operation.deleted.toLocaleString('en-US'),
        },
      };
    }),
    0
  );
}

function renderLazyResults(editor: Editor, limited: boolean) {
  let head: Head | undefined;
  let first_bindings = true;
  let results_count = 0;
  // NOTE: For a lazy sparql query, the languag server will send "qlueLs/partialResult"
  // notifications. These contain a partial result.
  editor.languageClient.onNotification('qlueLs/partialResult', (partialResult: PartialResult) => {
    if ('header' in partialResult) {
      head = partialResult.header.head;
      renderTableHeader(head);
      showResults();
    } else if ('meta' in partialResult) {
      showQueryMetaData(partialResult.meta);
    } else {
      renderTableRows(head!, partialResult.bindings, results_count);
      results_count += partialResult.bindings.length;
      if (limited && results_count > settings.results.limit) {
        showFullResultButton();
      }
      if (first_bindings) {
        showMapViewButton(editor, head!, partialResult.bindings);
        scrollToResults();
        first_bindings = false;
      }
    }
  });
  // NOTE: QLever sends runtime-information over a websocket.
  // It contains information about the result size.
  const sizeEl = document.getElementById('resultSize')!;
  sizeEl.classList.remove('normal-nums');
  sizeEl.classList.add('tabular-nums');
  window.addEventListener('query-result-size', (event) => {
    const { size } = (event as CustomEvent<QueryResultSizeDetails>).detail;
    document.getElementById('resultSize')!.innerText = size.toLocaleString('en-US');
  });
}
