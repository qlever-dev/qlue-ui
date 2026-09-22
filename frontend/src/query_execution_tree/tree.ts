import * as d3 from 'd3';
import type { QueryExecutionNode, QueryExecutionTree } from '../types/query_execution_tree';
import {
  getSelectedId,
  hideNodeDetails,
  refreshSelectedNode,
  showNodeDetails,
  showQueryDetails,
} from './details';
import { activeSubTree, findActiveNode, fitText, line, replaceIRIs } from './utils';

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
const boxHeight = 105;
const boxMargin = 30;
const boxPadding = 20;

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
    zoomTo(topNode.x!, topNode.y! + height / 4 - boxHeight - boxMargin, 500);
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
    .selectAll('rect.body')
    .data((d) => [d])
    .style('--body-fill-light', (d) => colorScaleLight(d.data.operation_time))
    .style('--body-fill-dark', (d) => colorScaleDark(d.data.operation_time));

  updateNodeSelection
    .selectAll('text.size')
    .data((d) => [d])
    .text(
      (d) =>
        `${d.data.result_rows.toLocaleString('en-US')} x ${d.data.result_cols} [~ ${d.data.estimated_size.toLocaleString('en-US')}]`
    );

  updateNodeSelection
    .selectAll('text.time')
    .data((d) => [d])
    .text(
      (d) =>
        `${Math.max(d.data.operation_time, d.data.original_operation_time).toLocaleString('en-US')}ms [~ ${d.data.estimated_operation_cost.toLocaleString('en-US')}]`
    );

  const formatStatus = (d: d3.HierarchyNode<QueryExecutionNode>) => `Status: ${d.data.status}`;
  const statusTexts = updateNodeSelection.selectAll('text.status').data((d) => [d]);
  statusTexts.text(formatStatus);

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
        [cx, py + boxHeight / 2 + boxMargin / 2 + boxPadding / 2],
        [cx, cy - boxHeight / 2 - 2],
      ])!;
    });

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

  treeLayout(root);

  // NOTE: draw links between nodes
  const nodesWithParents = nodes.filter((node) => node.data.id !== root!.data.id);
  container
    .selectAll<SVGPathElement, d3.HierarchyNode<QueryExecutionTree>>('path.link')
    .data(nodesWithParents, (d) => d.data.id!)
    .join('path')
    .attr('class', 'link stroke-black dark:stroke-white stroke fill-none')
    .attr('d', (d) => {
      const [px, py] = [d.parent!.x!, d.parent!.y!];
      const [cx, cy] = [d.x!, d.y!];

      return line([
        [px, py + boxHeight / 2],
        [px, py + boxHeight / 2 + boxMargin / 2 + boxPadding / 2],
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
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('width', boxWidth)
    .attr('height', boxHeight)
    .attr(
      'class',
      'body stroke stroke-black dark:stroke-white fill-[var(--body-fill-light)] dark:fill-[var(--body-fill-dark)]'
    )
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
    .attr('x', -boxWidth / 2 + 10)
    .attr('y', -boxHeight / 2 + boxPadding)
    .attr('text-anchor', 'left')
    .attr('dominant-baseline', 'middle')
    .each(function (d) {
      fitText(this, replaceIRIs(d.data.description), boxWidth - 20);
    });

  // NOTE:Columns
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.cols-label')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'cols-label fill-neutral-900 dark:fill-neutral-300 text-xs cursor-text select-text'
    )
    .attr('x', -boxWidth / 2 + 10)
    .attr('y', -boxHeight / 2 + boxPadding + 25)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text('Cols:');
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.cols')
    .data((d) => [d])
    .join('text')
    .attr('class', 'cols fill-neutral-900 dark:fill-neutral-300 text-xs cursor-text select-text')
    .attr('x', -boxWidth / 2 + 45)
    .attr('y', -boxHeight / 2 + boxPadding + 25)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .each(function (d) {
      fitText(this, d.data.column_names.join(', '), boxWidth - 55);
    });

  // NOTE: Size
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.size-label')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'size-label fill-neutral-900 dark:fill-neutral-300 text-xs cursor-text select-text'
    )
    .attr('x', -boxWidth / 2 + 10)
    .attr('y', -boxHeight / 2 + boxPadding + 40)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text('Size:');
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.size')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'size fill-neutral-900 dark:fill-neutral-300 text-xs tabular-nums cursor-text select-text'
    )
    .attr('x', -boxWidth / 2 + 45)
    .attr('y', -boxHeight / 2 + boxPadding + 40)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text(
      (d) =>
        `${d.data.result_rows.toLocaleString('en-US')} x ${d.data.result_cols} [~ ${d.data.estimated_size.toLocaleString('en-US')}]`
    );

  // NOTE: Time
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.time-label')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'time-label fill-neutral-900 dark:fill-neutral-300 text-xs cursor-text select-text'
    )
    .attr('x', -boxWidth / 2 + 10)
    .attr('y', -boxHeight / 2 + boxPadding + 55)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text('Time:');
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.time')
    .data((d) => [d])
    .join('text')
    .attr(
      'class',
      'time fill-neutral-900 dark:fill-neutral-300 text-xs tabular-nums cursor-text select-text'
    )
    .attr('x', -boxWidth / 2 + 45)
    .attr('y', -boxHeight / 2 + boxPadding + 55)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text(
      (d) =>
        `${Math.max(d.data.operation_time, d.data.original_operation_time).toLocaleString('en-US')}ms [~ ${d.data.estimated_operation_cost.toLocaleString('en-US')}]`
    );

  // NOTE: Status
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.status')
    .data((d) => [d])
    .join('text')
    .attr('class', 'status fill-neutral-900 dark:fill-neutral-300 text-xs cursor-text select-text')
    .attr('x', -boxWidth / 2 + 10)
    .attr('y', -boxHeight / 2 + boxPadding + 70)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text((d) => `Status: ${d.data.status}`);
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
  hideNodeDetails();
  d3.select('#treeContainer').remove();
}

/**
 * Render the tree from scratch for the given (final) runtime information and
 * keep the details panel of the selected node, if any, in sync with it.
 *
 * NOTE: `updateTree` refreshes only the nodes of the active subtree and the
 * nodes whose status changed since the previous render, and it rebuilds the
 * whole tree whenever the number of nodes changes (QLever's tree grows and
 * shrinks while a query is planned and executed). Both can leave nodes behind
 * with the values of an intermediate message; a node then shows `0ms` and
 * `in progress` although the query is long done, and no details. A rebuild
 * from the final message is therefore made when the query ends.
 */
export function rerenderQueryExecutionTree(
  queryExecutionTree: QueryExecutionTree,
  zoomTo: (x: number, y: number, duration: number) => void
) {
  const selectedId = getSelectedId();
  root = null;
  d3.select('#treeContainer').remove();
  renderQueryExecutionTree(queryExecutionTree, zoomTo);
  drawTotalBox(queryExecutionTree);
  // The ids of the nodes are their positions in the tree, so the selection
  // refers to the same node as before as long as the shape did not change.
  if (selectedId != null) {
    selectNode(selectedId);
    refreshSelectedNode(queryExecutionTree);
  }
}

/**
 * Draw the box `Summary` above the root of the tree, with the time of the
 * query planning, of the execution of the query execution tree, and their sum.
 * It has the size of the other boxes and the same distance to the root as a
 * child has to its parent. It is drawn only for the final state of the tree,
 * when the query is done. Clicking it shows the details of the query planning
 * in the details panel.
 */
function drawTotalBox(queryExecutionTree: QueryExecutionTree) {
  if (!root) return;
  const [x, y] = [root.x!, root.y! - boxHeight - boxMargin * 2];
  const container = d3.select('#treeContainer');
  container
    .append('path')
    .attr('class', 'link stroke-black dark:stroke-white stroke fill-none')
    .attr('d', line([[x, y + boxHeight / 2], [x, root.y! - boxHeight / 2]])!);
  // NOTE: unlike for the other boxes, a click on the text also opens the
  // details, because the box says so.
  const box = container
    .append('g')
    .attr('class', 'total cursor-pointer')
    .attr('transform', `translate(${x},${y})`)
    .on('click', (event) => {
      event.stopPropagation();
      selectNode(null);
      showQueryDetails(queryExecutionTree);
    });
  box
    .append('rect')
    .attr('x', -boxWidth / 2)
    .attr('y', -boxHeight / 2)
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('width', boxWidth)
    .attr('height', boxHeight)
    .attr('class', 'stroke stroke-black dark:stroke-white fill-white dark:fill-neutral-800');

  // NOTE: the title and the rows are placed exactly like in the other boxes.
  const top = -boxHeight / 2;
  const left = -boxWidth / 2 + 10;
  box
    .append('text')
    .attr('class', 'title fill-black dark:fill-neutral-300 font-bold')
    .attr('x', left)
    .attr('y', top + boxPadding)
    .attr('text-anchor', 'left')
    .attr('dominant-baseline', 'middle')
    .each(function () {
      fitText(this, 'Summary', boxWidth - 20);
    });

  // NOTE: one row per time: the label left-aligned, the number right-aligned
  // at a fixed column (with tabular digits, so that the digits line up), and
  // the unit left-aligned right after that column.
  const planning = queryExecutionTree.meta?.time_query_planning;
  const execution = queryExecutionTree.total_time;
  const rows: [string, number | undefined, boolean][] = [
    ['Planning', planning, false],
    ['Execution', execution, false],
    ['Total', planning === undefined ? undefined : planning + execution, true],
  ];
  const numberColumn = left + 130;
  const rowClasses = 'fill-neutral-900 dark:fill-neutral-300 text-xs';
  rows.forEach(([label, value, isSum], i) => {
    const rowY = top + boxPadding + 25 + i * 15;
    const classes = `${rowClasses}${isSum ? ' font-bold' : ''}`;
    box
      .append('text')
      .attr('class', classes)
      .attr('x', left)
      .attr('y', rowY)
      .attr('dominant-baseline', 'middle')
      .text(`${label}:`);
    box
      .append('text')
      .attr('class', `${classes} tabular-nums`)
      .attr('x', numberColumn)
      .attr('y', rowY)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .text(value === undefined ? 'n/a' : value.toLocaleString('en-US'));
    if (value !== undefined) {
      box
        .append('text')
        .attr('class', classes)
        .attr('x', numberColumn + 4)
        .attr('y', rowY)
        .attr('dominant-baseline', 'middle')
        .text('ms');
    }
  });
  box
    .append('text')
    .attr('class', `${rowClasses} italic opacity-70`)
    .attr('x', left)
    .attr('y', top + boxPadding + 25 + rows.length * 15)
    .attr('dominant-baseline', 'middle')
    .text('Click for details of the query planning');
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
