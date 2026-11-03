import type { QueryExecutionNode, QueryExecutionTree } from '../types/query_execution_tree';
import { replaceIRIs } from './utils';

let panelEl: HTMLElement | null = null;
let contentEl: HTMLElement | null = null;
let selectedId: number | null = null;
let onCloseCallback: (() => void) | null = null;

export function setupNodeDetailsPanel(onClose: () => void) {
  panelEl = document.getElementById('queryExecutionTreeDetailsPanel');
  contentEl = document.getElementById('queryExecutionTreeDetailsContent');
  const closeButton = document.getElementById('queryExecutionTreeDetailsCloseButton');
  onCloseCallback = onClose;
  closeButton?.addEventListener('click', () => {
    hideNodeDetails();
    onCloseCallback?.();
  });
}

export function getSelectedId(): number | null {
  return selectedId;
}

export function isDetailsVisible(): boolean {
  return panelEl != null && !panelEl.classList.contains('hidden');
}

export function showNodeDetails(node: QueryExecutionNode) {
  if (!panelEl || !contentEl) return;
  selectedId = node.id ?? null;
  renderInto(contentEl, node);
  panelEl.classList.remove('hidden');
  panelEl.classList.add('flex');
  contentEl.scrollTop = 0;
}

export function hideNodeDetails() {
  if (!panelEl) return;
  selectedId = null;
  panelEl.classList.add('hidden');
  panelEl.classList.remove('flex');
}

export function refreshSelectedNode(root: QueryExecutionTree) {
  if (selectedId == null || !contentEl) return;
  const node = findNodeById(root, selectedId);
  if (node) renderInto(contentEl, node);
}

function findNodeById(node: QueryExecutionNode, id: number): QueryExecutionNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

function renderInto(container: HTMLElement, node: QueryExecutionNode) {
  container.replaceChildren(
    descriptionSection(node),
    statusSection(node),
    resultSection(node),
    columnsSection(node),
    timeSection(node),
    costSection(node),
    ...(node.details ? [detailsSection(node.details)] : [])
  );
}

function descriptionSection(node: QueryExecutionNode): HTMLElement {
  const section = document.createElement('div');
  section.className = 'mb-5';
  const label = sectionLabel('Operation');
  const desc = document.createElement('p');
  desc.className =
    'mt-1 font-mono text-[13px] leading-snug break-words text-gray-900 dark:text-neutral-200';
  desc.textContent = replaceIRIs(node.description);
  section.append(label, desc);
  return section;
}

function statusSection(node: QueryExecutionNode): HTMLElement {
  return keyValueSection('Status', [
    ['Status', statusBadge(node.status)],
    ['Cache', cacheBadge(node.cache_status)],
  ]);
}

function resultSection(node: QueryExecutionNode): HTMLElement {
  return keyValueSection('Result', [
    ['Rows', text(node.result_rows.toLocaleString('en-US'))],
    ['Cols', text(node.result_cols.toString())],
    ['Estimated size', text(node.estimated_size.toLocaleString('en-US'))],
  ]);
}

function columnsSection(node: QueryExecutionNode): HTMLElement {
  const section = document.createElement('div');
  section.className = 'mb-5';
  section.append(sectionLabel('Columns'));
  if (node.column_names.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'mt-1 text-xs text-gray-500 dark:text-neutral-500 italic';
    empty.textContent = 'no columns';
    section.append(empty);
    return section;
  }
  const list = document.createElement('div');
  list.className = 'mt-2 flex flex-wrap gap-1';
  node.column_names.forEach((col, i) => {
    const chip = document.createElement('span');
    chip.className =
      'inline-flex items-center gap-1 rounded bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs font-mono text-gray-800 dark:text-neutral-200';
    const mult = node.estimated_column_multiplicities[i];
    if (mult != null) {
      chip.title = `multiplicity ≈ ${mult.toFixed(2)}`;
    }
    chip.textContent = col;
    list.append(chip);
  });
  section.append(list);
  return section;
}

function timeSection(node: QueryExecutionNode): HTMLElement {
  return keyValueSection('Time', [
    ['Operation', text(formatMs(node.operation_time))],
    ['Total', text(formatMs(node.total_time))],
    ['Original op.', text(formatMs(node.original_operation_time))],
    ['Original total', text(formatMs(node.original_total_time))],
  ]);
}

function costSection(node: QueryExecutionNode): HTMLElement {
  return keyValueSection('Cost (estimated)', [
    ['Operation', text(node.estimated_operation_cost.toLocaleString('en-US'))],
    ['Total', text(node.estimated_total_cost.toLocaleString('en-US'))],
  ]);
}

function detailsSection(details: Record<string, unknown>): HTMLElement {
  const rows = Object.entries(details).map(([key, value]): [string, HTMLElement] => [
    key,
    text(formatDetailValue(value)),
  ]);
  return keyValueSection('Details', rows);
}

// Render one value of the `Details` section. Integers are grouped in threes,
// like the other numbers of the panel, because these are mostly counts and
// are hard to read otherwise. Numbers with fraction digits are left alone,
// since grouping them would also round them to three fraction digits.
function formatDetailValue(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value.toLocaleString('en-US');
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function keyValueSection(title: string, rows: [string, HTMLElement][]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'mb-5';
  section.append(sectionLabel(title));
  const grid = document.createElement('dl');
  grid.className = 'mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1';
  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    dt.className = 'text-xs text-gray-500 dark:text-neutral-400 self-center';
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.className = 'text-sm text-gray-900 dark:text-neutral-200';
    dd.append(value);
    grid.append(dt, dd);
  }
  section.append(grid);
  return section;
}

function sectionLabel(title: string): HTMLElement {
  const el = document.createElement('h4');
  el.className =
    'text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-neutral-400';
  el.textContent = title;
  return el;
}

function text(value: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'font-mono text-[13px]';
  span.textContent = value;
  return span;
}

function statusBadge(status: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `inline-block rounded px-2 py-0.5 text-xs font-medium ${statusColor(status)}`;
  badge.textContent = status;
  return badge;
}

function cacheBadge(cache: string): HTMLElement {
  const badge = document.createElement('span');
  const color =
    cache === 'cached_not_pinned'
      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300'
      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-neutral-300';
  badge.className = `inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`;
  badge.textContent = cache;
  return badge;
}

function statusColor(status: string): string {
  if (status.includes('completed')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
  }
  if (status.includes('in progress')) {
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  }
  if (status === 'failed' || status === 'failed because child failed') {
    return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
  }
  if (status === 'cancelled' || status === 'optimized out') {
    return 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-neutral-400';
  }
  return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-neutral-300';
}

function formatMs(ms: number): string {
  return `${ms.toLocaleString('en-US')} ms`;
}
