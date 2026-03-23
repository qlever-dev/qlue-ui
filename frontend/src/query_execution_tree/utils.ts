import * as d3 from 'd3';
import type { QueryExecutionNode, QueryExecutionTree } from '../types/query_execution_tree';
import { sleep } from '../utils';
import { renderQueryExecutionTree } from './tree';
import { data } from './data';

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

export function truncateText(text: string, width: number) {
  if (text.length > width) {
    return text.substring(0, width) + '…';
  }
  return text;
}

export const line = d3
  .line()
  .x((d) => d[0])
  .y((d) => d[1])
  .curve(d3.curveBasis);

export function setupWebSocket(urlStr: string, queryId: string): WebSocket {
  const url = new URL(urlStr);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = url.pathname.replace(/\/$/, '') + `/watch/${queryId}`;
  return new WebSocket(url);
}


export function activeSubTree(root: d3.HierarchyNode<QueryExecutionTree>): [d3.HierarchyNode<QueryExecutionNode>[], d3.HierarchyNode<QueryExecutionNode>[]] {
  const stack = [root];
  const active = [];
  const inactive: d3.HierarchyNode<QueryExecutionNode>[] = [];
  while (stack.length != 0) {
    const node = stack.pop()!;
    if (node.data.status === "lazily materialized in progress" || node.data.status === "fully materialized in progress") {
      active.push(node);
    } else {
      inactive.push(node);
    }
    node.children?.forEach(child => {
      if (child.data.status === "lazily materialized in progress") {
        stack.push(child);
      } else {
        inactive.push(...child.descendants())
      }
    });
  }
  return [active, inactive];
}

export function findActiveNode(root: d3.HierarchyNode<QueryExecutionTree>) {
  const preOrder: d3.HierarchyNode<QueryExecutionNode>[] = [];
  root.eachBefore((node) => preOrder.push(node));
  return preOrder.find((node) => {
    return (
      !['fully materialized completed', 'lazily materialized completed'].some(status => node.data.status == status) &&
      (
        node.children == undefined ||
        node.children.every((child) =>
          [
            'not started',
            'optimized out',
            'fully materialized completed',
            'lazily materialized completed',
            'lazily materialized in progress',
          ].some((status) => child.data.status === status))
      )
    );
  }) ?? root;
}


export async function simulateMessages(zoom_to: (x: number, y: number, duration: number) => void
) {
  await sleep(2000);
  let index = 0;
  while (true) {

    const queryExecutionTree = data[index] as QueryExecutionTree;
    renderQueryExecutionTree(queryExecutionTree, zoom_to);
    await sleep(500);
    index = (index + 1) % data.length;
    // if (index == 99) break;
  }
}
