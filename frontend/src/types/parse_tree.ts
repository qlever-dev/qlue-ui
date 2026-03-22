import type { Range } from './lsp_messages';

export interface ParseTreeResult {
  tree: ParseTreeElement;
  timeMs: number;
}

export type ParseTreeElement = ParseTreeNode | ParseTreeToken;

export interface ParseTreeNode {
  type: 'node';
  kind: string;
  range: Range;
  children: ParseTreeElement[];
}

export interface ParseTreeToken {
  type: 'token';
  kind: string;
  range: Range;
  text: string;
}

export interface ParseTreeParams {
  textDocument: { uri: string };
  skipTrivia?: boolean;
}
