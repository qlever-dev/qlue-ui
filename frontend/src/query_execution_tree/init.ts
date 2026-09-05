// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as d3 from 'd3';
import { clearCache } from '../buttons/clear_cache';
import type { Editor } from '../editor/init';
import type { ExecuteQueryEventDetails } from '../results/init';
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

/**
 * Sets up the query execution tree (QET) view: the D3 SVG canvas with
 * zoom/pan, the animated gradients, the node details panel and the modal
 * open/close handling.
 *
 * This part is independent of the editor and the backend, so the dev rig
 * (`qet.html`) can drive the same view with simulated data.
 */
export function setupQetView() {
  const queryTreeModal = document.getElementById('queryExecutionTreeModal')!;
  const closeButton = document.getElementById('queryExecutionTreeModalCloseButton')!;

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

  closeButton.addEventListener('click', () => {
    closeModal();
  });

  function openModal() {
    queryTreeModal.classList.remove('hidden');
    visible = true;
    // @ts-expect-error
    svg.call(zoom.translateTo, 0, 0);
    document.body.classList.add('overflow-y-hidden');
  }

  function renderTree(tree: QueryExecutionTree) {
    renderQueryExecutionTree(tree, zoom_to);
  }

  return { openModal, renderTree };
}

/**
 * Initializes the query execution tree (QET) analysis modal.
 *
 * Connects to the QLever websocket during query execution to receive live
 * runtime information and renders it into the view. Only available for the
 * QLever engine.
 */
export function setupQueryExecutionTree(editor: Editor) {
  const rerunButton = document.getElementById('rerunQueryButton')!;
  const analysisButton = document.getElementById('analysisButton')!;

  const { openModal, renderTree } = setupQetView();

  rerunButton.addEventListener('click', () => {
    if (!queryRunning) {
      clearCache(editor);
      window.dispatchEvent(new Event('execute-start-request'));
    }
  });

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

    const { queryId } = (event as CustomEvent<ExecuteQueryEventDetails>).detail;

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
      renderTree(queryExecutionTree);
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
