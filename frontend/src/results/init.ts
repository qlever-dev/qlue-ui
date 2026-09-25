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

import { extractConfig, type RenderConfig } from 'sparql-results';
import type { Editor } from '../editor/init';
import { watchQueryExecution } from '../query_execution_tree/init';
import { settings } from '../settings/init';
import type { QlueLsServiceConfig } from '../types/backend';
import {
  type ExecuteOperationResult,
  getOperationTimeMs,
  type Head,
  type PartialResult,
} from '../types/lsp_messages';
import type { QueryExecutionTree } from '../types/query_execution_tree';
import type { ExecuteUpdateResult } from '../types/update';
import { setupInfiniteScroll } from './infinite_scroll';
import { clearTable, renderTableHeader, renderTableRows } from './table';
import {
  clearQueryStats,
  type QueryStatus,
  scrollToResults,
  showLoadingScreen,
  showMapViewButton,
  showQueryMetaData,
  showResults,
  showResultsSize,
  startQueryTimer,
  stopQueryTimer,
} from './utils';
import 'sparql-results';
import type { PetrimapsRenderConfig, SparqlResults, TableRenderConfig } from 'sparql-results';
import { render_query_error } from './error';

const pageSize = 100;

export interface ExecuteQueryEventDetails {
  queryId: string;
  query: string;
  pageSize: number;
}

export interface ExecuteQueryEndEventDetails {
  queryExecutionTree: QueryExecutionTree;
}

export interface QueryResultSizeDetails {
  size: number;
}

let queryStatus: QueryStatus = 'idle';

const element = document.querySelector<SparqlResults>('sparql-results')!;

export async function setupResults(editor: Editor) {
  window.addEventListener('cancel-or-execute', () => {
    if (queryStatus === 'running') {
      window.dispatchEvent(new Event('execute-cancle-request'));
    } else if (queryStatus === 'idle') {
      window.dispatchEvent(new CustomEvent('execute-start-request'));
    }
  });
  handleSignals(editor);
  setupInfiniteScroll(editor);
}

function handleSignals(editor: Editor) {
  window.addEventListener('execute-start-request', () => {
    if (queryStatus === 'idle') {
      queryStatus = 'running';
      window.dispatchEvent(new CustomEvent('execute-started'));
      executeQueryAndShowResults(editor);
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

async function executeQueryAndShowResults(editor: Editor) {
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
  element.clear();
  clearTable();

  const query = editor.getContent();
  const renderConfig = extractRenderConfig(query);
  if (renderConfig.type === 'table') {
    renderLazyResults(editor);
  } else if (renderConfig.type === 'petrimaps') {
    renderLazyResults(editor, renderConfig);
  }
  const timer = startQueryTimer();
  executeQuery(
    editor,
    renderConfig.type === 'table' || renderConfig.type === 'petrimaps',
    pageSize,
    0
  )
    .then((result) => {
      showResults();
      stopQueryTimer(timer);
      const operationTime = getOperationTimeMs(result);
      document.getElementById('queryTimeTotal')!.innerText =
        `${operationTime.toLocaleString('en-US')}ms`;
      window.dispatchEvent(new CustomEvent('execute-ended', { detail: { result: 'success' } }));
      if ('updateResult' in result) {
        renderUpdateResult(result.updateResult);
      } else if ('queryResult' in result) {
        if ('boolean' in result.queryResult.result) {
          renderAskResult(result.queryResult.result.boolean);
        } else {
          showResultsSize(result.queryResult.result.results.bindings.length);
          switch (renderConfig.type) {
            case 'lineplot':
              element.render_results(result.queryResult.result, renderConfig);
              break;
            case 'table':
              break;
            default:
              break;
          }
        }
      }
      setTimeout(scrollToResults, 100);
    })
    .catch(() => {
      stopQueryTimer(timer);
      const result = queryStatus === 'canceling' ? 'canceled' : 'error';
      window.dispatchEvent(new CustomEvent('execute-ended', { detail: { result } }));
    });
}

// Executes the query in a layz manner.
// Returns the time the query took end-to-end.
async function executeQuery(
  editor: Editor,
  lazy: boolean,
  pageSize: number,
  offset: number = 0
): Promise<ExecuteOperationResult> {
  const query = editor.getContent();
  const queryId =
    crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  window.dispatchEvent(
    new CustomEvent('execute-query', {
      detail: {
        queryId,
        query,
        pageSize,
      },
    })
  );

  // NOTE: The websocket that receives the runtime information has to be
  // connected before the query is sent, otherwise a query that finishes
  // quickly is already forgotten by QLever when the websocket arrives, and the
  // analysis tree stays empty (see `watchQueryExecution`).
  await watchQueryExecution(queryId);

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

  const response = (await editor.languageClient
    .sendRequest('qlueLs/executeOperation', {
      textDocument: {
        uri: editor.getDocumentUri(),
      },
      queryId: queryId,
      accessToken: settings.general.accessToken,
      maxResultSize: pageSize,
      resultOffset: offset,
      lazy,
    })
    .catch(render_query_error)) as ExecuteOperationResult;
  return response;
}

function extractRenderConfig(query: string): RenderConfig {
  const extractedConfig = extractConfig(query);
  if (extractedConfig.ok) {
    return extractedConfig.config;
  } else {
    console.error(
      `Error while extracting plot config:\n${extractedConfig.error}\nFalling back to table.`
    );
    const fallbackConfig: TableRenderConfig = {
      type: 'table',
    };
    return fallbackConfig;
  }
}

function renderAskResult(result: boolean) {
  const resultElement = document.getElementById('askResult')! as HTMLElement;
  resultElement.classList.remove('hidden');
  resultElement.dataset.state = `${result}`;
}

function renderUpdateResult(result: ExecuteUpdateResult) {
  const head = { vars: ['insertions', 'deletions'] };
  renderTableHeader(head);
  renderTableRows(
    head,
    result.operations.map((operation) => {
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

function renderLazyResults(editor: Editor, renderConfig: PetrimapsRenderConfig | null = null) {
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
      if (first_bindings) {
        showMapViewButton(editor, head!, partialResult.bindings, renderConfig);
        scrollToResults();
        window.dispatchEvent(new CustomEvent('infinite-scroll-start'));
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
  // Hallo, Ianni!
}
