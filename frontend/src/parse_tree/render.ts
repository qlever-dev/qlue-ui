// NOTE: Recursive DOM rendering for parse tree elements.
// Nodes render as collapsible branches, tokens as leaves.

import type { Range } from '../types/lsp_messages';
import type { ParseTreeElement } from '../types/parse_tree';
import { attachHoverHighlight, registerRow } from './highlight';

export function renderElement(element: ParseTreeElement, showSpans: boolean): HTMLElement {
  if (element.type === 'token') {
    return renderToken(element, showSpans);
  }
  return renderNode(element, showSpans);
}

function renderNode(node: ParseTreeElement & { type: 'node' }, showSpans: boolean): HTMLElement {
  const wrapper = document.createElement('div');

  const row = document.createElement('div');
  row.className =
    'flex items-center gap-1 py-px hover:bg-neutral-100 dark:hover:bg-neutral-700/50 rounded px-1 cursor-default';

  const toggle = document.createElement('span');
  toggle.className = 'w-4 text-center text-[10px] cursor-pointer select-none text-neutral-400';
  toggle.textContent = '▼';

  const kind = document.createElement('span');
  kind.className = 'text-blue-600 dark:text-blue-400';
  kind.textContent = node.kind;

  const syntaxSpan = renderTokenRange(node.range, showSpans);

  row.appendChild(toggle);
  row.appendChild(kind);
  row.appendChild(syntaxSpan);
  attachHoverHighlight(row, node.range);
  registerRow(row, node.range);

  const children = document.createElement('div');
  children.className = 'pl-4';
  for (const child of node.children) {
    children.appendChild(renderElement(child, showSpans));
  }

  row.addEventListener('click', () => {
    children.classList.toggle('hidden');
    toggle.textContent = children.classList.contains('hidden') ? '▶' : '▼';
  });

  wrapper.appendChild(row);
  wrapper.appendChild(children);
  return wrapper;
}

function renderToken(token: ParseTreeElement & { type: 'token' }, showSpans: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className =
    'flex items-center gap-1 py-px hover:bg-neutral-100 dark:hover:bg-neutral-700/50 rounded px-1 cursor-default';

  const spacer = document.createElement('span');
  spacer.className = 'w-4';

  const kind = document.createElement('span');
  kind.className = 'text-emerald-600 dark:text-emerald-400';
  kind.textContent = token.kind;

  const text = document.createElement('span');
  text.className = 'text-neutral-500 dark:text-neutral-400 truncate';
  text.innerHTML = `<pre>${token.text}</pre>`;

  const syntaxSpan = renderTokenRange(token.range, showSpans);

  row.appendChild(spacer);
  row.appendChild(kind);
  row.appendChild(text);
  row.appendChild(syntaxSpan);
  attachHoverHighlight(row, token.range);
  registerRow(row, token.range);
  return row;
}

function renderTokenRange(range: Range, showSpans: boolean): HTMLSpanElement {
  const syntaxSpan = document.createElement('span');
  syntaxSpan.className = 'text-yellow-500 dark:text-yellow-400 ms-1 parse-tree-sytax-range';
  syntaxSpan.textContent = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
  syntaxSpan.classList.toggle('hidden', !showSpans);
  return syntaxSpan;
}
