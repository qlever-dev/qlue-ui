// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as monaco from 'monaco-editor';
import {
  escapeRegExp,
  highlightMatches,
  matchesAllKeywords,
  parseKeywords,
} from '../../utils/fuzzy_filter';
import { type CompletionState, type RenderContent, type RenderItem, VALUE_KIND } from './types';

const MAX_HEIGHT = '15rem';

/** Width of the list column; the detail column sits beside it at its own. */
const LIST_WIDTH = '22rem';
const DETAIL_WIDTH = '19rem';

const PANEL_CLASSES = [
  'flex',
  'items-stretch',
  'rounded',
  'border',
  'border-neutral-300',
  'dark:border-neutral-700',
  'bg-white',
  'dark:bg-neutral-900',
  'text-neutral-900',
  'dark:text-neutral-100',
  'shadow-lg',
  'overflow-hidden',
  'text-sm',
];

const BAR_CLASSES = [
  'flex',
  'items-center',
  'justify-between',
  'gap-3',
  'px-2',
  'py-1',
  'text-xs',
  'text-neutral-500',
  'dark:text-neutral-400',
  'bg-neutral-100',
  'dark:bg-neutral-800',
];

const HIGHLIGHT_CLASSES = ['text-amber-600', 'dark:text-amber-400', 'font-semibold'];

/** Mono classes shared by the curie, by every literal value and by the timing. */
const MONO_CLASSES = ['truncate', 'text-xs', 'font-mono'];

const MUTED_CLASSES = ['text-neutral-500', 'dark:text-neutral-400'];

const CURIE_CLASSES = ['text-teal-700', 'dark:text-teal-300'];

// NOTE: the one cue that a row's text is an alias and not the entity's name.
// Warm, so it reads as kin to the amber the matched term is highlighted in,
// and darker than that highlight so the term still stands out inside it.
const ALIAS_CLASSES = ['text-amber-800', 'dark:text-amber-200'];

// NOTE: the editor's own syntax colours for the three literal shapes, so a
// suggestion reads the way it will read once inserted.
const VALUE_CLASSES: Record<Extract<RenderContent, { kind: 'literal' }>['valueKind'], string[]> = {
  text: ['text-orange-700', 'dark:text-orange-300'],
  number: ['text-emerald-700', 'dark:text-emerald-300'],
  date: ['text-yellow-700', 'dark:text-yellow-200'],
};

/** `CompletionItemKind` values, for the detail panel's Type field. */
const KIND_LABELS: Record<number, string> = {
  2: 'Method',
  3: 'Function',
  6: 'Variable',
  [VALUE_KIND]: 'Value',
  14: 'Keyword',
  15: 'Snippet',
};

const SPINNER_CLASSES = [
  'size-3',
  'shrink-0',
  'rounded-full',
  'border',
  'border-neutral-400',
  'dark:border-neutral-500',
  'border-t-transparent',
  'dark:border-t-transparent',
  'animate-spin',
];

function createSpinner(...extra: string[]): HTMLElement {
  const spinner = document.createElement('span');
  spinner.setAttribute('role', 'status');
  spinner.setAttribute('aria-label', 'Loading suggestions');
  spinner.classList.add(...SPINNER_CLASSES, ...extra);
  return spinner;
}

/**
 * The completion popup.
 *
 * One surface split in two columns: a list of one-line rows on the left, and a
 * panel on the right holding everything about the selected row that is not the
 * text it matched on. A row therefore never grows a second line, and the facts
 * one consults *after* finding the row — its canonical name, score, type,
 * documentation — are read in one place instead of being crammed into all of
 * them.
 *
 * Rendered as a Monaco content widget so it inherits Monaco's anchoring and
 * above/below flipping. Monaco caches the widget's measured size and only
 * invalidates that cache on `layoutContentWidget`, so every render calls it.
 */
export class CompletionWidget implements monaco.editor.IContentWidget {
  // NOTE: render outside the editor's overflow:hidden view node, matching the
  // `fixedOverflowWidgets` setting used for the other widgets.
  readonly allowEditorOverflow = true;
  // NOTE: keeps a click on a row from stealing focus from the editor.
  readonly suppressMouseDown = true;

  private readonly domNode: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly header: HTMLElement;
  private readonly headerTerm: HTMLElement;
  private readonly headerCount: HTMLElement;
  private readonly spinner: HTMLElement;
  private readonly body: HTMLElement;
  private readonly headerMeta: HTMLElement;
  private readonly timingNote: HTMLElement;
  private readonly headerSeparator: HTMLElement;
  private readonly staleNote: HTMLElement;
  private readonly detail: HTMLElement;

  private position: monaco.IPosition | null = null;
  private visible = false;
  private rows: HTMLElement[] = [];
  private items: RenderItem[] = [];

  constructor(
    private readonly editor: monaco.editor.IStandaloneCodeEditor,
    private readonly callbacks: {
      onAccept: (index: number) => void;
      onRetry: () => void;
      onOpenSettings: () => void;
    }
  ) {
    // NOTE: Monaco writes `display: block` inline on a content widget's dom
    // node, which would override a `flex` class on it. The layout therefore
    // lives on an inner panel that Monaco does not touch.
    this.domNode = document.createElement('div');
    this.domNode.dataset.testid = 'completion-widget';

    this.panel = document.createElement('div');
    this.panel.classList.add(...PANEL_CLASSES);
    this.panel.style.maxWidth = 'calc(100vw - 32px)';
    this.panel.style.maxHeight = MAX_HEIGHT;

    const list = document.createElement('div');
    list.classList.add('flex', 'flex-col', 'min-w-0', 'shrink-0');
    list.style.width = LIST_WIDTH;

    this.header = document.createElement('div');
    this.header.classList.add(...BAR_CLASSES, 'border-b', 'border-neutral-200');
    this.header.classList.add('dark:border-neutral-700');
    const status = document.createElement('span');
    status.classList.add('flex', 'items-center', 'gap-2', 'min-w-0');
    this.spinner = createSpinner();
    this.spinner.dataset.testid = 'completion-spinner';
    this.spinner.hidden = true;
    this.headerTerm = document.createElement('span');
    this.headerTerm.classList.add('truncate');
    status.append(this.spinner, this.headerTerm);
    // NOTE: the header's right half. Everything in it is toggled between
    // renders — a keystroke re-requests without re-rendering the list — so it
    // is built once and lives for the widget's lifetime.
    this.headerCount = document.createElement('span');
    this.headerCount.classList.add('tabular-nums');
    this.timingNote = document.createElement('span');
    this.timingNote.dataset.testid = 'completion-timing';
    this.timingNote.classList.add('font-mono', 'tabular-nums');
    this.timingNote.hidden = true;
    this.headerMeta = document.createElement('span');
    this.headerMeta.classList.add('flex', 'items-center', 'gap-2', 'shrink-0');
    const separator = document.createElement('span');
    separator.textContent = '·';
    separator.hidden = true;
    this.headerSeparator = separator;
    this.headerMeta.append(this.timingNote, separator, this.headerCount);
    this.staleNote = document.createElement('span');
    this.staleNote.dataset.testid = 'completion-stale';
    this.staleNote.classList.add('truncate', 'min-w-0');
    this.staleNote.hidden = true;
    this.header.append(status, this.headerMeta, this.staleNote);

    this.body = document.createElement('div');
    // NOTE: `min-h-0` lets the list shrink inside the flex column, so a long
    // list scrolls rather than growing the panel past its maximum height.
    this.body.classList.add('overflow-y-auto', 'overflow-x-hidden', 'flex-1', 'min-h-0');
    this.body.setAttribute('role', 'listbox');

    this.detail = document.createElement('div');
    this.detail.dataset.testid = 'completion-detail';
    this.detail.classList.add(
      'flex',
      'flex-col',
      'gap-2',
      'shrink-0',
      'min-w-0',
      'px-3',
      'py-2',
      'overflow-y-auto',
      'border-l',
      'border-neutral-200',
      'dark:border-neutral-700',
      'bg-neutral-50',
      'dark:bg-neutral-800/40'
    );
    this.detail.style.width = DETAIL_WIDTH;
    this.detail.hidden = true;

    list.append(this.header, this.body);
    this.panel.append(list, this.detail);
    this.domNode.append(this.panel);
    editor.addContentWidget(this);
  }

  getId(): string {
    return 'qlue.completionWidget';
  }

  getDomNode(): HTMLElement {
    return this.domNode;
  }

  getPosition(): monaco.editor.IContentWidgetPosition | null {
    if (!this.visible || !this.position) return null;
    return {
      position: this.position,
      preference: [
        monaco.editor.ContentWidgetPositionPreference.BELOW,
        monaco.editor.ContentWidgetPositionPreference.ABOVE,
      ],
    };
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Shows or hides the spinner that marks a request in flight. */
  setPending(pending: boolean) {
    if (this.spinner.hidden === !pending) return;
    this.spinner.hidden = !pending;
    // NOTE: Monaco caches the widget's measured size until it is told the
    // widget changed, and the spinner is the only thing that changes outside a
    // render.
    this.editor.layoutContentWidget(this);
  }

  /**
   * Shows how long the round trip that produced the current list took.
   *
   * An entity completion goes to the endpoint, so the number is the one thing
   * that says whether a slow popup is the network or the editor.
   */
  setTiming(ms: number | null) {
    const hidden = ms === null;
    if (!hidden) this.timingNote.textContent = `${Math.round(ms).toLocaleString()} ms`;
    if (this.timingNote.hidden === hidden) return;
    this.timingNote.hidden = hidden;
    this.syncHeaderMeta();
    this.editor.layoutContentWidget(this);
  }

  /**
   * Marks the list as belonging to an older term than the one being typed.
   *
   * The rows stay in place and stay selectable — a list the user is already
   * reading must not be blanked — but they dim while the answer for the live
   * term is on its way, and the header says which term they are answering.
   */
  setStale(term: string | null) {
    const stale = term !== null;
    if (stale) {
      this.staleNote.replaceChildren('showing results for ', termElement(term));
    }
    if (this.staleNote.hidden === !stale) return;
    this.staleNote.hidden = !stale;
    // NOTE: the header is only as wide as the list column, so the timing and
    // the count stand down for the stale mark rather than being overlapped by
    // it — and neither describes the list that is on its way anyway.
    this.headerMeta.hidden = stale;
    // NOTE: opacity alone, so the rows keep their colours and stay readable;
    // the pulse is what says the list is still moving.
    this.body.classList.toggle('opacity-50', stale);
    this.body.classList.toggle('animate-pulse', stale);
    this.editor.layoutContentWidget(this);
  }

  /**
   * Updates the term in the header without rebuilding the list.
   *
   * NOTE: an entity list is re-requested on every keystroke and only re-renders
   * once the answer lands, so the header would otherwise name the term the last
   * response was for rather than the one on screen.
   */
  setTerm(term: string) {
    if (!this.applyTerm(term)) return;
    this.editor.layoutContentWidget(this);
  }

  /** Writes the header term, reporting whether it changed. */
  private applyTerm(term: string): boolean {
    if (this.headerTerm.dataset.term === term) return false;
    this.headerTerm.dataset.term = term;
    this.headerTerm.replaceChildren();
    if (!term) {
      this.headerTerm.textContent = 'Suggestions';
      return true;
    }
    this.headerTerm.append('matching ', termElement(term));
    return true;
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.domNode.style.display = 'none';
    // NOTE: a hidden row is still in the DOM, and a dismissed list must not
    // leave one behind for anything that counts rows rather than looks at them.
    this.body.replaceChildren();
    this.rows = [];
    this.items = [];
    this.detail.replaceChildren();
    this.detail.hidden = true;
    this.spinner.hidden = true;
    this.setStale(null);
    this.setTiming(null);
    this.applyTerm('');
    this.editor.layoutContentWidget(this);
  }

  /** Renders `state` at `position` and makes the widget visible. */
  show(state: CompletionState, position: monaco.IPosition, selected: number) {
    this.position = position;
    this.visible = true;
    this.domNode.style.display = '';
    this.render(state, selected);
  }

  /** Shows the separator only when it has something on both sides of it. */
  private syncHeaderMeta() {
    this.headerSeparator.hidden = this.timingNote.hidden || !this.headerCount.textContent;
  }

  /** Moves the highlight without rebuilding the list. */
  select(index: number) {
    this.rows.forEach((row, i) => {
      setRowSelected(row, i === index);
      if (i === index) row.scrollIntoView({ block: 'nearest' });
    });
    this.body.setAttribute('aria-activedescendant', `completion-item-${index}`);
    this.renderDetail(index);
  }

  private render(state: CompletionState, selected: number) {
    this.applyTerm(state.term);
    this.body.replaceChildren();
    this.rows = [];
    this.items = state.kind === 'items' ? state.items : [];
    this.detail.replaceChildren();
    this.detail.hidden = state.kind !== 'items';
    this.headerCount.textContent = state.kind === 'items' ? String(state.items.length) : '';
    this.syncHeaderMeta();

    if (state.kind === 'items') {
      this.renderItems(state.items, state.term, selected);
      this.renderDetail(selected);
    } else if (state.kind === 'pending') {
      this.renderMessage(
        'Searching…',
        state.term ? `Looking for suggestions matching ${state.term}.` : 'Looking for suggestions.',
        createSpinner('mt-1')
      );
    } else if (state.kind === 'empty') {
      this.renderMessage(
        'Nothing matches',
        state.term
          ? `No suggestion in this position matches ${state.term}.`
          : 'No suggestion is available in this position.'
      );
    } else {
      const panel = this.renderMessage('Suggestions unavailable', state.message);
      const actions = document.createElement('div');
      actions.classList.add('flex', 'gap-3', 'mt-2');
      actions.append(
        linkButton('Try again', this.callbacks.onRetry),
        linkButton('Completion settings', this.callbacks.onOpenSettings)
      );
      panel.append(actions);
    }

    this.editor.layoutContentWidget(this);
  }

  /**
   * The list: one line per candidate.
   *
   * A row leads with the string the term will highlight in: the label, or the
   * alias where the label is not it. The highlight is therefore always in view
   * and no row has to carry both strings. An alias is tinted warm, which is
   * the only cue that the text is not the entity's canonical name; that name
   * is in the panel, read on selection. Two entities can therefore sit in the
   * list under near-identical text, told apart by their curies.
   */
  private renderItems(items: RenderItem[], term: string, selected: number) {
    // NOTE: the term is source text, not a search query — `?la` would otherwise
    // be a broken regex and get dropped, leaving nothing highlighted.
    const keywords = parseKeywords(escapeRegExp(term));
    items.forEach((renderItem, index) => {
      const content = renderItem.content;
      const row = document.createElement('div');
      row.id = `completion-item-${index}`;
      row.dataset.testid = 'completion-item';
      row.setAttribute('role', 'option');
      row.classList.add(
        'flex',
        'items-baseline',
        'gap-2',
        'px-2',
        'py-0.5',
        'cursor-pointer',
        'border-l-2',
        'border-transparent'
      );

      // NOTE: the alias leads only where the label is not what the term
      // highlights in. `matchesAllKeywords` is the predicate `highlightMatches`
      // renders from, so the row cannot pick a string the highlight then fails
      // to appear in — and how the completion query matched, prefix or
      // substring or something else, is never guessed at here.
      const alias =
        content.kind === 'entity' && content.alias && !matchesAllKeywords(content.name, keywords)
          ? content.alias
          : null;

      const primary = document.createElement('span');
      // NOTE: the text gives way down to a floor that still shows a few
      // characters, and the curie never shrinks at all, because it is what
      // will be inserted.
      primary.classList.add('flex-1', 'min-w-[82px]', 'truncate');
      if (content.kind === 'literal') {
        primary.classList.add('font-mono', ...VALUE_CLASSES[content.valueKind]);
      } else if (alias) {
        primary.classList.add(...ALIAS_CLASSES);
      }
      primary.innerHTML = highlightMatches(
        alias ?? primaryText(content),
        keywords,
        HIGHLIGHT_CLASSES
      );
      row.append(primary);

      const trailing = trailingText(content);
      if (trailing) {
        const tail = document.createElement('span');
        tail.classList.add('shrink-0', 'text-xs', 'font-mono');
        tail.classList.add(...(content.kind === 'plain' ? SIGNATURE_CLASSES : CURIE_CLASSES));
        tail.textContent = trailing;
        row.append(tail);
      }

      setRowSelected(row, index === selected);
      row.addEventListener('click', () => this.callbacks.onAccept(index));
      this.body.append(row);
      this.rows.push(row);
    });
    this.body.setAttribute('aria-activedescendant', `completion-item-${selected}`);
    this.rows[selected]?.scrollIntoView({ block: 'nearest' });
  }

  /**
   * The panel beside the list, describing the selected row alone.
   *
   * Every field is omitted when the server did not send it, so the panel says
   * what is known and never states a placeholder — an entity list carries a
   * score, a keyword carries documentation, and neither carries both.
   */
  private renderDetail(index: number) {
    const renderItem = this.items[index];
    if (!renderItem) {
      this.detail.replaceChildren();
      return;
    }
    const content = renderItem.content;

    const title = document.createElement('div');
    title.classList.add('font-semibold', 'leading-tight', 'break-words');
    title.textContent = primaryText(content);
    this.detail.replaceChildren(title);

    // NOTE: `detail` is the server's one line gloss ("Group the results"); the
    // signature the row already trails lives in `labelDetails` and is not
    // repeated here.
    if (renderItem.item.detail) {
      const summary = document.createElement('div');
      summary.classList.add('text-xs', '-mt-1', ...MUTED_CLASSES);
      summary.textContent = renderItem.item.detail;
      this.detail.append(summary);
    }

    if (content.kind === 'entity') {
      this.detail.append(identityLine(content));
    }

    const fields = document.createElement('div');
    fields.classList.add('flex', 'flex-col', 'gap-1', 'text-xs');
    if (renderItem.score !== null) {
      fields.append(field('Score', monoValue(renderItem.score.toLocaleString())));
    }
    const type = typeLabel(renderItem);
    if (type) fields.append(field('Type', plainValue(type)));
    // NOTE: stated whenever the server sent one, and stated as nothing more
    // than the entity's alias — whether the row led with it or with the label
    // is the row's business, not something the panel can claim.
    if (content.kind === 'entity' && content.alias) {
      fields.append(field('Alias', aliasValue(content.alias)));
    }
    if (fields.childElementCount > 0) this.detail.append(fields);

    const documentation = renderItem.item.documentation;
    if (documentation) {
      const doc = document.createElement('div');
      doc.classList.add(
        'text-xs',
        'leading-relaxed',
        'pt-2',
        'border-t',
        'border-neutral-200',
        'dark:border-neutral-700',
        ...MUTED_CLASSES
      );
      doc.textContent = documentation;
      this.detail.append(doc);
    }
  }

  private renderMessage(title: string, message: string, icon?: HTMLElement): HTMLElement {
    const panel = document.createElement('div');
    panel.classList.add('px-3', 'py-3');
    const heading = document.createElement('div');
    heading.classList.add('font-semibold');
    heading.textContent = title;
    const body = document.createElement('div');
    body.classList.add('text-xs', 'text-neutral-500', 'dark:text-neutral-400', 'mt-1');
    body.textContent = message;
    if (icon) {
      // NOTE: the icon sits beside the text as a whole, so the heading and the
      // body go in a column of their own rather than side by side with it.
      const text = document.createElement('div');
      text.classList.add('min-w-0');
      text.append(heading, body);
      const row = document.createElement('div');
      row.classList.add('flex', 'items-start', 'gap-2');
      row.append(icon, text);
      panel.append(row);
    } else {
      panel.append(heading, body);
    }
    this.body.append(panel);
    return panel;
  }

  dispose() {
    this.editor.removeContentWidget(this);
  }
}

const SIGNATURE_CLASSES = ['text-sky-700', 'dark:text-sky-400'];

/**
 * An item's canonical text, which for an entity found by an alias is not the
 * text its row displayed.
 */
function primaryText(content: RenderContent): string {
  if (content.kind === 'literal') return content.value;
  if (content.kind === 'entity') return content.name;
  return content.label;
}

/** What trails the name on a row: the curie, the literal's tag, a signature. */
function trailingText(content: RenderContent): string {
  if (content.kind === 'literal') return content.suffix;
  if (content.kind === 'entity') return content.curie;
  return content.detail ?? '';
}

/**
 * The Type field: what the completion is, in the terms the server describes it.
 *
 * A literal's type is its datatype or language tag — the thing that decides how
 * it is written — rather than the word "literal", which every one of them is.
 */
function typeLabel(renderItem: RenderItem): string | null {
  const content = renderItem.content;
  if (content.kind === 'entity') return 'Entity';
  if (content.kind === 'literal') return content.suffix.replace('^^', '') || 'Literal';
  // NOTE: the keyword completions carry no kind at all, and naming them
  // something generic would say less than saying nothing.
  const kind = renderItem.item.kind;
  return kind === undefined ? null : (KIND_LABELS[kind] ?? null);
}

/**
 * The entity's curie, linking out to the IRI it stands for.
 *
 * The IRI itself is what identifies the entity, but it is long and the curie is
 * what the query will read, so the curie is the text and the IRI is where it
 * goes — and the title attribute, for anyone who wants to see it without
 * leaving the page. A blank node has no IRI, so it is plain text: there is
 * nowhere for it to lead.
 */
function identityLine(content: Extract<RenderContent, { kind: 'entity' }>): HTMLElement {
  const classes = ['text-xs', 'font-mono', 'break-all', ...CURIE_CLASSES];
  if (!content.iri) {
    const curie = document.createElement('div');
    curie.classList.add(...classes);
    curie.textContent = content.curie;
    return curie;
  }
  const link = document.createElement('a');
  link.dataset.testid = 'completion-detail-iri';
  link.classList.add(...classes, 'hover:underline', 'cursor-pointer');
  link.href = content.iri;
  link.title = content.iri;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = content.curie;
  return link;
}

function field(label: string, value: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.classList.add('flex', 'items-baseline', 'gap-2');
  const name = document.createElement('span');
  name.classList.add('w-12', 'shrink-0', ...MUTED_CLASSES);
  name.textContent = label;
  row.append(name, value);
  return row;
}

function monoValue(text: string): HTMLElement {
  const value = document.createElement('span');
  value.classList.add(...MONO_CLASSES, 'tabular-nums');
  value.textContent = text;
  return value;
}

function plainValue(text: string): HTMLElement {
  const value = document.createElement('span');
  value.classList.add('min-w-0', 'truncate');
  value.textContent = text;
  return value;
}

/**
 * The Alias field's value, in the tint a row gives an alias it leads with.
 *
 * It wraps over as many lines as it needs rather than truncating: the panel is
 * where you come when the row cut the alias short.
 */
function aliasValue(alias: string): HTMLElement {
  const value = document.createElement('span');
  value.classList.add('min-w-0', 'break-words', ...ALIAS_CLASSES);
  value.textContent = alias;
  return value;
}

/**
 * A search term, in the amber the rows highlight it in — so the header names
 * the same thing the rows are marking.
 */
function termElement(term: string): HTMLElement {
  const value = document.createElement('span');
  value.classList.add('font-mono', 'text-amber-600', 'dark:text-amber-400');
  value.textContent = term;
  return value;
}

function setRowSelected(row: HTMLElement, selected: boolean) {
  row.classList.toggle('bg-neutral-100', selected);
  row.classList.toggle('dark:bg-neutral-800', selected);
  row.classList.toggle('border-sky-500', selected);
  row.classList.toggle('border-transparent', !selected);
  row.setAttribute('aria-selected', String(selected));
}

function linkButton(label: string, onClick: () => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add(
    'text-xs',
    'text-sky-700',
    'dark:text-sky-400',
    'hover:underline',
    'cursor-pointer'
  );
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}
