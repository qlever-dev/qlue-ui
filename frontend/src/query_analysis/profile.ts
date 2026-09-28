// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as d3 from 'd3';
import type { QueryExecutionNode, QueryExecutionTree } from '../types/query_execution_tree';
import { showNodeDetails } from './details';
import { selectNode } from './tree';
import { colorScaleDark, colorScaleLight, replaceIRIs, splitDescription } from './utils';

// NOTE: rows have a fixed height so they can be positioned by their rank, which
// lets them slide to their new position when the ranking changes.
const rowHeight = 56;
const transitionDuration = 300;

let onRowClick: ((node: QueryExecutionNode) => void) | null = null;

/**
 * Sets up the profile view: a profiling of the operations of the query.
 * `onClick` is called with the node of a clicked row.
 */
export function setupProfileView(onClick: (node: QueryExecutionNode) => void) {
  onRowClick = onClick;
  const profileView = document.getElementById('queryAnalysisProfileView')!;

  function setProfileVisible(visible: boolean) {
    profileView.classList.toggle('hidden', !visible);
    profileView.classList.toggle('flex', visible);
  }

  return { setProfileVisible };
}

// NOTE: the same number the tree shows as the time of a node.
function selfTime(node: QueryExecutionNode): number {
  return Math.max(node.operation_time, node.original_operation_time);
}

/**
 * Renders the operations of the tree as rows, ranked by their self time.
 * Expects the node ids to be assigned by the tree view.
 */
export function renderProfile(tree: QueryExecutionTree) {
  const nodes = d3
    .hierarchy(tree)
    .descendants()
    .map((d) => d.data)
    // NOTE: ties are broken by id, so rows with equal time don't swap on every update.
    .sort((a, b) => selfTime(b) - selfTime(a) || a.id! - b.id!);
  const totalTime = d3.sum(nodes, selfTime);
  const maxTime = d3.max(nodes, selfTime) ?? 0;

  const container = d3
    .select('#queryAnalysisProfileRows')
    .style('height', `${nodes.length * rowHeight}px`);

  const rows = container
    .selectAll<HTMLDivElement, QueryExecutionNode>('div.profile-row')
    .data(nodes, (d) => d.id!)
    .join((enter) =>
      enter
        .append('div')
        .attr(
          'class',
          'profile-row absolute inset-x-0 top-0 h-14 grid grid-cols-[300px_1fr_120px_74px] gap-x-[18px] items-center border-b border-gray-100 dark:border-white/5 cursor-pointer'
        )
        .style('transform', (_d, i) => `translateY(${i * rowHeight}px)`)
        .html(
          `<div class="min-w-0">
            <div class="profile-title text-[12.5px] font-semibold truncate text-gray-900 dark:text-gray-200"></div>
            <div class="profile-subtitle mt-0.5 font-mono text-[10.5px] truncate text-gray-500 dark:text-gray-200/45"></div>
          </div>
          <div class="h-3 rounded-[3px] overflow-hidden bg-gray-200 dark:bg-white/5">
            <div class="profile-bar h-full rounded-[3px] bg-[var(--bar-fill-light)] dark:bg-[var(--bar-fill-dark)]" style="width: 0%"></div>
          </div>
          <div class="profile-time text-right font-mono text-xs tabular-nums text-gray-900 dark:text-gray-200"></div>
          <div class="profile-share text-right font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-200/50"></div>`
        )
    )
    .on('click', (_event, d) => {
      selectNode(d.id!);
      showNodeDetails(d);
      onRowClick?.(d);
    });

  rows
    .transition()
    .duration(transitionDuration)
    .ease(d3.easeCubicOut)
    .style('transform', (_d, i) => `translateY(${i * rowHeight}px)`);

  rows.each(function(d) {
    const { title, subtitle } = splitDescription(d.description);
    this.querySelector('.profile-title')!.textContent = replaceIRIs(title);
    this.querySelector('.profile-subtitle')!.textContent = subtitle ? replaceIRIs(subtitle) : '—';
    this.querySelector('.profile-time')!.textContent = `${selfTime(d).toLocaleString('en-US')} ms`;
    const share = totalTime > 0 ? (selfTime(d) / totalTime) * 100 : 0;
    this.querySelector('.profile-share')!.textContent = `${share.toFixed(share < 10 ? 1 : 0)}%`;
  });

  rows
    .select<HTMLDivElement>('.profile-bar')
    .style('--bar-fill-light', (d) => colorScaleLight(selfTime(d)))
    .style('--bar-fill-dark', (d) => colorScaleDark(selfTime(d)))
    .transition()
    .duration(transitionDuration)
    .ease(d3.easeCubicOut)
    // NOTE: a minimal width keeps the bars of cheap operations visible.
    .style('width', (d) => `${maxTime > 0 ? Math.max((selfTime(d) / maxTime) * 100, 0.4) : 0.4}%`);
}

export function clearProfile() {
  d3.select('#queryAnalysisProfileRows').selectAll('div.profile-row').remove();
}
