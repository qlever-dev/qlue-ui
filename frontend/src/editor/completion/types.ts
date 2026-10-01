// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { Range, TextEdit } from '../../types/lsp_messages';

/** `insertTextFormat` value marking an item whose text is a snippet template. */
export const SNIPPET_FORMAT = 2;

/**
 * `insertTextMode` value marking text that must be inserted verbatim.
 *
 * The server sets it on the object completions, whose suffix already carries
 * the absolute indentation it worked out from the brace nesting depth.
 */
export const AS_IS_MODE = 1;

/** `CompletionItemKind.Value`, the kind the server uses for RDF entities. */
export const VALUE_KIND = 12;

export interface CompletionItemLabelDetails {
  detail?: string;
  description?: string;
}

/**
 * The structured payload the server sends for an entity completion.
 *
 * `label`, `labelDetails` and `sortText` carry the same values as presentation;
 * this is the copy to read them back from, since `detail` and `documentation`
 * are human fields the other completion kinds use for their own purposes.
 */
export interface EntityData {
  kind: 'entity';
  label: string;
  /** The alias the search term matched, absent when it matched the label. */
  alias?: string;
  /** The absolute IRI the item's curie label stands for. */
  uri?: string;
  /** Usage count, absent when the completion query reported none. */
  score?: number;
}

/**
 * The structured payload the server sends for a literal completion.
 *
 * `value` is the lexical form alone — the item's own label carries the literal
 * as SPARQL writes it, quotes and tag included.
 */
export interface LiteralData {
  kind: 'literal';
  value: string;
  language?: string;
  /** Datatype as a curie where the backend's prefix map allowed one. */
  datatype?: string;
  /** Usage count, absent when the completion query reported none. */
  score?: number;
}

/** `CompletionItem.data`, namespaced by the server that produced it. */
export interface CompletionItemData {
  qlueLs?: EntityData | LiteralData;
}

export interface CompletionCommand {
  title: string;
  command: string;
  arguments?: unknown[];
}

export interface CompletionItem {
  label: string;
  labelDetails?: CompletionItemLabelDetails;
  kind?: number;
  detail?: string;
  documentation?: string;
  sortText?: string;
  filterText?: string;
  insertText?: string;
  textEdit?: TextEdit;
  insertTextFormat?: number;
  insertTextMode?: number;
  additionalTextEdits?: TextEdit[];
  command?: CompletionCommand;
  data?: CompletionItemData;
}

/** Values a `CompletionList` applies to every item that does not set them. */
export interface ItemDefaults {
  insertTextFormat?: number;
  insertTextMode?: number;
}

export interface CompletionList {
  isIncomplete: boolean;
  itemDefaults?: ItemDefaults;
  items: CompletionItem[];
}

/** What the widget currently displays. */
export type CompletionState =
  | { kind: 'items'; items: RenderItem[]; term: string }
  | { kind: 'pending'; term: string }
  | { kind: 'empty'; term: string }
  | { kind: 'error'; message: string; term: string };

/** How a row is laid out, which follows from what the item is. */
export type RenderContent =
  /**
   * A literal takes one line: the value has no readable-name-plus-curie split,
   * so there is nothing to put on a second one.
   */
  | {
      kind: 'literal';
      /** The value as it reads in the editor, quoted when the type is quoted. */
      value: string;
      /** The language tag or datatype trailing the value, `''` when neither. */
      suffix: string;
      /** Which of the editor's syntax colours the value takes. */
      valueKind: 'text' | 'number' | 'date';
    }
  /** An entity takes two: its name, and its curie underneath. */
  | {
      kind: 'entity';
      name: string;
      curie: string;
      /**
       * The absolute IRI the curie stands for, so the detail panel can link out
       * to the entity. `null` for a blank node, which has none.
       */
      iri: string | null;
      /** The alias the search term matched, `null` when none did. */
      alias: string | null;
    }
  /** Keywords, snippets and built-in calls: a label and a signature. */
  | { kind: 'plain'; label: string; detail: string | null };

/** A completion item plus the presentation data derived from it. */
export interface RenderItem {
  item: CompletionItem;
  content: RenderContent;
  /** Text the search term is highlighted in, and the row is found by in tests. */
  primary: string;
  /** Usage count, when the server reported one. */
  score: number | null;
  /** Range this item replaces, used to anchor the widget. */
  range: Range | null;
}
