// NOTE: Bidirectional highlighting between the parse tree panel and the Monaco editor.
// Tree → editor: hovering a tree row highlights the corresponding span in the editor.
// Editor → tree: moving the cursor highlights all tree rows whose range contains it.

import * as monaco from 'monaco-editor';
import type { Range } from '../types/lsp_messages';
import { toMonacoRange } from '../editor/utils';

let hoverDecorations: monaco.editor.IEditorDecorationsCollection | null = null;

// NOTE: Each rendered row is tracked with its LSP range for cursor highlighting.
const rowEntries: { row: HTMLElement; range: Range }[] = [];

const CURSOR_HIGHLIGHT_CLASSES = ['bg-blue-50', 'dark:bg-blue-900/30'];

function containsPosition(range: Range, pos: monaco.Position): boolean {
  // NOTE: Monaco positions are 1-based, LSP ranges are 0-based.
  const line = pos.lineNumber - 1;
  const char = pos.column - 1;
  if (line < range.start.line || line > range.end.line) return false;
  if (line === range.start.line && char < range.start.character) return false;
  if (line === range.end.line && char > range.end.character) return false;
  return true;
}

export function attachHoverHighlight(row: HTMLElement, range: Range) {
  row.addEventListener('mouseenter', () => {
    hoverDecorations?.set([
      {
        range: toMonacoRange(range),
        options: {
          className: 'parseTreeHighlight',
          isWholeLine: false,
        },
      },
    ]);
  });
  row.addEventListener('mouseleave', () => {
    hoverDecorations?.clear();
  });
}

export function registerRow(row: HTMLElement, range: Range) {
  rowEntries.push({ row, range });
}

export function highlightRowsAtCursor(position: monaco.Position) {
  for (const entry of rowEntries) {
    const active = containsPosition(entry.range, position);
    for (const cls of CURSOR_HIGHLIGHT_CLASSES) {
      entry.row.classList.toggle(cls, active);
    }
  }
}

export function initDecorations(editor: monaco.editor.IStandaloneCodeEditor) {
  hoverDecorations?.clear();
  hoverDecorations = editor.createDecorationsCollection();
  rowEntries.length = 0;
}

export function clearHighlights() {
  hoverDecorations?.clear();
  hoverDecorations = null;
  rowEntries.length = 0;
}
