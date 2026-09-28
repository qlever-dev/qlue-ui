// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import { clearCache } from '../buttons/clear_cache';
import type { Editor } from '../editor/init';
import { getActiveTabName } from '../tabs/init';
import type { QlueLsServiceConfig } from '../types/backend';
import { SparqlEngine } from '../types/lsp_messages';
import type { QueryExecutionTree } from '../types/query_execution_tree';
import { setupQueryAnalysisUi } from './ui';
import { setupWebSocket } from './utils';

let queryRunning = false;
let activeSocket: WebSocket | null = null;

// How long to wait for the runtime-information websocket to connect before the
// query is sent anyway (see `watchQueryExecution`). Connecting takes a few
// milliseconds directly and a few dozen through a proxy; the timeout only
// bounds the delay if the websocket cannot be established at all.
const socketConnectTimeoutMs = 2000;

// Set by `setupQueryAnalysis`, see `watchQueryExecution`.
let watchQuery: ((queryId: string) => Promise<void>) | null = null;

/**
 * Connect the websocket over which QLever sends the runtime information of the
 * query with the given id, and wait until it is connected.
 *
 * NOTE: This must happen BEFORE the query is sent. QLever keeps the runtime
 * information of a query only while that query runs and forgets it as soon as
 * it has finished. A websocket that connects afterwards is therefore never
 * served, and the analysis tree stays empty; that used to happen for every
 * query that finished faster than the websocket handshake. A watcher that is
 * registered first, in contrast, is picked up by the query when it starts.
 *
 * Resolves when the websocket is connected, and also when it cannot be
 * connected at all, so that a broken websocket never blocks the query.
 */
export function watchQueryExecution(queryId: string): Promise<void> {
  return watchQuery ? watchQuery(queryId) : Promise.resolve();
}

/**
 * Feeds the query analysis view with live runtime information.
 *
 * Connects to the QLever websocket during query execution to receive live
 * runtime information and renders it into the view. Only available for the
 * QLever engine.
 */
export function setupQueryAnalysis(editor: Editor) {
  const analysisButton = document.getElementById('analysisButton')!;

  const { openModal, render, renderStats, clear, setQueryName } = setupQueryAnalysisUi(() => {
    if (!queryRunning) {
      clearCache(editor);
      window.dispatchEvent(new Event('execute-start-request'));
    }
  });

  // NOTE: QLever reports the root's total time only once a fully
  // materialized root is computed, so the measured time is a client-side
  // clock until then.
  let queryStart = 0;
  let queryEnd: number | null = null;
  let clockTimer: ReturnType<typeof setInterval> | undefined;
  let latestTree: QueryExecutionTree | null = null;
  const elapsed = () => (queryEnd ?? performance.now()) - queryStart;

  function stopClock() {
    queryEnd = performance.now();
    clearInterval(clockTimer);
  }

  analysisButton.addEventListener('click', async () => {
    const service = (await editor.languageClient.sendRequest(
      'qlueLs/getBackend',
      {}
    )) as QlueLsServiceConfig;
    // NOTE: Only connect to websocket if service-engine is QLever
    if (service.engine !== SparqlEngine.QLever) {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: 'info',
            message: 'Query Analysis in only availiable for the QLever engine.',
            duration: 2000,
          },
        })
      );
      return;
    }
    openModal();
  });

  // The implementation of `watchQueryExecution`, see there. It lives here
  // because it needs `editor` and `zoom_to` from this scope.
  watchQuery = async (queryId: string) => {
    queryRunning = true;

    // NOTE: cleanup previous runs. Closing the previous query's socket is
    // essential: otherwise its late runtime messages keep rendering into the
    // shared tree state and corrupt the new query's tree.
    clear();
    // NOTE: the query runs in the active tab, so its name is the query's name.
    setQueryName(getActiveTabName());
    closeActiveSocket();
    clearInterval(clockTimer);
    queryEnd = null;
    latestTree = null;

    const service = (await editor.languageClient.sendRequest(
      'qlueLs/getBackend',
      {}
    )) as QlueLsServiceConfig;
    // NOTE: Only connect to websocket if service-engine is QLever
    if (service.engine !== SparqlEngine.QLever) {
      return;
    }

    clockTimer = setInterval(() => {
      if (latestTree != null) renderStats(latestTree, elapsed());
    }, 100);

    const socket = setupWebSocket(service.url, queryId);
    activeSocket = socket;

    // Resolve as soon as the websocket is connected, and also if it cannot be
    // connected (`error`) or is closed right away, so that the query is never
    // held up by more than the timeout.
    const connected = new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(done, socketConnectTimeoutMs);
      socket.addEventListener('open', done, { once: true });
      socket.addEventListener('error', done, { once: true });
      socket.addEventListener('close', done, { once: true });
    });

    socket.addEventListener('open', () => {
      socket.send('cancel_on_close');
    });

    const throttleTimeMs = 50;
    let latestMessage: string | null = null;
    let running = false;
    let messageCount = 0;
    let renderedCount = 0;

    function processMessage() {
      // NOTE: a superseded query's socket must not render anymore.
      if (socket !== activeSocket) return;
      renderedCount = messageCount;
      const queryExecutionTree = JSON.parse(latestMessage!) as QueryExecutionTree;
      latestTree = queryExecutionTree;
      render(queryExecutionTree, elapsed());

      if (queryRunning) {
        window.dispatchEvent(
          new CustomEvent('query-result-size', {
            detail: {
              size: queryExecutionTree.result_rows,
            },
          })
        );
      }
      if (messageCount !== renderedCount) {
        setTimeout(processMessage, throttleTimeMs);
      } else {
        running = false;
      }
    }

    socket.addEventListener('message', (event) => {
      // NOTE: ignore late messages from a superseded query's socket.
      if (socket !== activeSocket) return;
      latestMessage = event.data;
      messageCount++;
      if (!running) {
        running = true;
        setTimeout(processMessage, throttleTimeMs);
      }
    });
    await connected;
    queryStart = performance.now();
  };

  // NOTE: registered once (not per execute-query) to avoid accumulating
  // listeners. Canceling closes the socket, which signals QLever to cancel
  // the query (the socket sent `cancel_on_close` on open).
  window.addEventListener('execute-cancle-request', () => {
    queryRunning = false;
    stopClock();
    closeActiveSocket();
  });

  window.addEventListener('execute-ended', () => {
    queryRunning = false;
    stopClock();
  });
}

function closeActiveSocket() {
  if (activeSocket != null) {
    activeSocket.close();
    activeSocket = null;
  }
}

/**
 * Opens the query analysis modal.
 * Only available for the QLever engine.
 */
export async function openQueryAnalysis(_editor: Editor) {
  const analysisButton = document.getElementById('analysisButton')!;
  analysisButton.click();
}
