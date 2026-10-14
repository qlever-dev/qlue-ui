import * as d3 from 'd3';
import type {
  NodeStatus,
  QueryExecutionNode,
  QueryExecutionTree,
} from '../types/query_execution_tree';

// NOTE: the colors that encode the operation time, shared by all views.
export const colorScaleDark = d3
  .scaleSymlog<string, string>()
  .domain([1, 5000, 10000, 60000])
  .range(['#404040', '#facc15', '#dc2626', '#701a75'])
  .constant(1000)
  .interpolate(d3.interpolateHsl)
  .clamp(true);

export const colorScaleLight = d3
  .scaleSymlog<string, string>()
  .domain([1, 5000, 10000, 60000])
  .range(['white', '#eab308', '#dc2626', '#c026d3'])
  .constant(1000)
  .interpolate(d3.interpolateHsl)
  .clamp(true);

export function replaceIRIs(text: string): string {
  const iriPattern = /<([^>]+)>/g;

  return text.replace(iriPattern, (_match, iri) => {
    return shortenIRI(iri);
  });
}

function shortenIRI(iri: string): string {
  const fragmentIndex = iri.indexOf('#');
  if (fragmentIndex !== -1) {
    return `<${iri.substring(fragmentIndex + 1)}>`;
  }

  const queryIndex = iri.indexOf('?');
  const pathPart = queryIndex !== -1 ? iri.substring(0, queryIndex) : iri;

  const segments = pathPart.split('/').filter((s) => s.length > 0);

  return `<${segments.length > 0 ? segments[segments.length - 1] : ''}>`;
}

// NOTE: trims `text` with an ellipsis until it fits `maxWidth` pixels using the
// element's computed font. We measure via an offscreen 2D canvas instead of
// SVGTextContentElement.getComputedTextLength() because the latter returns 0
// while the tree's modal ancestor still has `display:none` (no layout).
const measurementCanvas = document.createElement('canvas');
const measurementCtx = measurementCanvas.getContext('2d')!;

function setMeasurementFont(node: SVGTextElement) {
  const style = window.getComputedStyle(node);
  measurementCtx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
}

export function fitText(node: SVGTextElement, text: string, maxWidth: number) {
  setMeasurementFont(node);

  if (measurementCtx.measureText(text).width <= maxWidth) {
    node.textContent = text;
    return;
  }

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measurementCtx.measureText(`${text.substring(0, mid)}…`).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  node.textContent = `${text.substring(0, lo)}…`;
}

// NOTE: QLever's description strings come in two shapes: "OpName (detail)" for
// expression-bearing ops (Filter, Bind, ...) and "OpName on/for args" for structural
// ops (Join, Index Scan, ...) with no parens. Known multi-word op names are listed
// here (longest first) so they aren't cut short by a naive first-space split.
const KNOWN_OPERATION_PREFIXES = [
  'CARTESIAN PRODUCT JOIN',
  'COUNT AVAILABLE PREDICATES',
  'HAS PREDICATE SCAN',
  'INDEXSCAN POS',
  'INDEXSCAN PSO',
  'INDEXSCAN SPO',
  'INDEXSCAN SOP',
  'INDEXSCAN OPS',
  'INDEXSCAN OSP',
  'MULTI COLUMN JOIN',
  'PATTERN TRICK',
  'SORT / ORDER BY',
  'SPATIAL JOIN',
  'TEXT LIMIT',
  'TRANSITIVE PATH',
  'GROUP BY',
  'DESCRIBE',
  'DISTINCT',
  'FILTER',
  'MINUS',
  'OPTIONAL',
  'SERVICE',
  'UNION',
  'VALUES',
  'LIMIT',
  'EXISTS',
  'BIND',
  'JOIN',
].sort((a, b) => b.length - a.length);

export function splitDescription(description: string): {
  title: string;
  subtitle: string | null;
} {
  const parenIndex = description.indexOf('(');
  if (parenIndex !== -1) {
    return {
      title: description.slice(0, parenIndex).trim(),
      subtitle: description.slice(parenIndex).trim(),
    };
  }

  const descriptionUpper = description.toUpperCase();
  const prefix = KNOWN_OPERATION_PREFIXES.find((p) => descriptionUpper.startsWith(p));
  if (prefix) {
    const rest = description.slice(prefix.length).trim();
    return { title: description.slice(0, prefix.length), subtitle: rest.length > 0 ? rest : null };
  }

  return { title: description, subtitle: null };
}

export const line = d3
  .line()
  .x((d) => d[0])
  .y((d) => d[1])
  .curve(d3.curveBundle.beta(1));

export function setupWebSocket(urlStr: string, queryId: string): WebSocket {
  const url = new URL(urlStr);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/watch/${queryId}`;
  return new WebSocket(url);
}

export function activeSubTree(
  root: d3.HierarchyNode<QueryExecutionTree>
): [d3.HierarchyNode<QueryExecutionNode>[], d3.HierarchyNode<QueryExecutionNode>[]] {
  const stack = [root];
  const active = [];
  const inactive: d3.HierarchyNode<QueryExecutionNode>[] = [];
  while (stack.length !== 0) {
    const node = stack.pop()!;
    if (
      node.data.status === 'lazily materialized in progress' ||
      node.data.status === 'fully materialized in progress'
    ) {
      active.push(node);
    } else {
      inactive.push(node);
    }
    node.children?.forEach((child) => {
      if (child.data.status === 'lazily materialized in progress') {
        stack.push(child);
      } else {
        inactive.push(...child.descendants());
      }
    });
  }
  return [active, inactive];
}

export function findActiveNode(root: d3.HierarchyNode<QueryExecutionTree>) {
  let node = root;
  while (node.children) {
    const activeChild = node.children.find(
      (c) => c.data.status === 'fully materialized in progress'
    );
    if (!activeChild) break;
    node = activeChild;
  }
  return node;
}

export const statusIndicatorRadius = 4;

// NOTE: solid dot for a settled state, hollow ring for a state caused by another
// node (a failed child) or one that hasn't happened yet
function statusIndicatorColor(status: NodeStatus): string {
  if (status.includes('completed')) return 'fill-green-500';
  if (status.includes('in progress')) return 'fill-yellow-500';
  if (status === 'failed') return 'fill-red-500';
  if (status === 'failed because child failed') return 'fill-none stroke-red-500 stroke-2';
  if (status === 'cancelled') return 'fill-neutral-500';
  if (status === 'optimized out') return 'fill-neutral-300 dark:fill-neutral-600';
  return 'fill-none stroke-neutral-400 dark:stroke-neutral-500 stroke-2';
}

// NOTE: colors the status dot (the second circle of `indicator`, shared by all
// views); running operations get a pinging halo, the first circle, behind it
export function renderStatusIndicator(indicator: SVGElement, status: NodeStatus) {
  const [ping, dot] = indicator.querySelectorAll('circle');
  const color = statusIndicatorColor(status);

  dot.setAttribute('class', color);
  ping.setAttribute(
    'class',
    status.includes('in progress')
      ? `${color} animate-ping origin-center transform-fill pointer-events-none`
      : 'hidden'
  );
}
