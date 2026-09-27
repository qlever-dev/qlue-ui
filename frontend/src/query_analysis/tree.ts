import * as d3 from 'd3';
import type {
  NodeStatus,
  QueryExecutionNode,
  QueryExecutionTree,
} from '../types/query_execution_tree';
import { getSelectedId, hideNodeDetails, refreshSelectedNode, showNodeDetails } from './details';
import {
  activeSubTree,
  findActiveNode,
  fitText,
  line,
  measureTextWidth,
  replaceIRIs,
  splitDescription,
} from './utils';

const statusBadgeHeight = 18;
const statusBadgePaddingX = 8;

function statusBadgeLabel(status: NodeStatus): string {
  if (status.includes('completed')) return 'DONE';
  if (status === 'lazily materialized in progress') return 'LAZY';
  if (status === 'fully materialized in progress') return 'RUNNING';
  if (status === 'failed' || status === 'failed because child failed') return 'FAILED';
  if (status === 'cancelled') return 'CANCELLED';
  if (status === 'optimized out') return 'SKIPPED';
  return 'PENDING';
}

function statusBadgeColor(status: NodeStatus): { bg: string; text: string } {
  if (status.includes('completed')) {
    return {
      bg: 'fill-green-100 dark:fill-green-900/40',
      text: 'fill-green-800 dark:fill-green-300',
    };
  }
  if (status.includes('in progress')) {
    return {
      bg: 'fill-amber-100 dark:fill-amber-900/40',
      text: 'fill-amber-800 dark:fill-amber-300',
    };
  }
  if (status === 'failed' || status === 'failed because child failed') {
    return { bg: 'fill-red-100 dark:fill-red-900/40', text: 'fill-red-800 dark:fill-red-300' };
  }
  if (status === 'cancelled' || status === 'optimized out') {
    return { bg: 'fill-gray-200 dark:fill-gray-800', text: 'fill-gray-700 dark:fill-neutral-400' };
  }
  return { bg: 'fill-gray-100 dark:fill-gray-800', text: 'fill-gray-800 dark:fill-neutral-300' };
}

// NOTE: sizes and positions a status pill (rect + text) to the top-right corner of the box,
// with width fit to the label so it always reads as a pill rather than a fixed-width chip.
function renderStatusBadge(group: SVGGElement, status: NodeStatus) {
  const rect = group.querySelector('rect')!;
  const text = group.querySelector('text')!;

  const label = statusBadgeLabel(status);
  const colors = statusBadgeColor(status);

  text.textContent = label;
  text.setAttribute(
    'class',
    `status-badge-text text-[10px] font-semibold uppercase tracking-wide cursor-text select-text ${colors.text}`
  );
  const labelWidth = measureTextWidth(text, label);
  const pillWidth = labelWidth + statusBadgePaddingX * 2;
  const pillRight = boxWidth / 2 - 12;

  text.setAttribute('x', String(pillRight - statusBadgePaddingX));
  rect.setAttribute('x', String(pillRight - pillWidth));
  rect.setAttribute('width', String(pillWidth));
  rect.setAttribute('class', `status-badge-bg ${colors.bg}`);
}

const colorScaleDark = d3
  .scaleSymlog<string, string>()
  .domain([1, 60000])
  .range(['#404040', 'red'])
  .constant(1000)
  .interpolate(d3.interpolateHsl)
  .clamp(true);

const colorScaleLight = d3
  .scaleSymlog([1, 60_000], ['white', 'red'])
  .constant(1000)
  .interpolate(d3.interpolateHsl)
  .clamp(true);

const boxWidth = 300;
const boxHeight = 130;
const boxMargin = 30;
const boxPadding = 20;
const boxRadius = 8;

// NOTE: When the user zooms, auto zoom is disabled for 5 seconds
let autoZoom = true;
let zoomTimeout: number | null = null;

let height = 0;

export function setupAutozoom() {
  const autoZoomButton = document.getElementById('autoZoomButton')!;
  height = window.innerHeight;

  autoZoomButton.addEventListener('click', () => {
    autoZoomButton.classList.toggle('ring-2');
    autoZoom = !autoZoom;

    if (zoomTimeout != null) {
      clearTimeout(zoomTimeout);
    }
  });
  window.addEventListener('zoom', () => {
    if (zoomTimeout != null) {
      clearTimeout(zoomTimeout);
    }
    if (autoZoom) {
      zoomTimeout = setTimeout(() => {
        zoomTimeout = null;
      }, 5000);
    }
  });
}

// NOTE: ids of nodes whose subtree is folded away
const collapsedIds = new Set<number>();

// NOTE: chevron points the way a click moves the subtree: down to unfold, up to fold
function foldLabel(node: d3.HierarchyNode<QueryExecutionTree>): string {
  return collapsedIds.has(node.data.id!) ? '▾' : '▴';
}

// NOTE: zoom targets must be visible: a hidden node resolves to the folded ancestor
// that stands in for it
function visibleStandIn(
  node: d3.HierarchyNode<QueryExecutionTree>
): d3.HierarchyNode<QueryExecutionTree> {
  const foldedAncestor = node
    .ancestors()
    .reverse()
    .find((ancestor) => collapsedIds.has(ancestor.data.id!));
  return foldedAncestor ?? node;
}

function isHidden(node: d3.HierarchyNode<QueryExecutionTree>): boolean {
  return node
    .ancestors()
    .slice(1)
    .some((ancestor) => collapsedIds.has(ancestor.data.id!));
}

// NOTE: nodes and the links/glows pointing at them are hidden when any ancestor is folded
function applyFoldVisibility() {
  const container = d3.select('#treeContainer');
  container
    .selectAll<SVGGElement, d3.HierarchyNode<QueryExecutionTree>>('.node')
    .attr('display', (d) => (isHidden(d) ? 'none' : null));
  container
    .selectAll<SVGPathElement, d3.HierarchyNode<QueryExecutionTree>>('path.link, path.glow')
    .attr('display', (d) => (isHidden(d) ? 'none' : null));
  container
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.fold-count')
    .text(foldLabel);
}

let root: d3.HierarchyNode<QueryExecutionNode> | null = null;

export function renderQueryExecutionTree(
  queryExectionTree: QueryExecutionTree,
  zoomTo: (x: number, y: number, duration: number) => void
) {
  if (!root) {
    initializeTree(queryExectionTree);
  } else {
    updateTree(queryExectionTree, zoomTo);
  }
}

function updateTree(
  queryExecutionTree: QueryExecutionTree,
  zoomTo: (x: number, y: number, duration: number) => void
) {
  const oldNodes = root!.descendants();
  const newRoot = d3.hierarchy<QueryExecutionTree>(queryExecutionTree);
  const newNodes = newRoot.descendants();
  // NOTE: updateTree maps nodes to the previous render by index, which is only
  // valid when the tree shape is unchanged (same query, updated runtime info).
  // If the node count differs it is a different tree — rebuild from scratch
  // instead of indexing past the end of `oldNodes`.
  if (newNodes.length !== oldNodes.length) {
    clearQueryExecutionTree();
    initializeTree(queryExecutionTree);
    return;
  }
  d3.zip(newNodes, oldNodes).forEach(([newNode, oldNode]) => {
    newNode.data.id = oldNode.data.id;
    newNode.x = oldNode.x;
    newNode.y = oldNode.y;
  });
  root = newRoot;
  const topNode = findActiveNode(root);
  if (topNode === undefined) return;
  if (autoZoom && zoomTimeout == null) {
    const zoomTarget = visibleStandIn(topNode);
    zoomTo(zoomTarget.x!, zoomTarget.y! + height / 4 - boxHeight - boxMargin, 500);
  }
  const [activeNodes, inactiveNodes] = activeSubTree(topNode);
  const changedInactiveNodes = inactiveNodes.filter((node) => {
    const prevStatus = oldNodes[node.data.id!].data.status;
    return node.data.status !== prevStatus;
  });
  const nodesToUpdate = [...activeNodes, ...changedInactiveNodes];

  const container = d3.select('#treeContainer');

  const updateNodeSelection = container
    .selectAll<SVGGElement, d3.HierarchyNode<QueryExecutionTree>>('.node')
    .data(nodesToUpdate, (d) => d.data.id!);

  updateNodeSelection
    .selectAll('rect.body-left-border')
    .data((d) => [d])
    .style('--body-fill-light', (d) => colorScaleLight(d.data.operation_time))
    .style('--body-fill-dark', (d) => colorScaleDark(d.data.operation_time));

  updateNodeSelection
    .selectAll('text.size')
    .data((d) => [d])
    .text((d) => `${d.data.result_rows.toLocaleString('en-US')} x ${d.data.result_cols}`);

  updateNodeSelection
    .selectAll('text.time')
    .data((d) => [d])
    .text(
      (d) =>
        `${Math.max(d.data.operation_time, d.data.original_operation_time).toLocaleString('en-US')}ms`
    );

  updateNodeSelection
    .selectAll<SVGGElement, d3.HierarchyNode<QueryExecutionTree>>('g.status-badge')
    .data((d) => [d])
    .each(function(d) {
      renderStatusBadge(this, d.data.status);
    });

  const activeIds = new Set(activeNodes.map((n) => n.data.id));
  container
    .selectAll<SVGRectElement, d3.HierarchyNode<QueryExecutionNode>>('rect.glow-overlay')
    .attr('opacity', (d) => (activeIds.has(d.data.id) ? 1 : 0));

  // NOTE: link glow
  container
    .selectAll<SVGPathElement, d3.HierarchyNode<QueryExecutionTree>>('path.glow')
    .data(
      activeNodes.filter((node) =>
        node.parent ? node.data.status === 'lazily materialized in progress' : false
      ),
      (d) => d.data.id!
    )
    .join('path')
    .attr('class', 'glow stroke-2 fill-none')
    .attr('stroke', 'url(#glowGradientLine)')
    .attr('filter', 'url(#glow)')
    .attr('d', (d) => {
      const [px, py] = [d.parent!.x!, d.parent!.y!];
      const [cx, cy] = [d.x!, d.y!];

      return line([
        [px, py + boxHeight / 2 + 2],
        [px, py + boxHeight / 2 + boxMargin / 2 + boxPadding / 2],
        [px + (cx - px) / 2, py + boxHeight / 2 + boxMargin / 2 + boxPadding / 2],
        [cx, py + boxHeight / 2 + boxMargin / 2 + boxPadding / 2],
        [cx, cy - boxHeight / 2 - 2],
      ])!;
    });

  applyFoldVisibility();

  const selectedId = getSelectedId();
  if (selectedId != null && nodesToUpdate.some((n) => n.data.id === selectedId)) {
    refreshSelectedNode(queryExecutionTree);
  }
}

function initializeTree(queryExectionTree: QueryExecutionNode) {
  root = d3.hierarchy<QueryExecutionTree>(queryExectionTree);
  const nodes = root.descendants();
  nodes.forEach((node, i) => {
    node.data.id = i;
  });

  const container = d3
    .select('#queryExecutionTreeSvg')
    .select<SVGGElement>('g')
    .append('g')
    .attr('id', 'treeContainer');

  // NOTE: shared clip path so the left-border accent follows the body's rounded corners
  const svg = d3.select<SVGSVGElement, unknown>('#queryExecutionTreeSvg');
  if (svg.select('#bodyClip').empty()) {
    svg
      .append('defs')
      .append('clipPath')
      .attr('id', 'bodyClip')
      .append('rect')
      .attr('x', -boxWidth / 2)
      .attr('y', -boxHeight / 2)
      .attr('width', boxWidth)
      .attr('height', boxHeight)
      .attr('rx', boxRadius)
      .attr('ry', boxRadius);
  }

  treeLayout(root);

  // NOTE: draw links between nodes
  const nodesWithParents = nodes.filter((node) => node.data.id !== root!.data.id);
  container
    .selectAll<SVGPathElement, d3.HierarchyNode<QueryExecutionTree>>('path.link')
    .data(nodesWithParents, (d) => d.data.id!)
    .join('path')
    .attr('class', 'link stroke-neutral-400 dark:stroke-neutral-600 stroke fill-none')
    .attr('d', (d) => {
      const [px, py] = [d.parent!.x!, d.parent!.y!];
      const [cx, cy] = [d.x!, d.y!];

      return line([
        [px, py + boxHeight / 2],
        [px, py + boxHeight / 2 + boxMargin / 2 + boxPadding / 2],
        [px + (cx - px) / 2, py + boxHeight / 2 + boxMargin / 2 + boxPadding / 2],
        [cx, py + boxHeight / 2 + boxMargin / 2 + boxPadding / 2],
        [cx, cy - boxHeight / 2],
      ])!;
    });

  // NOTE: bind data to dom nodes
  const node_selection = container
    .selectAll<SVGGElement, d3.HierarchyNode<QueryExecutionTree>>('.node')
    .data(nodes, (d) => d.data.id!)
    .join('g')
    .attr('class', 'node cursor-pointer')
    .attr('transform', (d) => {
      const [x, y] = [d.x!, d.y!];
      return `translate(${x},${y})`;
    });

  // NOTE: draw a rectangle for each node
  node_selection
    .selectAll<SVGRectElement, unknown>('rect.body')
    .data((d) => [d])
    .join('rect')
    .attr('x', -boxWidth / 2)
    .attr('y', -boxHeight / 2)
    .attr('rx', boxRadius)
    .attr('ry', boxRadius)
    .attr('width', boxWidth)
    .attr('height', boxHeight)
    .attr(
      'class',
      'body stroke-0.5 stroke-neutral-200 dark:stroke-neutral-700 fill-white dark:fill-zinc-800'
    );

  // NOTE: left border accent, clipped to the body's rounded-rect shape so its corners match.
  // Encodes operation_time (previously encoded by the body fill).
  node_selection
    .selectAll<SVGRectElement, unknown>('rect.body-left-border')
    .data((d) => [d])
    .join('rect')
    .attr(
      'class',
      'body-left-border fill-[var(--body-fill-light)] dark:fill-[var(--body-fill-dark)]'
    )
    .attr('x', -boxWidth / 2)
    .attr('y', -boxHeight / 2)
    .attr('width', 5)
    .attr('height', boxHeight)
    .attr('clip-path', 'url(#bodyClip)')
    .style('--body-fill-light', (d) => colorScaleLight(d.data.operation_time))
    .style('--body-fill-dark', (d) => colorScaleDark(d.data.operation_time));

  // NOTE: animated gradient overlay drawn on top of the body border for active nodes
  node_selection
    .selectAll<SVGRectElement, unknown>('rect.glow-overlay')
    .data((d) => [d])
    .join('rect')
    .attr('class', 'glow-overlay fill-none stroke pointer-events-none')
    .attr('x', -boxWidth / 2)
    .attr('y', -boxHeight / 2)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('width', boxWidth)
    .attr('height', boxHeight)
    .attr('stroke', 'url(#glowGradientRect)')
    .attr('filter', 'url(#glow)')
    .attr('opacity', 0);

  // NOTE: selection outline (hidden until node is clicked)
  node_selection
    .selectAll<SVGRectElement, unknown>('rect.selection-outline')
    .data((d) => [d])
    .join('rect')
    .attr(
      'class',
      'selection-outline fill-none stroke-blue-500 dark:stroke-blue-400 pointer-events-none'
    )
    .attr('x', -boxWidth / 2 - 4)
    .attr('y', -boxHeight / 2 - 4)
    .attr('rx', 5)
    .attr('ry', 5)
    .attr('width', boxWidth + 8)
    .attr('height', boxHeight + 8)
    .attr('stroke-width', 3)
    .attr('opacity', 0);

  // NOTE: Each node with children has a fold badge in the bottom center
  const nodesWithChildren = node_selection.filter((d) => !!d.children && d.children.length > 0);

  nodesWithChildren
    .selectAll<SVGRectElement, d3.HierarchyNode<QueryExecutionTree>>('rect.fold')
    .data((d) => [d])
    .join('rect')
    .attr('x', -15)
    .attr('y', boxHeight / 2 - 8)
    .attr('rx', 10)
    .attr('ry', 10)
    .attr('width', 30)
    .attr('height', 20)
    .attr(
      'class',
      'fold stroke-0.5 stroke-neutral-200 dark:stroke-neutral-500 fill-white dark:fill-zinc-800'
    );

  nodesWithChildren
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.fold-count')
    .data((d) => [d])
    .join('text')
    .attr('class', 'fold-count fill-black dark:fill-neutral-300 text-xs ')
    .attr('x', 0)
    .attr('y', boxHeight / 2 + 4)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .text(foldLabel);

  // NOTE: clicking the fold badge folds/unfolds the subtree
  nodesWithChildren
    .selectAll<SVGElement, d3.HierarchyNode<QueryExecutionTree>>('rect.fold, text.fold-count')
    .on('click', (event: MouseEvent, d) => {
      event.stopPropagation();
      const id = d.data.id!;
      if (collapsedIds.has(id)) {
        collapsedIds.delete(id);
      } else {
        collapsedIds.add(id);
      }
      applyFoldVisibility();
    });

  // NOTE: click selects the node and shows details panel
  node_selection.on('click', (event, d) => {
    if (event.target instanceof SVGTextElement) return;
    event.stopPropagation();
    selectNode(d.data.id!);
    showNodeDetails(d.data);
  });

  // NOTE: Title
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.title')
    .data((d) => [d])
    .join('text')
    .attr('class', 'title fill-black dark:fill-neutral-300 font-bold cursor-text select-text')
    .attr('x', -boxWidth / 2 + 20)
    .attr('y', -boxHeight / 2 + boxPadding)
    .attr('text-anchor', 'left')
    .attr('dominant-baseline', 'middle')
    .each(function(d) {
      // NOTE: reserve room on the right so long titles don't run under the status badge
      fitText(this, replaceIRIs(splitDescription(d.data.description).title), boxWidth - 20 - 90);
    });

  // NOTE: subtitle (operation detail, e.g. a filter expression), muted, no background
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.subtitle')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'subtitle fill-neutral-500 dark:fill-neutral-500 text-xs cursor-text select-text'
    )
    .attr('x', -boxWidth / 2 + 20)
    .attr('y', -boxHeight / 2 + boxPadding + 16)
    .attr('text-anchor', 'left')
    .attr('dominant-baseline', 'middle')
    .each(function(d) {
      const { subtitle } = splitDescription(d.data.description);
      fitText(this, subtitle ? replaceIRIs(subtitle) : '', boxWidth - 20);
    });

  // NOTE: separator between title and body
  node_selection
    .selectAll<SVGLineElement, unknown>('line.title-separator')
    .data((d) => [d])
    .join('line')
    .attr('class', 'title-separator stroke-neutral-300 dark:stroke-neutral-700')
    .attr('x1', -boxWidth / 2 + 20)
    .attr('x2', boxWidth / 2 - 15)
    .attr('y1', -boxHeight / 2 + boxPadding + 30)
    .attr('y2', -boxHeight / 2 + boxPadding + 30);

  // NOTE:Columns
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.cols')
    .data((d) => [d])
    .join('text')
    .attr('class', 'cols fill-neutral-400 cursor-text select-text')
    .attr('x', -boxWidth / 2 + 20)
    .attr('y', -boxHeight / 2 + boxHeight * 0.5)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .each(function(d) {
      fitText(this, d.data.column_names.join(', '), boxWidth - 55);
    });

  // NOTE: Size
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.size')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'size fill-neutral-900 dark:fill-white text-md tabular-nums cursor-text select-text'
    )
    .attr('x', -boxWidth / 2 + 20)
    .attr('y', -boxHeight / 2 + boxHeight * 0.7)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text((d) => `${d.data.result_rows.toLocaleString('en-US')} x ${d.data.result_cols}`);
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.size-estimate')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'size-estimate fill-neutral-500 dark:fill-neutral-400 text-xs tabular-nums cursor-text select-text'
    )
    .attr('x', -boxWidth / 2 + 20)
    .attr('y', -boxHeight / 2 + boxHeight * 0.7 + 20)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text((d) => `~ ${d.data.estimated_size.toLocaleString('en-US')}`);

  // NOTE: Time
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.time')
    .data((d) => [d])
    .join('text')
    .attr('class', 'time fill-black dark:fill-white tabular-nums cursor-text select-text')
    .attr('x', 0)
    .attr('y', -boxHeight / 2 + boxHeight * 0.7)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text(
      (d) =>
        `${Math.max(d.data.operation_time, d.data.original_operation_time).toLocaleString('en-US')}ms`
    );
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.time-estimate')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'time-estimate text-xs  fill-neutral-500 dark:fill-neutral-400 tabular-nums cursor-text select-text'
    )
    .attr('x', 0)
    .attr('y', -boxHeight / 2 + boxHeight * 0.7 + 20)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text((d) => `~ ${d.data.estimated_operation_cost.toLocaleString('en-US')}`);

  // NOTE: status badge, top-right corner
  const statusBadgeGroups = node_selection
    .selectAll<SVGGElement, unknown>('g.status-badge')
    .data((d) => [d])
    .join('g')
    .attr('class', 'status-badge');

  statusBadgeGroups
    .selectAll<SVGRectElement, unknown>('rect')
    .data((d) => [d])
    .join('rect')
    .attr('y', -boxHeight / 2 + 10)
    .attr('height', statusBadgeHeight)
    .attr('rx', statusBadgeHeight / 2)
    .attr('ry', statusBadgeHeight / 2);

  statusBadgeGroups
    .selectAll<SVGTextElement, unknown>('text')
    .data((d) => [d])
    .join('text')
    .attr('y', -boxHeight / 2 + 10 + statusBadgeHeight / 2)
    .attr('text-anchor', 'end')
    .attr('dominant-baseline', 'middle');

  statusBadgeGroups.each(function(d) {
    renderStatusBadge(this, d.data.status);
  });
}

function treeLayout(root: d3.HierarchyNode<QueryExecutionTree>) {
  const layouts: Record<number, Layout> = {};

  root.eachAfter((node) => {
    if (!node.children) {
      layouts[node.data.id!] = [[[0, boxWidth + boxMargin * 2]]];
    } else {
      const merged = node.children.map((node) => layouts[node.data.id!]).reduce(mergeLayout, []);

      const center = (merged[0][0][0] + merged[0][merged[0].length - 1][1]) / 2;
      layouts[node.data.id!] = [
        [[center - (boxWidth / 2 + boxMargin), center + boxWidth / 2 + boxMargin]],
        ...merged,
      ];
    }
  });

  root.x = 0;
  root.y = 0;
  root.eachBefore((node) => {
    if (node.children) {
      const layout = layouts[node.data.id!];
      for (const [index, child] of node.children.entries()) {
        child.x = node.x! - layout[0][0][0] + layout[1][index][0];
        child.y = node.y! + boxHeight + boxMargin * 2;
      }
    }
  });
}

type Layout = [number, number][][];

function mergeLayout(layoutLeft: Layout, layoutRight: Layout): Layout {
  if (layoutLeft.length === 0 && layoutRight.length === 0) {
    return [[[0, 0]]];
  } else if (layoutRight.length === 0) {
    return layoutLeft;
  } else if (layoutLeft.length === 0) {
    return layoutRight;
  }

  const pushRight = Math.max(
    ...d3
      .zip(layoutLeft, layoutRight)
      .map(([left, right]) => left[left.length - 1][1] - right[0][0])
  );

  layoutRight = layoutRight.map((block) =>
    block.map(([left, right]) => [left + pushRight, right + pushRight])
  );
  const mergedLayout: Layout = [];
  for (let i = 0; i < Math.max(layoutRight.length, layoutLeft.length); i++) {
    if (layoutLeft[i] && layoutRight[i]) {
      mergedLayout.push(layoutLeft[i].concat(layoutRight[i]));
    } else if (layoutLeft[i]) {
      mergedLayout.push(layoutLeft[i]);
    } else if (layoutRight[i]) {
      mergedLayout.push(layoutRight[i]);
    }
  }

  return mergedLayout;
}

export function clearQueryExecutionTree() {
  root = null;
  collapsedIds.clear();
  hideNodeDetails();
  d3.select('#treeContainer').remove();
}

export function selectNode(id: number | null) {
  d3.selectAll<SVGRectElement, d3.HierarchyNode<QueryExecutionNode>>('rect.selection-outline').attr(
    'opacity',
    (d) => (d.data.id === id ? 1 : 0)
  );
}

export function deselectNode() {
  selectNode(null);
  hideNodeDetails();
}
