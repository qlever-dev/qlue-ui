import * as d3 from 'd3';
import type { QueryExecutionNode, QueryExecutionTree } from '../types/query_execution_tree';
import { replaceIRIs, truncateText, line, findActiveNode, activeSubTree } from './utils';

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
    autoZoomButton.firstElementChild?.classList.toggle('hidden');
    autoZoomButton.children[1].classList.toggle('hidden');
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
  d3
    .zip(newNodes, oldNodes)
    .forEach(([newNode, oldNode]) => {
      newNode.data.id = oldNode.data.id;
      newNode.x = oldNode.x;
      newNode.y = oldNode.y;
    });
  root = newRoot;
  const topNode = findActiveNode(root);
  if (topNode == undefined) return;
  if (autoZoom && zoomTimeout == null) {
    zoomTo(topNode.x!, topNode.y! + height / 4 - boxHeight - boxMargin, 500);
  }
  const [activeNodes, inactiveNodes] = activeSubTree(topNode);
  const changedInactiveNodes = inactiveNodes.filter(node => {
    const prevStatus = oldNodes[node.data.id!].data.status;
    return node.data.status != prevStatus;
  })
  const nodesToUpdate = [...activeNodes, ...changedInactiveNodes];

  const container = d3.select('#treeContainer');

  const updateNodeSelection = container
    .selectAll<SVGGElement, d3.HierarchyNode<QueryExecutionTree>>('.node')
    .data(nodesToUpdate, (d) => d.data.id!);

  updateNodeSelection
    .selectAll('text.size')
    .data((d) => [d])
    .text((d) => `${d.data.result_rows.toLocaleString('en-US')} x ${d.data.result_cols}`);

  updateNodeSelection
    .selectAll('text.time')
    .data((d) => [d])
    .text(
      (d) =>
        `${Math.max(d.data.operation_time, d.data.original_operation_time).toLocaleString('en-US')}ms (${d.data.original_operation_time})`
    );

  const formatStatus = (d: d3.HierarchyNode<QueryExecutionNode>) => `Status: ${d.data.status}`;
  let statusTexts = updateNodeSelection.selectAll('text.status').data((d) => [d]);
  statusTexts.text(formatStatus);

  const highlightNodeSelection = container
    .selectAll<SVGGElement, d3.HierarchyNode<QueryExecutionTree>>('.node')
    .data(activeNodes, (d) => d.data.id!);
  const darkMode = localStorage.getItem('theme') === 'dark';
  highlightNodeSelection
    .selectAll('rect')
    .data((d) => [d])
    .attr('class', 'stroke-2')
    .attr('fill', (d) =>
      darkMode ? colorScaleDark(d.data.operation_time) : colorScaleLight(d.data.operation_time)
    )
    .attr('stroke', 'url(#glowGradientRect)')
    .attr('filter', 'url(#glow)');

  highlightNodeSelection
    .exit()
    .selectAll('rect')
    .data((d) => [d])
    .attr('class', 'stroke-neutral-400 dark:stroke-neutral-500 stroke-2')
    .attr('stroke', '')
    .attr('filter', '');

  // NOTE: link glow
  container
    .selectAll<SVGPathElement, d3.HierarchyNode<QueryExecutionTree>>('path.glow')
    .data(
      activeNodes.filter((node) =>
        node.parent ? node.data.status == 'lazily materialized in progress' : false
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
        [px, py + boxHeight / 2 + boxMargin / 2],
        [cx, cy - boxHeight / 2 - boxMargin],
        [cx, cy - boxHeight / 2 - 2],
      ])!;
    });
}

function initializeTree(queryExectionTree: QueryExecutionNode) {
  root = d3.hierarchy<QueryExecutionTree>(queryExectionTree);
  const nodes = root.descendants();
  nodes.forEach((node, i) => (node.data.id = i));

  const container = d3
    .select('#queryExecutionTreeSvg')
    .select<SVGGElement>('g')
    .append('g')
    .attr('id', 'treeContainer');

  treeLayout(root);

  // NOTE: draw links between nodes
  const nodesWithParents = nodes.filter((node) => node.data.id != root!.data.id);
  container
    .selectAll<SVGPathElement, d3.HierarchyNode<QueryExecutionTree>>('path.link')
    .data(nodesWithParents, (d) => d.data.id!)
    .join('path')
    .attr('class', 'link stroke-neutral-400 dark:stroke-neutral-500 stroke-2 fill-none')
    .attr('d', (d) => {
      const [px, py] = [d.parent!.x!, d.parent!.y!];
      const [cx, cy] = [d.x!, d.y!];

      return line([
        [px, py + boxHeight / 2],
        [px, py + boxHeight / 2 + boxMargin / 2],
        [cx, cy - boxHeight / 2 - boxMargin],
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
  const darkMode = localStorage.getItem('theme') === 'dark';
  node_selection
    .selectAll<SVGRectElement, unknown>('rect')
    .data((d) => [d])
    .join('rect')
    .attr('x', -boxWidth / 2)
    .attr('y', -boxHeight / 2)
    .attr('rx', 8)
    .attr('ry', 8)
    .attr('width', boxWidth)
    .attr('height', boxHeight)
    .attr('class', 'stroke-2 stroke-neutral-400 dark:stroke-neutral-500')
    .attr('fill', (d) =>
      darkMode ? colorScaleDark(d.data.operation_time) : colorScaleLight(d.data.operation_time)
    );

  // NOTE: Title
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.title')
    .data((d) => [d])
    .join('text')
    .attr('class', 'title fill-neutral-500 dark:fill-neutral-300 font-bold text-xs')
    .attr('x', 0)
    .attr('y', -boxHeight / 2 + boxPadding)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'middle')
    .text((d) => truncateText(replaceIRIs(d.data.description), 40));

  // NOTE:Columns
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.cols-label')
    .data((d) => [d])
    .join('text')
    .attr('class', 'cols-label fill-neutral-700 dark:fill-neutral-300 text-xs')
    .attr('x', -boxWidth / 2 + 10)
    .attr('y', -boxHeight / 2 + boxPadding + 25)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text('Cols:');
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.cols')
    .data((d) => [d])
    .join('text')
    .attr('class', 'cols fill-neutral-700 dark:fill-neutral-300 text-xs')
    .attr('x', -boxWidth / 2 + 45)
    .attr('y', -boxHeight / 2 + boxPadding + 25)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text((d) => truncateText(`${d.data.column_names.join(', ')}`, 40));

  // NOTE: Size
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.size-label')
    .data((d) => [d])
    .join('text')
    .attr('class', 'size-label fill-neutral-700 dark:fill-neutral-300 text-xs')
    .attr('x', -boxWidth / 2 + 10)
    .attr('y', -boxHeight / 2 + boxPadding + 40)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text('Size:');
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.size')
    .data((d) => [d])
    .join('text')
    .attr('class', 'size fill-neutral-700 dark:fill-neutral-300 text-xs')
    .attr('x', -boxWidth / 2 + 45)
    .attr('y', -boxHeight / 2 + boxPadding + 40)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text((d) => `${d.data.result_rows.toLocaleString('en-US')} x ${d.data.result_cols}`);

  // NOTE: Time
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.time-label')
    .data((d) => [d])
    .join('text')
    .attr('class', 'time-label fill-neutral-700 dark:fill-neutral-300 text-xs')
    .attr('x', -boxWidth / 2 + 10)
    .attr('y', -boxHeight / 2 + boxPadding + 55)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text('Time:');
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.time')
    .data((d) => [d])
    .join('text')
    .attr('class', 'time fill-neutral-700 dark:fill-neutral-300 text-xs')
    .attr('x', -boxWidth / 2 + 45)
    .attr('y', -boxHeight / 2 + boxPadding + 55)
    .attr('text-anchor', 'start')
    .attr('dominant-baseline', 'middle')
    .text(
      (d) =>
        `${Math.max(d.data.operation_time, d.data.original_operation_time).toLocaleString('en-US')}ms (${d.data.original_operation_time})`
    );

  // NOTE: Status
  node_selection
    .selectAll<SVGTextElement, d3.HierarchyNode<QueryExecutionTree>>('text.status')
    .data((d) => [d])
    .join('text')
    .attr('class', 'status fill-neutral-700 dark:fill-neutral-300 text-xs')
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
      layouts[node.data.id!] = [[0, boxWidth + boxMargin * 2]];
    } else {
      const merged = node.children.map((node) => layouts[node.data.id!]).reduce(mergeLayout, []);
      const center = (merged[0][0] + merged[0][1]) / 2;
      layouts[node.data.id!] = [
        [center - (boxWidth / 2 + boxMargin), center + boxWidth / 2 + boxMargin],
        ...merged,
      ];
    }
  });

  root.x = 0;
  root.y = 0;
  root.eachBefore((node) => {
    if (node.children) {
      const spanWidth = layouts[node.data.id!][1][1] - layouts[node.data.id!][1][0];

      if (node.children.length >= 1) {
        node.children[0].x = node.x! - spanWidth / 2 + boxWidth / 2 + boxMargin;
        node.children[0].y = node.y! + boxHeight + boxMargin * 2;
      }
      if (node.children.length == 2) {
        node.children[1].x = node.x! + spanWidth / 2 - (boxWidth / 2 + boxMargin);
        node.children[1].y = node.y! + boxHeight + boxMargin * 2;
      }
    }
  });
}

type Layout = [number, number][];

function mergeLayout(layoutLeft: Layout, layoutRight: Layout): Layout {
  if (layoutLeft.length == 0 && layoutRight.length == 0) {
    return [[0, 1]];
  } else if (layoutRight.length == 0) {
    return layoutLeft;
  } else if (layoutLeft.length == 0) {
    return layoutRight;
  }
  const pushRight = Math.max(
    ...d3.zip(layoutLeft, layoutRight).map(([left, right]) => left[1] - right[0])
  );

  layoutRight = layoutRight.map(([left, right]) => [left + pushRight, right + pushRight]);

  const mergedLayout: Layout = [];
  for (let i = 0; i < Math.max(layoutRight.length, layoutLeft.length); i++) {
    if (layoutLeft[i] && layoutRight[i]) {
      mergedLayout.push([layoutLeft[i][0], layoutRight[i][1]]);
    } else if (layoutLeft[i]) {
      mergedLayout.push(layoutLeft[i]);
    } else if (layoutRight[i]) {
      mergedLayout.push([layoutRight[i][0], layoutRight[i][1]]);
    }
  }

  return mergedLayout;
}

export function clearQueryExecutionTree() {
  root = null;
  d3.select('#treeContainer').remove();
}
