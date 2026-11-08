// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as monaco from 'monaco-editor';
import { openSettings } from '../../settings/utils';
import type { Range } from '../../types/lsp_messages';
import type { Editor } from '../init';
import { toMonacoRange } from '../utils';
import { Trace, trace } from './trace';
import {
  AS_IS_MODE,
  type CompletionItem,
  type CompletionList,
  type CompletionState,
  type EntityData,
  type LiteralData,
  type RenderContent,
  type RenderItem,
  SNIPPET_FORMAT,
  VALUE_KIND,
} from './types';
import { CompletionWidget } from './widget';

/** JSON-RPC error code for a request the client itself cancelled. */
const REQUEST_CANCELLED = -32800;
const DEBOUNCE_MS = 200;
/**
 * How long a request may run with nothing on screen before the popup opens on
 * a "Searching…" panel.
 *
 * An entity completion goes to the endpoint and can take seconds, which is a
 * long time to type into silence. The grace period keeps the panel out of the
 * way of the answers that come back promptly.
 */
const PENDING_PANEL_MS = 250;

/** The bits of Monaco's `SnippetController2` that inserting a snippet needs. */
interface SnippetController {
  apply(
    edits: { range: monaco.Range; template: string }[],
    options?: Record<string, unknown>
  ): void;
  insert(template: string, options?: Record<string, unknown>): void;
  isInSnippet(): boolean;
}

/** A completely typed SPARQL variable, e.g. `?abc` — but not a bare `?`. */
const VARIABLE_TERM = /^[?$]\w+$/;

/** LSP `CompletionTriggerKind`. */
enum TriggerKind {
  Invoked = 1,
  TriggerCharacter = 2,
}

interface Session {
  /** The term the server searched for, measured at the request position. */
  term: string;
  /** All items the server returned, in server order. */
  items: RenderItem[];
  /** Whether the server wants a fresh request on every keystroke. */
  isIncomplete: boolean;
  /** Where the popup is anchored. */
  anchor: monaco.IPosition;
  /**
   * Where the term being completed starts, when the server said so.
   *
   * NOTE: distinct from `anchor`, which falls back to the cursor at request
   * time so the popup always has somewhere to sit. That fallback is not a term
   * start — it sits *after* whatever was already typed — so it must not be
   * used for filtering or highlighting.
   */
  termStart: monaco.IPosition | undefined;
}

export class CompletionController {
  private readonly monacoEditor: monaco.editor.IStandaloneCodeEditor;
  private readonly widget: CompletionWidget;

  private triggerCharacters: string[] = [];
  private debounceHandle: number | undefined;
  private pendingPanelHandle: number | undefined;
  private tokenSource: { cancel(): void; dispose(): void; token: unknown } | undefined;
  private requestVersion = 0;
  private inFlight = 0;
  private session: Session | undefined;
  private state: CompletionState | undefined;
  private selected = 0;

  constructor(private readonly editor: Editor) {
    this.monacoEditor = editor.editorApp.getEditor()!;
    this.widget = new CompletionWidget(this.monacoEditor, {
      onAccept: (index) => this.accept(index),
      onRetry: () => this.trigger(TriggerKind.Invoked),
      onOpenSettings: () => {
        this.hide();
        openSettings();
      },
    });

    this.triggerCharacters =
      (this.editor.languageClient.initializeResult?.capabilities?.completionProvider
        ?.triggerCharacters as string[] | undefined) ?? [];

    this.monacoEditor.onDidChangeModelContent((event) => this.onContentChanged(event));
    this.monacoEditor.onDidChangeCursorPosition((event) => {
      // NOTE: typing moves the cursor too (reason NotSet); only an explicit
      // move — arrow keys outside the widget, a click — dismisses.
      if (!this.widget.isVisible()) return;
      if (event.reason === monaco.editor.CursorChangeReason.Explicit) this.hide();
    });
    this.monacoEditor.onDidBlurEditorWidget(() => this.hide());
    this.monacoEditor.onKeyDown((event) => this.onKeyDown(event));
  }

  /** Hides the widget and cancels any request in flight. */
  hide() {
    if (this.widget.isVisible() || this.debounceHandle !== undefined) trace('hide');
    window.clearTimeout(this.debounceHandle);
    this.debounceHandle = undefined;
    window.clearTimeout(this.pendingPanelHandle);
    this.pendingPanelHandle = undefined;
    this.cancelPending();
    this.session = undefined;
    this.state = undefined;
    this.widget.hide();
  }

  /** Requests completions at the current cursor position. */
  trigger(triggerKind: TriggerKind = TriggerKind.Invoked, triggerCharacter?: string) {
    trace('trigger', () => ({ triggerKind: TriggerKind[triggerKind], triggerCharacter }));
    // NOTE: the server completes inside comments too, but "# blabla select" is
    // prose — the words there are not a query being written.
    if (this.isInComment()) {
      this.hide();
      return;
    }
    window.clearTimeout(this.debounceHandle);
    this.debounceHandle = window.setTimeout(() => {
      // NOTE: cleared before the request goes out, so that the handle marks a
      // queued request and nothing else — `isRequestPending` reads it.
      this.debounceHandle = undefined;
      this.request(triggerKind, triggerCharacter);
    }, DEBOUNCE_MS);
    // NOTE: after the handle is assigned, since that is what marks the queued
    // request that `isRequestPending` reads.
    this.syncHeader();
  }

  /** Accepts the currently highlighted item. Returns false when there is none. */
  acceptSelected(): boolean {
    if (this.state?.kind !== 'items') return false;
    this.accept(this.selected);
    return true;
  }

  private onContentChanged(event: monaco.editor.IModelContentChangedEvent) {
    // NOTE: also checked here, not only in `trigger`, since an open list of a
    // complete session is filtered locally without going through it.
    if (this.isInComment()) {
      this.hide();
      return;
    }
    // NOTE: deleting back past where the list was requested destroys the very
    // thing it was computed for — the "FILTER (" whose parens the built in call
    // list belongs inside, or the term an entity search ran on. Those lists are
    // complete, so nothing would re-request them, and an empty term is a prefix
    // of everything: without this the whole list survives being backspaced away.
    if (this.session && this.isBeforeAnchor(this.session.anchor)) {
      trace('cursor moved before anchor');
      this.hide();
      return;
    }
    const change = event.changes.at(-1);
    // NOTE: a code action's edit arrives here exactly like a keystroke does,
    // and its text is not something the user is typing — "Add to result"
    // writing `?o` into the SELECT clause opened the popup on whatever the
    // cursor happened to sit on, several lines away. Only a change that lands
    // on the cursor is typing.
    if (!change || !this.isChangeAtCursor(change)) return;
    const text = change.text;
    const triggerCharacter = this.triggerCharacters.find((char) => text.endsWith(char));
    if (triggerCharacter) {
      this.trigger(TriggerKind.TriggerCharacter, triggerCharacter);
      return;
    }
    // NOTE: entity lists are always `isIncomplete`, so they are re-requested on
    // every keystroke; static lists are filtered locally instead.
    if (this.session && !this.session.isIncomplete) {
      this.renderSession();
      return;
    }
    if (this.widget.isVisible() || /[\w:?<]$/.test(text)) {
      this.trigger(TriggerKind.Invoked);
    }
  }

  private cancelPending() {
    this.tokenSource?.cancel();
    this.tokenSource?.dispose();
    this.tokenSource = undefined;
  }

  private request(triggerKind: TriggerKind, triggerCharacter?: string) {
    const model = this.monacoEditor.getModel();
    const position = this.monacoEditor.getPosition();
    if (!model || !position) return;

    this.cancelPending();
    const tokenSource = new monaco.CancellationTokenSource();
    this.tokenSource = tokenSource;
    const version = ++this.requestVersion;
    const requestTrace = Trace.start('textDocument/completion', () => ({
      version,
      line: position.lineNumber - 1,
      character: position.column - 1,
      triggerKind: TriggerKind[triggerKind],
      triggerCharacter,
      term: this.currentTerm(this.session?.termStart),
    }));

    this.inFlight++;
    this.syncHeader();
    this.schedulePendingPanel(position);
    const started = performance.now();
    this.editor.languageClient
      .sendRequest<CompletionList | CompletionItem[] | null>(
        'textDocument/completion',
        {
          textDocument: { uri: this.editor.getDocumentUri() },
          position: { line: position.lineNumber - 1, character: position.column - 1 },
          context: { triggerKind, triggerCharacter },
        },
        tokenSource.token
      )
      .then((response) => {
        this.inFlight--;
        this.syncHeader();
        requestTrace?.log('response', () => {
          const items = Array.isArray(response) ? response : (response?.items ?? []);
          return {
            count: items.length,
            isIncomplete: Array.isArray(response) ? false : response?.isIncomplete,
            stale: version !== this.requestVersion,
            items,
          };
        });
        if (version !== this.requestVersion) return;
        // NOTE: before the render, which is what puts the footer on screen.
        this.widget.setTiming(performance.now() - started);
        this.onResponse(response, position);
      })
      .catch((error: unknown) => {
        this.inFlight--;
        this.syncHeader();
        requestTrace?.log(isCancellation(error) ? 'cancelled' : 'error', () => ({ error }));
        if (version !== this.requestVersion) return;
        // NOTE: a superseded request rejects as cancelled; showing the error
        // panel for those would make it flash on every keystroke.
        if (isCancellation(error)) return;
        this.showError(error instanceof Error ? error.message : String(error));
      });
  }

  private onResponse(
    response: CompletionList | CompletionItem[] | null,
    position: monaco.IPosition
  ) {
    const list = Array.isArray(response) ? undefined : (response ?? undefined);
    const items = Array.isArray(response) ? response : (list?.items ?? []);
    const isIncomplete = list?.isIncomplete ?? false;

    if (items.length === 0) {
      this.session = undefined;
      this.render({ kind: 'empty', term: this.currentTerm() }, position);
      return;
    }

    // NOTE: the server sets `filterText` to the search term for every entity
    // item so that ordering falls back to `sortText`. Preserve that order.
    const sorted = [...items].sort((a, b) =>
      (a.sortText ?? a.label).localeCompare(b.sortText ?? b.label)
    );
    // NOTE: the built-in call completions carry their snippet format on the
    // list rather than on each item, so the defaults are folded in here and
    // every item downstream is self-describing.
    const defaults = list?.itemDefaults;
    const rendered = sorted
      .map((item) => ({
        ...item,
        insertTextFormat: item.insertTextFormat ?? defaults?.insertTextFormat,
        insertTextMode: item.insertTextMode ?? defaults?.insertTextMode,
      }))
      .map(toRenderItem);
    const termStart = termStartOf(rendered);
    const anchor = termStart ?? position;
    this.session = {
      term: this.currentTerm(termStart, position),
      items: rendered,
      isIncomplete,
      anchor,
      termStart,
    };
    this.renderSession();
  }

  /**
   * Renders the current session.
   *
   * Both kinds of list are filtered the same way — a prefix match, the rule
   * the server itself filters by — but against a different term.
   *
   * A complete list (keywords, snippets) is never re-requested, so it is
   * narrowed against the live term; that is what lets it be re-filtered on
   * later keystrokes.
   *
   * An `isIncomplete` list is re-requested on every keystroke and is already
   * narrowed by the server, so its order is kept untouched and it is matched
   * against the term the server searched for. The server sets `filterText` to
   * that very term on every entity item, so they all survive; the variable
   * items merged into the same list keep their own name there, which is what
   * drops a `?label` suggestion once the term is `Mathe`. Using the server's
   * term rather than the live one keeps the entity items from all blinking out
   * for the one round trip it takes a keystroke to come back.
   */
  private renderSession() {
    const session = this.session;
    if (!session) return;
    const term = this.currentTerm(session.termStart);
    const matchTerm = session.isIncomplete ? session.term : term;
    const items = session.items.filter((renderItem) => matchesTerm(renderItem, matchTerm));
    trace('local filter', () => ({ term, kept: items.length, of: session.items.length }));
    if (items.length === 0) {
      this.render({ kind: 'empty', term }, session.anchor);
      return;
    }
    this.render({ kind: 'items', items, term }, session.anchor);
  }

  private showError(message: string) {
    // NOTE: the server reports a failure to localize the cursor for every
    // position it has no completions for. That is not something the user can
    // act on, so it dismisses rather than raising the error panel.
    if (message.startsWith('Could not localize cursor')) {
      this.hide();
      return;
    }
    const position = this.monacoEditor.getPosition();
    if (!position) return;
    const term = this.currentTerm(this.session?.termStart);
    this.session = undefined;
    this.render({ kind: 'error', message, term }, position);
  }

  /**
   * Whether `change` landed on the cursor — the test for "the user typed this".
   *
   * NOTE: the span covers both the text the change inserted and the text it
   * replaced, so that the cursor is inside it whether it is read before or
   * after the edit moved it. Typing lands it at the far end of the insert,
   * backspacing at the near end of the deletion.
   */
  private isChangeAtCursor(change: monaco.editor.IModelContentChange): boolean {
    const model = this.monacoEditor.getModel();
    const position = this.monacoEditor.getPosition();
    if (!model || !position) return false;
    const offset = model.getOffsetAt(position);
    const span = Math.max(change.rangeLength, change.text.length);
    return offset >= change.rangeOffset && offset <= change.rangeOffset + span;
  }

  /**
   * Whether the cursor sits inside a `#` comment.
   *
   * NOTE: scanning the line is enough — a `#` opens a comment unless it is
   * inside a string literal or an IRI, and neither of those starts on an
   * earlier line. A `<` only opens an IRI when its `>` follows without a
   * space, so a `<` comparison does not swallow the rest of the line.
   */
  private isInComment(): boolean {
    const model = this.monacoEditor.getModel();
    const position = this.monacoEditor.getPosition();
    if (!model || !position) return false;
    const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    let quote: string | undefined;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (quote) {
        if (char === '\\') index++;
        else if (char === quote) quote = undefined;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '<') {
        const close = line.indexOf('>', index + 1);
        if (close !== -1 && !/[\s#<]/.test(line.slice(index + 1, close))) index = close;
      } else if (char === '#') {
        return true;
      }
    }
    return false;
  }

  /** Whether the cursor sits before `anchor`, the start of what is completed. */
  private isBeforeAnchor(anchor: monaco.IPosition): boolean {
    const position = this.monacoEditor.getPosition();
    if (!position) return false;
    if (position.lineNumber !== anchor.lineNumber) return position.lineNumber < anchor.lineNumber;
    return position.column < anchor.column;
  }

  /**
   * Mirrors the pending state and the live term onto the widget's header.
   *
   * NOTE: this is the only thing that updates between renders. An entity list
   * is `isIncomplete`, so a keystroke re-requests rather than re-renders, and
   * the header has to keep up with what is being typed on its own.
   */
  private syncHeader() {
    this.widget.setPending(this.isRequestPending());
    this.widget.setTerm(this.currentTerm(this.session?.termStart));
    this.widget.setStale(this.staleTerm());
  }

  /**
   * The term the displayed rows answer, once it is no longer the live one.
   *
   * `null` while the list is current, or while nothing is on its way that
   * could replace it — a list nobody is refreshing is not stale, it is just
   * the answer.
   */
  private staleTerm(): string | null {
    const session = this.session;
    if (!session || this.state?.kind !== 'items' || !this.isRequestPending()) return null;
    return this.currentTerm(session.termStart) === session.term ? null : session.term;
  }

  /** Whether a request is queued or waiting on the server. */
  private isRequestPending(): boolean {
    return this.debounceHandle !== undefined || this.inFlight > 0;
  }

  /**
   * Opens the popup on a "Searching…" panel if this request is still running
   * once the grace period is up and nothing has been displayed meanwhile.
   */
  private schedulePendingPanel(position: monaco.IPosition) {
    if (this.state) return;
    // NOTE: a fully typed variable has nothing to wait for -- whatever comes
    // back is dismissed rather than shown, so announcing a search for it would
    // only flash the panel on the way to nothing.
    if (VARIABLE_TERM.test(this.currentTerm())) return;
    window.clearTimeout(this.pendingPanelHandle);
    this.pendingPanelHandle = window.setTimeout(() => {
      this.pendingPanelHandle = undefined;
      if (this.state || !this.isRequestPending()) return;
      this.render({ kind: 'pending', term: this.currentTerm() }, position);
    }, PENDING_PANEL_MS);
  }

  private render(state: CompletionState, position: monaco.IPosition) {
    // NOTE: typing fast outruns the round trip, so a list can be momentarily
    // empty — the server searched a shorter term than what is on screen, or an
    // intermediate term genuinely matched nothing. Replacing the suggestions
    // with "Nothing matches" for those few frames reads as a flicker, so the
    // last list stays up until the answer that is already on its way lands.
    if (state.kind === 'empty' && this.isRequestPending() && this.state?.kind === 'items') {
      trace('empty suppressed', () => ({ term: state.term }));
      return;
    }
    // NOTE: a fully typed variable has nothing left to suggest — the only
    // candidates are the other variables in the query, and the server drops the
    // one being typed. That empty list is truthful, but "Nothing matches" reads
    // as an error for a name the user just finished writing, so it dismisses.
    // Both the server's own empty response and an empty local re-filter land
    // here, which is why the check sits in `render` rather than either caller.
    if (state.kind === 'empty' && VARIABLE_TERM.test(state.term)) {
      trace('variable dismissed', () => ({ term: state.term }));
      this.hide();
      return;
    }
    // NOTE: the panel only fills the gap before the first answer, so anything
    // that reaches the screen first cancels it.
    window.clearTimeout(this.pendingPanelHandle);
    this.pendingPanelHandle = undefined;
    this.state = state.kind === 'pending' ? undefined : state;
    this.selected = 0;
    this.widget.show(state, position, this.selected);
    // NOTE: typing can outrun the round trip, so the list that just landed may
    // already be answering an older term than what is on screen.
    this.widget.setStale(this.staleTerm());
  }

  /**
   * The text being completed, used for filtering and highlighting.
   *
   * NOTE: the term is not necessarily a word. `?a rdfs:label Algorithmen und`
   * completes on the whole label, spaces and all. So it runs from the start of
   * the range the server replaces to the cursor — the same rule Monaco's own
   * suggest widget uses. The word scan is only a fallback for before the first
   * response has arrived, when no range is known yet.
   *
   * `end` measures the term to somewhere other than the cursor. A response is
   * read with the position its request was made at, so that the term it is
   * stored under is the one the server actually searched for rather than
   * whatever has been typed since.
   */
  private currentTerm(anchor?: monaco.IPosition, end?: monaco.IPosition): string {
    const model = this.monacoEditor.getModel();
    const position = end ?? this.monacoEditor.getPosition();
    if (!model || !position) return '';
    const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
    if (anchor?.lineNumber === position.lineNumber && anchor.column <= position.column) {
      return line.slice(anchor.column - 1);
    }
    return /[\w:?<]*$/.exec(line)?.[0] ?? '';
  }

  private move(delta: number) {
    if (this.state?.kind !== 'items') return;
    const count = this.state.items.length;
    this.selected = (this.selected + delta + count) % count;
    this.widget.select(this.selected);
  }

  private accept(index: number) {
    if (this.state?.kind !== 'items') return;
    const item = this.state.items[index]?.item;
    if (!item) return;
    trace('accept', () => ({ index, item }));
    this.hide();
    this.applyItem(item);
  }

  private applyItem(item: CompletionItem) {
    const model = this.monacoEditor.getModel();
    if (!model) return;

    const range = this.replaceRange(item);
    const newText = item.textEdit?.newText ?? item.insertText ?? item.label;
    const additionalEdits = (item.additionalTextEdits ?? []).map((edit) => ({
      range: toMonacoRange(edit.range),
      text: edit.newText,
    }));

    if (item.insertTextFormat !== SNIPPET_FORMAT) {
      // NOTE: all ranges are against the current model, so one call applies the
      // PREFIX insert and the replacement together with correct offsets.
      this.monacoEditor.executeEdits('completion', [
        ...additionalEdits,
        { range, text: newText, forceMoveMarkers: true },
      ]);
      return this.runCommand(item);
    }

    // NOTE: `SnippetController2.apply` gives every edit it is handed its own
    // final tabstop, which would leave one cursor per additional edit. So the
    // additional edits are applied first and only the snippet goes through the
    // controller. A tracked decoration carries the snippet's range across that
    // first edit, which shifts it down by the inserted PREFIX line.
    const [markerId] = model.deltaDecorations([], [{ range, options: {} }]);
    if (additionalEdits.length > 0) {
      this.monacoEditor.executeEdits('completion', additionalEdits);
    }
    const snippetRange = model.getDecorationRange(markerId) ?? range;
    model.deltaDecorations([markerId], []);

    const controller = this.monacoEditor.getContribution(
      'snippetController2'
    ) as unknown as SnippetController | null;
    // NOTE: a snippet is written relative to the line it lands on, so its own
    // indentation is added to that line's -- except where the server says
    // `AsIs`, which it does for the object suffix, whose indentation it already
    // worked out from the brace nesting depth.
    const options = {
      adjustWhitespace: item.insertTextMode !== AS_IS_MODE,
      undoStopBefore: true,
      undoStopAfter: true,
    };
    if (controller?.isInSnippet() && snippetRange.startLineNumber === snippetRange.endLineNumber) {
      // NOTE: `apply` cancels a running session before inserting, which throws
      // away the tabstops of the snippet being completed into -- accepting YEAR
      // inside "BIND ($1 AS ?$0)" lost the variable stop. `insert` merges into
      // the session instead, so the new snippet's stops nest inside the old
      // ones. It takes no range, so the term is overwritten from the cursor.
      this.monacoEditor.setPosition(snippetRange.getEndPosition());
      controller.insert(newText, {
        ...options,
        overwriteBefore: snippetRange.endColumn - snippetRange.startColumn,
        overwriteAfter: 0,
      });
    } else if (controller) {
      controller.apply([{ range: snippetRange, template: newText }], options);
    } else {
      this.monacoEditor.executeEdits('completion', [
        { range: snippetRange, text: escapeSnippet(newText), forceMoveMarkers: true },
      ]);
    }

    return this.runCommand(item);
  }

  /**
   * Runs an accepted item's `command`.
   *
   * Monaco's suggest controller used to do this; the server relies on it to
   * chain a follow-up completion.
   */
  private runCommand(item: CompletionItem) {
    if (item.command?.command === 'triggerNewCompletion') {
      this.trigger(TriggerKind.Invoked);
    } else if (item.command) {
      this.monacoEditor.trigger('completion', item.command.command, item.command.arguments);
    }
  }

  /**
   * The range an accepted item replaces.
   *
   * NOTE: a complete list is filtered locally rather than re-requested, so by
   * the time an item is accepted the server's range can be several keystrokes
   * old and end before the cursor. Everything typed since belongs to the term
   * the item was picked for, so the range is extended to the cursor — the same
   * thing Monaco's own suggest controller does.
   */
  private replaceRange(item: CompletionItem): monaco.Range {
    if (!item.textEdit) return this.wordRange();
    const range = toMonacoRange(item.textEdit.range);
    const position = this.monacoEditor.getPosition();
    if (!position) return range;
    if (position.lineNumber !== range.endLineNumber) return range;
    if (position.column <= range.endColumn) return range;
    return range.setEndPosition(position.lineNumber, position.column);
  }

  private wordRange(): monaco.Range {
    const position = this.monacoEditor.getPosition()!;
    const term = this.currentTerm();
    return new monaco.Range(
      position.lineNumber,
      position.column - term.length,
      position.lineNumber,
      position.column
    );
  }

  private onKeyDown(event: monaco.IKeyboardEvent) {
    // NOTE: Ctrl/Cmd + Enter executes the query, which ends the session. It is
    // handled before the visibility guard below on purpose: a request queued by
    // the keystroke just before would otherwise still land and open the popup
    // over the running query. The event is deliberately left to travel on, so
    // the Execute Query action takes over.
    if (event.keyCode === monaco.KeyCode.Enter && (event.ctrlKey || event.metaKey)) {
      this.hide();
      return;
    }
    if (!this.widget.isVisible()) return;
    const consume = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.keyCode) {
      case monaco.KeyCode.DownArrow:
        this.move(1);
        return consume();
      case monaco.KeyCode.UpArrow:
        this.move(-1);
        return consume();
      case monaco.KeyCode.PageDown:
        this.move(10);
        return consume();
      case monaco.KeyCode.PageUp:
        this.move(-10);
        return consume();
      case monaco.KeyCode.Enter:
        if (this.acceptSelected()) consume();
        return;
      case monaco.KeyCode.Escape:
        this.hide();
        return consume();
      case monaco.KeyCode.Tab:
        // NOTE: Tab never accepts. It dismisses the popup and the event is
        // deliberately left to travel on, so the jump command takes over.
        this.hide();
        return;
      default:
        return;
    }
  }
}

/**
 * Whether an item survives `term`.
 *
 * A case insensitive prefix match on `filterText`, falling back to the label —
 * the same rule `matches_search_term` applies on the server, so a list the
 * server has already narrowed is never narrowed further by accident.
 */
function matchesTerm(renderItem: RenderItem, term: string): boolean {
  const text = renderItem.item.filterText ?? renderItem.item.label;
  return text.toLowerCase().startsWith(term.toLowerCase());
}

/** Monaco/JSON-RPC report a cancelled request in a few different shapes. */
function isCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === REQUEST_CANCELLED) return true;
  return (error as { name?: string }).name === 'Canceled';
}

/** Escapes text so `SnippetController2` inserts it literally. */
function escapeSnippet(text: string): string {
  return text.replace(/\$|}|\\/g, '\\$&');
}

function toRenderItem(item: CompletionItem): RenderItem {
  const data = item.kind === VALUE_KIND ? item.data?.qlueLs : undefined;
  if (data?.kind === 'literal') {
    const content = literalContent(data);
    return {
      item,
      content,
      primary: content.value,
      score: data.score ?? null,
      range: rangeOf(item),
    };
  }
  if (data?.kind === 'entity') {
    // NOTE: the item's own label is the curie, so the name leads and the curie
    // sits underneath it.
    const content = entityContent(data, item.label);
    return {
      item,
      content,
      primary: content.name,
      score: data.score ?? null,
      range: rangeOf(item),
    };
  }
  // NOTE: for a keyword, a snippet or a built-in call the label is already the
  // name and `labelDetails.detail` is a signature.
  const content: RenderContent = {
    kind: 'plain',
    label: item.label,
    detail: item.labelDetails?.detail ?? null,
  };
  return { item, content, primary: item.label, score: null, range: rangeOf(item) };
}

/** Datatypes that read as a number or a date rather than as quoted text. */
const NUMBER_DATATYPES = ['integer', 'int', 'long', 'short', 'decimal', 'double', 'float'];
const DATE_DATATYPES = ['date', 'dateTime', 'dateTimeStamp', 'gYear', 'gYearMonth'];

function literalContent(data: LiteralData): Extract<RenderContent, { kind: 'literal' }> {
  // NOTE: the datatype arrives as a curie ("xsd:date") where the prefix map
  // allowed one, and as a full IRI otherwise — the local name settles the
  // colour either way.
  const localName = data.datatype?.split(/[#/:]/).pop() ?? '';
  const valueKind = NUMBER_DATATYPES.includes(localName)
    ? 'number'
    : DATE_DATATYPES.includes(localName)
      ? 'date'
      : 'text';
  return {
    kind: 'literal',
    // NOTE: a number is written bare in SPARQL, everything else quoted, which
    // is how the editor itself renders these.
    value: valueKind === 'number' ? data.value : `"${data.value}"`,
    suffix: data.language ? `@${data.language}` : data.datatype ? `^^${data.datatype}` : '',
    valueKind,
  };
}

function entityContent(
  data: EntityData,
  curie: string
): Extract<RenderContent, { kind: 'entity' }> {
  return {
    kind: 'entity',
    name: data.label || curie,
    curie,
    iri: data.uri ?? null,
    alias: data.alias ?? null,
  };
}

function rangeOf(item: CompletionItem): Range | null {
  return item.textEdit?.range ?? null;
} /**
 * The start of the range the items replace, when any of them carries one.
 *
 * Doubles as the widget's anchor, so the popup sits at the start of the term
 * and does not drift as the term grows. Items built from `insertText` alone —
 * the solution modifier keywords, for one — carry no range at all, and there
 * is then no term start to be had.
 */
function termStartOf(items: RenderItem[]): monaco.IPosition | undefined {
  const range: Range | null = items.find((item) => item.range)?.range ?? null;
  if (!range) return undefined;
  return { lineNumber: range.start.line + 1, column: range.start.character + 1 };
}
