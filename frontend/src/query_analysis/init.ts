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
export function setupTreeView() {
  const queryAnalysisModal = document.getElementById('queryAnalysisModal')!;
  const closeButton = document.getElementById('queryAnalysisModalCloseButton')!;

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

  queryAnalysisModal.addEventListener('pointerdown', (e) => {
    if (e.target instanceof SVGTextElement) return;
    queryAnalysisModal.classList.remove('cursor-grab');
    queryAnalysisModal.classList.add('cursor-grabbing');
  });
  queryAnalysisModal.addEventListener('pointerup', () => {
    queryAnalysisModal.classList.remove('cursor-grabbing');
    queryAnalysisModal.classList.add('cursor-grab');
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
    queryAnalysisModal.classList.remove('hidden');
    visible = true;
    // @ts-expect-error
    svg.call(zoom.translateTo, 0, 0);
    document.body.classList.add('overflow-y-hidden');
  }

  function renderTree(tree: QueryExecutionTree) {
    renderQueryExecutionTree(tree, zoom_to);
  }

  return { openModal, renderTree, renderStats };
}

/**
 * Initializes the query analysis modal.
 *
 * Connects to the QLever websocket during query execution to receive live
 * runtime information and renders it into the view. Only available for the
 * QLever engine.
 */
export function setupQueryAnalysis(editor: Editor) {
  const rerunButton = document.getElementById('rerunQueryButton')!;
  const analysisButton = document.getElementById('analysisButton')!;

  const { openModal, renderTree, renderStats } = setupTreeView();

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
      renderTree(queryExecutionTree);
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

function closeModal() {
  const queryAnalysisModal = document.getElementById('queryAnalysisModal')!;
  queryAnalysisModal.classList.add('hidden');
  visible = false;
  deselectNode();
  document.body.classList.remove('overflow-y-hidden');
}

/**
 * Fills the stats in the analysis header: number of operations, how many are
 * in progress / completed, and the measured time. The measured time is the
 * root's total time once the root is completed, `elapsedMs` before that.
 */
function renderStats(tree: QueryExecutionTree, elapsedMs: number) {
  let operations = 0;
  let inProgress = 0;
  let completed = 0;
  const stack = [tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    operations++;
    if (node.status.endsWith('in progress')) inProgress++;
    if (node.status.endsWith('completed')) completed++;
    stack.push(...node.children);
  }
  document.getElementById('queryAnalysisStatsOperations')!.textContent =
    operations.toLocaleString('en-US');
  document.getElementById('queryAnalysisStatsInProgress')!.textContent =
    inProgress.toLocaleString('en-US');
  document.getElementById('queryAnalysisStatsCompleted')!.textContent =
    completed.toLocaleString('en-US');
  const time = tree.status.endsWith('completed') ? tree.total_time : Math.round(elapsedMs);
  document.getElementById('queryAnalysisStatsTime')!.textContent =
    `${time.toLocaleString('en-US')} ms`;
}

/**
 * Opens the query analysis modal.
 * Only available for the QLever engine.
 */
export async function openQueryAnalysis(_editor: Editor) {
  const analysisButton = document.getElementById('analysisButton')!;
  analysisButton.click();
}
