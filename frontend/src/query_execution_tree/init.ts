// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as d3 from 'd3';
import { clearCache } from '../buttons/clear_cache';
import type { Editor } from '../editor/init';
import type { QlueLsServiceConfig } from '../types/backend';
import { SparqlEngine } from '../types/lsp_messages';
import type { QueryExecutionTree } from '../types/query_execution_tree';
import { isDetailsVisible, setupNodeDetailsPanel } from './details';
import { animateGradients } from './gradients';
import {
  clearQueryExecutionTree,
  deselectNode,
  renderQueryExecutionTree,
  setupAutozoom,
} from './tree';
import { setupWebSocket } from './utils';

const margin = { top: 20, right: 20, bottom: 20, left: 20 };
let visible = false;
let queryRunning = false;
let activeSocket: WebSocket | null = null;

// How long to wait for the runtime-information websocket to connect before the
// query is sent anyway (see `watchQueryExecution`). Connecting takes a few
// milliseconds directly and a few dozen through a proxy; the timeout only
// bounds the delay if the websocket cannot be established at all.
const socketConnectTimeoutMs = 2000;

// Set by `setupQueryExecutionTree`, see `watchQueryExecution`.
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
 * Initializes the query execution tree (QET) analysis modal.
 *
 * Sets up the D3 SVG canvas with zoom/pan, connects to the QLever websocket
 * during query execution to receive live runtime information, and renders
 * the tree visualization with animated gradients. Only available for the
 * QLever engine.
 */
export function setupQueryExecutionTree(editor: Editor) {
  const queryTreeModal = document.getElementById('queryExecutionTreeModal')!;
  const analysisButton = document.getElementById('analysisButton')!;
  const closeButton = document.getElementById('queryExecutionTreeModalCloseButton')!;
  const rerunButton = document.getElementById('rerunQueryButton')!;

  setupAutozoom();
  setupNodeDetailsPanel(() => deselectNode());

  window.addEventListener('keydown', (e) => {
    if (visible && e.key === 'Escape') {
      if (isDetailsVisible()) {
        deselectNode();
      } else {
        closeModal();
      }
    }
  });

  queryTreeModal.addEventListener('pointerdown', (e) => {
    if (e.target instanceof SVGTextElement) return;
    queryTreeModal.classList.remove('cursor-grab');
    queryTreeModal.classList.add('cursor-grabbing');
  });
  queryTreeModal.addEventListener('pointerup', () => {
    queryTreeModal.classList.remove('cursor-grabbing');
    queryTreeModal.classList.add('cursor-grab');
  });

  rerunButton.addEventListener('click', () => {
    if (!queryRunning) {
      clearCache(editor);
      window.dispatchEvent(new Event('execute-start-request'));
    }
  });

  const width = window.innerWidth;
  const height = window.innerHeight;

  const svg = d3
    .select<SVGElement, unknown>('#queryExecutionTreeSvg')
    .attr('width', width)
    .attr('height', height);
  const container = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const zoom = d3
    .zoom()
    .scaleExtent([0.5, 5])
    .filter((event) => {
      if (event.type === 'wheel') return true;
      if (event.target instanceof SVGTextElement) return false;
      return !event.ctrlKey && !event.button;
    })
    .on('zoom', (event) => {
      if (event.sourceEvent != null) {
        window.dispatchEvent(new Event('zoom'));
      }
      container.attr('transform', event.transform);
    });

  // @ts-expect-error
  svg.call(zoom);

  animateGradients();

  function zoom_to(x: number, y: number, duration = 750) {
    const svgEl = svg.node();
    if (!svgEl) return;

    const scale = 1;

    const targetTransform = d3.zoomIdentity.translate(
      svgEl.clientWidth / 2 - x * scale,
      svgEl.clientHeight / 2 - y * scale
    );

    svg
      .transition()
      .duration(duration)
      .ease(d3.easeLinear)
      // @ts-expect-error
      .call(zoom.transform, targetTransform);
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
    queryTreeModal.classList.remove('hidden');
    visible = true;
    // @ts-expect-error
    svg.call(zoom.translateTo, 0, 0);
    document.body.classList.add('overflow-y-hidden');
  });

  closeButton.addEventListener('click', () => {
    closeModal();
  });

  // The implementation of `watchQueryExecution`, see there. It lives here
  // because it needs `editor` and `zoom_to` from this scope.
  watchQuery = async (queryId: string) => {
    queryRunning = true;

    // NOTE: cleanup previous runs. Closing the previous query's socket is
    // essential: otherwise its late runtime messages keep rendering into the
    // shared tree state and corrupt the new query's tree.
    clearQueryExecutionTree();
    closeActiveSocket();

    const service = (await editor.languageClient.sendRequest(
      'qlueLs/getBackend',
      {}
    )) as QlueLsServiceConfig;
    // NOTE: Only connect to websocket if service-engine is QLever
    if (service.engine !== SparqlEngine.QLever) {
      return;
    }

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
      renderQueryExecutionTree(queryExecutionTree, zoom_to);
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
  };

  // NOTE: registered once (not per execute-query) to avoid accumulating
  // listeners. Canceling closes the socket, which signals QLever to cancel
  // the query (the socket sent `cancel_on_close` on open).
  window.addEventListener('execute-cancle-request', () => {
    queryRunning = false;
    closeActiveSocket();
  });

  window.addEventListener('execute-ended', () => {
    queryRunning = false;
  });
}

function closeActiveSocket() {
  if (activeSocket != null) {
    activeSocket.close();
    activeSocket = null;
  }
}

function closeModal() {
  const queryTreeModal = document.getElementById('queryExecutionTreeModal')!;
  queryTreeModal.classList.add('hidden');
  visible = false;
  deselectNode();
  document.body.classList.remove('overflow-y-hidden');
}

/**
 * Opens the query execution tree modal.
 * Only available for the QLever engine.
 */
export async function openQueryExecutionTree(_editor: Editor) {
  const analysisButton = document.getElementById('analysisButton')!;
  analysisButton.click();
}
