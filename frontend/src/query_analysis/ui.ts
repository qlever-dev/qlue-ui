// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as d3 from 'd3';
import type { NodeStatus, QueryExecutionTree } from '../types/query_execution_tree';
import { isDetailsVisible, setupNodeDetailsPanel } from './details';
import { clearProfile, renderProfile, setupProfileView } from './profile';
import { clearQueryExecutionTree, deselectNode, setupTreeView } from './tree';
import {
  colorScaleDark,
  colorScaleLight,
  renderStatusIndicator,
  statusIndicatorRadius,
} from './utils';

const VIEW_STORAGE_KEY = 'queryAnalysisView';
let visible = false;

/**
 * Sets up the query analysis modal: the open/close handling, the node details
 * panel (shared by all views) and the switch between the views.
 *
 * This part is independent of the editor and the backend, so the dev rig
 * (`qet.html`) can drive the same modal with simulated data.
 */
export function setupQueryAnalysisUi(onRerun: () => void) {
  const queryAnalysisModal = document.getElementById('queryAnalysisModal')!;
  const closeButton = document.getElementById('queryAnalysisModalCloseButton')!;
  const rerunButton = document.getElementById('rerunQueryButton')!;

  const { renderTree, resetZoom, focusNode } = setupTreeView();
  setupNodeDetailsPanel(() => deselectNode());
  const { setProfileVisible } = setupProfileView((node) => {
    switchView('tree');
    focusNode(node.id!);
  });
  const { switchView } = setupViewSwitch(setProfileVisible);
  renderTimeLegend();
  renderStatusLegend();

  window.addEventListener('keydown', (e) => {
    if (visible && e.key === 'Escape') {
      if (isDetailsVisible()) {
        deselectNode();
      } else {
        closeModal();
      }
    }
  });

  closeButton.addEventListener('click', () => {
    closeModal();
  });

  rerunButton.addEventListener('click', onRerun);

  function openModal() {
    queryAnalysisModal.classList.remove('hidden');
    visible = true;
    resetZoom();
    document.body.classList.add('overflow-y-hidden');
  }

  // NOTE: the tree assigns the node ids the profile relies on, so it renders first.
  function render(tree: QueryExecutionTree, elapsedMs: number) {
    renderTree(tree);
    renderProfile(tree);
    renderStats(tree, elapsedMs);
  }

  // NOTE: the view keeps the rendered tree as state; dropping it makes the next
  // render rebuild the layout from scratch.
  function clear() {
    clearQueryExecutionTree();
    clearProfile();
  }

  return { openModal, render, renderStats, clear };
}

/**
 * Switches between the "tree" and the "profile" view of the analysis modal.
 * The node details panel is shared and stays visible across both views.
 * The selected view persists across reloads.
 */
function setupViewSwitch(setProfileVisible: (visible: boolean) => void) {
  const viewSwitch = document.getElementById('queryAnalysisViewSwitch')!;
  const treeView = document.getElementById('queryExecutionTreeSvg')!;

  function showView(view: string) {
    viewSwitch.dataset.state = view;
    // NOTE: the tree is made invisible rather than `hidden`, so it keeps its
    // size and the zoom/autozoom keep working while it is not shown.
    treeView.classList.toggle('invisible', view !== 'tree');
    setProfileVisible(view === 'profile');
  }

  function switchView(view: string) {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
    showView(view);
  }

  showView(localStorage.getItem(VIEW_STORAGE_KEY) === 'profile' ? 'profile' : 'tree');

  viewSwitch.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => {
    button.addEventListener('click', () => switchView(button.dataset.view!));
  });

  return { switchView };
}

/**
 * Renders the legend of the operation time colors in the footer.
 * The gradients are sampled from the color scales along a shared symlog axis
 * that spans the domains of both scales, so they show the scales exactly.
 */
function renderTimeLegend() {
  const legend = document.getElementById('queryAnalysisTimeLegend')!;
  const ticks = document.getElementById('queryAnalysisTimeLegendTicks')!;
  const [min, max] = d3.extent([...colorScaleDark.domain(), ...colorScaleLight.domain()]) as [
    number,
    number,
  ];
  const position = d3.scaleSymlog().domain([min, max]).constant(colorScaleDark.constant());

  const stops = d3.range(0, 21).map((i) => i / 20);
  const gradient = (scale: (value: number) => string) =>
    `linear-gradient(to right, ${stops.map((t) => `${scale(position.invert(t))} ${t * 100}%`).join(', ')})`;
  legend.style.setProperty('--legend-light', gradient(colorScaleLight));
  legend.style.setProperty('--legend-dark', gradient(colorScaleDark));

  const tickValues = [min, 1_000, 10_000, max];
  ticks.replaceChildren(
    ...tickValues.map((value, i) => {
      const tick = document.createElement('span');
      tick.className = 'absolute top-0 whitespace-nowrap';
      tick.style.left = `${position(value) * 100}%`;
      // NOTE: the outer labels are aligned to the ends of the gradient
      tick.style.translate = i === 0 ? '0' : i === tickValues.length - 1 ? '-100%' : '-50%';
      tick.textContent = value < 1_000 ? `${value} ms` : `${value / 1_000} s`;
      return tick;
    })
  );
}

// NOTE: one entry per distinct indicator; the lazily and fully materialized
// variants of a state share one.
const statusLegendEntries: [NodeStatus, string][] = [
  ['not started', 'not started'],
  ['fully materialized in progress', 'in progress'],
  ['fully materialized completed', 'completed'],
  ['optimized out', 'optimized out'],
  ['cancelled', 'cancelled'],
  ['failed', 'failed'],
  ['failed because child failed', 'child failed'],
];

/**
 * Renders the legend of the operation status indicators in the footer.
 * The indicators are drawn by the same function as in the views.
 */
function renderStatusLegend() {
  const legend = document.getElementById('queryAnalysisStatusLegend')!;
  legend.replaceChildren(
    ...statusLegendEntries.map(([status, label]) => {
      const entry = document.createElement('div');
      entry.className = 'flex flex-row items-center gap-1.5';
      entry.innerHTML = `
        <svg class="size-2 overflow-visible">
          <circle cx="${statusIndicatorRadius}" cy="${statusIndicatorRadius}" r="${statusIndicatorRadius}"></circle>
          <circle cx="${statusIndicatorRadius}" cy="${statusIndicatorRadius}" r="${statusIndicatorRadius}"></circle>
        </svg>
        <span></span>`;
      renderStatusIndicator(entry.querySelector('svg')!, status);
      entry.querySelector('span')!.textContent = label;
      return entry;
    })
  );
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
