// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import { clearCache } from '../buttons/clear_cache';
import type { Editor } from '../editor/init';
import type { ExecuteQueryEventDetails } from '../results/init';
import type { QlueLsServiceConfig } from '../types/backend';
import { SparqlEngine } from '../types/lsp_messages';
import type { QueryExecutionTree } from '../types/query_execution_tree';
import { setupWebSocket } from './utils';
import { setupQueryAnalysisUi } from './ui';

let queryRunning = false;
let activeSocket: WebSocket | null = null;

/**
 * Feeds the query analysis view with live runtime information.
 *
 * Connects to the QLever websocket during query execution to receive live
 * runtime information and renders it into the view. Only available for the
 * QLever engine.
 */
export function setupQueryAnalysis(editor: Editor) {
  const analysisButton = document.getElementById('analysisButton')!;

  const { openModal, render, renderStats, clear } = setupQueryAnalysisUi(() => {
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

  window.addEventListener('execute-query', async (event) => {
    queryRunning = true;

    // NOTE: cleanup previous runs. Closing the previous query's socket is
    // essential: otherwise its late runtime messages keep rendering into the
    // shared tree state and corrupt the new query's tree.
    clear();
    closeActiveSocket();
    clearInterval(clockTimer);
    queryStart = performance.now();
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

    const { queryId } = (event as CustomEvent<ExecuteQueryEventDetails>).detail;

    clockTimer = setInterval(() => {
      if (latestTree != null) renderStats(latestTree, elapsed());
    }, 100);

    const socket = setupWebSocket(service.url, queryId);
    activeSocket = socket;

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
      render(queryExecutionTree);
      renderStats(queryExecutionTree, elapsed());

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
  });

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
