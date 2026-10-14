// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { QueryExecutionTree, QueryMeta } from '../types/query_execution_tree';

/**
 * Fills the stats in the analysis header: number of operations, how many are
 * in progress / completed, and the planning, execution and total time. The
 * execution time is the root's total time once the root is completed,
 * `elapsedMs` before that; the total time is planning plus execution time.
 */
export function renderStats(tree: QueryExecutionTree, elapsedMs: number) {
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
  const executionTime = tree.status.endsWith('completed') ? tree.total_time : Math.round(elapsedMs);
  document.getElementById('queryAnalysisStatsExecutionTime')!.textContent =
    `${executionTime.toLocaleString('en-US')} ms`;
  if (tree.meta) {
    const planningTime = tree.meta.time_query_planning;
    document.getElementById('queryAnalysisStatsPlanningTime')!.textContent =
      `${planningTime.toLocaleString('en-US')} ms`;
    document.getElementById('queryAnalysisStatsTotalTime')!.textContent =
      `${(planningTime + executionTime).toLocaleString('en-US')} ms`;
  } else {
    document.getElementById('queryAnalysisStatsPlanningTime')!.textContent = 'N/A';
    document.getElementById('queryAnalysisStatsTotalTime')!.textContent = 'N/A';
  }
  if (tree.meta !== renderedMeta) {
    renderPlanning(tree.meta);
    renderedMeta = tree.meta;
  }
}

/**
 * Makes the planning time stat fold out the query planning popover on click.
 * A click anywhere else folds it back in.
 */
export function setupPlanningPopover() {
  const trigger = document.getElementById('queryAnalysisPlanningTrigger')!;
  const toggle = document.getElementById('queryAnalysisPlanningToggle')!;
  toggle.addEventListener('click', () => trigger.toggleAttribute('data-open'));
  document.addEventListener('click', (e) => {
    if (!trigger.contains(e.target as Node)) trigger.removeAttribute('data-open');
  });
}

// NOTE: the stats are rendered on every clock tick, but the planning info only
// changes with the query; rerendering it would reset its scroll position.
let renderedMeta: QueryMeta | undefined;

const planningRowClass =
  'grid grid-cols-[26px_150px_repeat(4,minmax(80px,1fr))] gap-x-3 items-center px-3.5 py-1.5 border-b border-gray-100 dark:border-white/5';

/**
 * Fills the query planning popover of the planning time stat: one row per
 * connected component that had something to plan, the single-node components
 * collapsed into one row. The popover only folds out if there is planning info.
 */
function renderPlanning(meta: QueryMeta | undefined) {
  const trigger = document.getElementById('queryAnalysisPlanningTrigger')!;
  const components = meta?.query_planning ?? [];
  trigger.toggleAttribute('data-planning', components.length > 0);
  if (components.length === 0) return;

  const format = (n: number) => n.toLocaleString('en-US');
  document.getElementById('queryAnalysisPlanningComponents')!.textContent =
    `${format(components.length)} connected component${components.length === 1 ? '' : 's'}`;
  document.getElementById('queryAnalysisPlanningTime')!.textContent =
    `${format(meta!.time_query_planning)} ms`;

  const rows = components
    .map((component, i) => ({ ...component, index: i + 1 }))
    .filter((component) => component.num_nodes > 1)
    .map((component) => {
      const row = document.createElement('div');
      row.className = planningRowClass;
      // NOTE: the subgraphs are only counted up to `budget + 1`.
      const subgraphs =
        component.num_connected_subgraphs > component.budget
          ? `>${format(component.budget)}`
          : format(component.num_connected_subgraphs);
      const share = ((component.num_connected_subgraphs / component.budget) * 100).toFixed(1);
      row.title = `Component ${component.index} · ${component.algorithm} · ${subgraphs} of ${format(component.budget)} subgraph budget (${share}%)`;
      row.innerHTML = `
        <div class="font-mono tabular-nums text-gray-500">${component.index}</div>
        <div class="font-mono text-[11px] whitespace-nowrap text-gray-700 dark:text-neutral-300">${component.algorithm}</div>
        <div class="text-right font-mono tabular-nums text-gray-900 dark:text-neutral-200">${format(component.num_nodes)}</div>
        <div class="text-right font-mono tabular-nums text-gray-900 dark:text-neutral-200">${format(component.num_candidate_plans)}</div>
        <div class="text-right font-mono tabular-nums text-gray-900 dark:text-neutral-200">${subgraphs}</div>
        <div class="text-right font-mono tabular-nums text-gray-500">${format(component.budget)}</div>`;
      return row;
    });

  const singleNodes = components.filter((component) => component.num_nodes <= 1).length;
  if (singleNodes > 0) {
    const row = document.createElement('div');
    row.className = `${planningRowClass} text-gray-500`;
    row.innerHTML = `
      <div class="font-mono tabular-nums">${format(singleNodes)}×</div>
      <div class="col-span-5">single-node component${singleNodes === 1 ? '' : 's'} — nothing to plan</div>`;
    rows.push(row);
  }
  document.getElementById('queryAnalysisPlanningRows')!.replaceChildren(...rows);

  document.getElementById('queryAnalysisPlanningTotalNodes')!.textContent = format(
    components.reduce((sum, component) => sum + component.num_nodes, 0)
  );
  document.getElementById('queryAnalysisPlanningTotalCandidates')!.textContent = format(
    components.reduce((sum, component) => sum + component.num_candidate_plans, 0)
  );
}
