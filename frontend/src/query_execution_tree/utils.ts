import * as d3 from 'd3';
import type { QueryExecutionNode, QueryExecutionTree } from '../types/query_execution_tree';

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

export function measureTextWidth(node: SVGTextElement, text: string): number {
  setMeasurementFont(node);
  return measurementCtx.measureText(text).width;
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
