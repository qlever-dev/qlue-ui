// NOTE: Shared utilities for converting between LSP and Monaco editor types.

import * as monaco from 'monaco-editor';
import type { Range } from '../types/lsp_messages';

// NOTE: Convert LSP 0-based range to Monaco 1-based range.
export function toMonacoRange(range: Range): monaco.Range {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1
  );
}
