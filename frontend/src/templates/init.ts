// NOTE: Template editor panel lifecycle — open/close, tabs, and LS communication.

import * as monaco from 'monaco-editor';
import { apiFetch, clearApiKey, getApiKey } from '../api';
import { executeQuery } from '../buttons/execute';
import { applyPanelWidth, toggleWideMode } from '../buttons/wide_mode';
import type { Editor } from '../editor/init';
import { openOrCreateTab } from '../tabs/operations';
import type { QlueLsServiceConfig } from '../types/backend';
import { escapeHtml } from '../utils';
import { type CompletionRun, clearRuns, getRuns } from './runs';

const DEBOUNCE_MS = 300;
const DEFAULT_RUNS_HEIGHT = 176;
const MIN_RUNS_HEIGHT = 80;

type QueryTemplate =
  | 'subjectCompletion'
  | 'predicateCompletionContextSensitive'
  | 'predicateCompletionContextInsensitive'
  | 'objectCompletionContextSensitive'
  | 'objectCompletionContextInsensitive'
  | 'valuesCompletionContextSensitive'
  | 'valuesCompletionContextInsensitive'
  | 'hover';

/** One tab per completion position. `ctx` is the context-sensitive variant, if any. */
const TABS: { label: string; plain: QueryTemplate; ctx?: QueryTemplate }[] = [
  { label: 'Subject', plain: 'subjectCompletion' },
  {
    label: 'Predicate',
    plain: 'predicateCompletionContextInsensitive',
    ctx: 'predicateCompletionContextSensitive',
  },
  {
    label: 'Object',
    plain: 'objectCompletionContextInsensitive',
    ctx: 'objectCompletionContextSensitive',
  },
  {
    label: 'Values',
    plain: 'valuesCompletionContextInsensitive',
    ctx: 'valuesCompletionContextSensitive',
  },
  { label: 'Hover', plain: 'hover' },
];

const TAB_CLASS = 'flex items-center px-2 cursor-pointer border-b-2';
const TAB_ACTIVE_CLASS = `${TAB_CLASS} font-semibold border-gray-500 dark:border-gray-300`;
const TAB_INACTIVE_CLASS = `${TAB_CLASS} border-transparent text-gray-500 dark:text-gray-400`;

let templateEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let editorRef: Editor | null = null;
let activeTab = TABS[0].label;
let ctxOn = true;
let runsScope: 'this' | 'all' = 'this';
let openRun = -1;
let runsCollapsed = false;
let runsHeight = DEFAULT_RUNS_HEIGHT;
let dirty = false;
let appliedAt: number | null = null;
let ticker: number | undefined;
/** Age labels of the rendered run rows, refreshed by the ticker. */
const ageLabels: { element: HTMLElement; at: number; durationMs: number }[] = [];
let activeKey: QueryTemplate | null = null;
let currentConfig: QlueLsServiceConfig | null = null;
let debounceTimer: number | undefined;
let changeListener: monaco.IDisposable | null = null;

function tab(label: string) {
  return TABS.find((t) => t.label === label)!;
}

/** The template key the tabs plus the ctx switch currently point at. */
function activeTemplateKey(): QueryTemplate {
  const current = tab(activeTab);
  return ctxOn && current.ctx ? current.ctx : current.plain;
}

/** Registers the close/save buttons and backend-switch listener for the templates editor. */
export function setupTemplatesEditor(editor: Editor) {
  editorRef = editor;

  document.getElementById('templatePanelClose')!.addEventListener('click', () => {
    closeTemplatesEditor();
    editor.focus();
  });

  document.getElementById('templatePanelSave')!.addEventListener('click', () => {
    saveTemplates();
  });

  document.getElementById('templateCtxToggle')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('[data-ctx]') as HTMLElement | null;
    if (!button) return;
    ctxOn = button.dataset.ctx === '1';
    selectTemplate(activeTemplateKey(), editor);
  });

  document.getElementById('templateRunsScope')!.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('[data-scope]') as HTMLElement | null;
    if (!button) return;
    runsScope = button.dataset.scope as 'this' | 'all';
    openRun = -1;
    renderRuns();
  });

  document.getElementById('templateRunsToggle')!.addEventListener('click', () => {
    runsCollapsed = !runsCollapsed;
    applyRunsCollapsed();
  });

  document.getElementById('templateRunsClear')!.addEventListener('click', () => {
    clearRuns();
  });

  setupRunsResize();

  document.addEventListener('completion-run-logged', () => {
    if (templateEditor) renderRuns();
  });

  document.addEventListener('backend-selected', () => {
    if (templateEditor) {
      closeTemplatesEditor();
    }
  });
}

/** Drag the drawer's top edge to trade height between the editor and the runs. */
function setupRunsResize() {
  const handle = document.getElementById('templateRunsResize')!;
  const container = document.getElementById('templateRunsContainer')!;

  handle.addEventListener('pointerdown', (event) => {
    if (runsCollapsed) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = container.getBoundingClientRect().height;

    const move = (moveEvent: PointerEvent) => {
      runsHeight = Math.max(MIN_RUNS_HEIGHT, startHeight - (moveEvent.clientY - startY));
      container.style.height = `${runsHeight}px`;
      templateEditor?.layout();
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

function applyRunsCollapsed() {
  const container = document.getElementById('templateRunsContainer')!;
  const chevron = document.getElementById('templateRunsChevron')!;
  const list = document.getElementById('templateRunsList')!;

  container.style.height = runsCollapsed ? '' : `${runsHeight}px`;
  list.classList.toggle('hidden', runsCollapsed);
  chevron.classList.toggle('rotate-180', runsCollapsed);
  templateEditor?.layout();
}

/** Opens the templates editor panel, fetches current backend config, and creates the editor. */
export async function openTemplatesEditor(editor: Editor) {
  if (templateEditor) return;

  const panel = document.getElementById('templatePanel')!;

  // NOTE: Fetch current backend config from the language server.
  // sendRequest returns the result directly; errors are thrown as exceptions.
  let config: QlueLsServiceConfig;
  try {
    config = (await editor.languageClient.sendRequest(
      'qlueLs/getBackend',
      {}
    )) as QlueLsServiceConfig;
  } catch (err) {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: `Failed to fetch backend config: ${err}`,
          duration: 3000,
        },
      })
    );
    return;
  }

  currentConfig = config;
  dirty = false;
  appliedAt = null;
  openRun = -1;

  // NOTE: Widen the parent container to make room for the template panel.
  applyPanelWidth();

  panel.classList.remove('hidden');
  panel.classList.add('flex');
  document.getElementById('templatePanelBackend')!.textContent = config.name;

  // NOTE: Let the layout settle, then relayout Monaco.
  setTimeout(() => editor.editorApp.getEditor()?.layout(), 50);

  // NOTE: Create standalone Monaco editor for template editing.
  const editorContainer = document.getElementById('templateEditorContainer')!;
  templateEditor = monaco.editor.create(editorContainer, {
    language: 'sparql',
    automaticLayout: true,
    minimap: { enabled: false },
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    links: false,
    fontSize: 13,
    theme: document.getElementById('theme-switch')
      ? (document.getElementById('theme-switch') as HTMLInputElement).checked
        ? 'QlueUiThemeDark'
        : 'QlueUiThemeLight'
      : undefined,
  });

  buildTabs(editor);
  selectTemplate(activeTemplateKey(), editor);
  applyRunsCollapsed();

  // NOTE: Ages are relative, so they need a tick to stay honest.
  ticker = window.setInterval(refreshAges, 1000);
}

/** The tab a tera template name (`"<backend>-<templateKey>"`) belongs to. */
function templateTabLabel(template: string): string | null {
  return matchTemplate(template)?.label ?? null;
}

/** The row tag: which variant ran, prefixed by the tab when the scope spans tabs. */
function templateRunLabel(template: string): string | null {
  const match = matchTemplate(template);
  if (!match) return runsScope === 'all' ? template : null;
  const variant = matchTemplateHasCtx(match.label) ? (match.isCtx ? 'ctx' : 'plain') : null;
  if (runsScope !== 'all') return variant;
  return variant ? `${match.label} · ${variant}` : match.label;
}

function matchTemplateHasCtx(label: string): boolean {
  return tab(label).ctx !== undefined;
}

function matchTemplate(template: string): { label: string; isCtx: boolean } | null {
  for (const { label, plain, ctx } of TABS) {
    for (const key of [plain, ctx]) {
      if (key !== undefined && (template === key || template.endsWith(`-${key}`)))
        return { label, isCtx: key === ctx };
    }
  }
  return null;
}

function formatAge(at: number): string {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

function refreshAges() {
  const applied = document.getElementById('templateApplied');
  if (applied) {
    applied.textContent =
      appliedAt === null
        ? 'not applied yet'
        : `applied to the language server ${formatAge(appliedAt)}`;
  }
  for (const label of ageLabels) {
    label.element.textContent = `${label.durationMs}ms · ${formatAge(label.at)}`;
  }
}

function renderStatus() {
  const dot = document.getElementById('templateDirtyDot')!;
  const label = document.getElementById('templateDirtyLabel')!;

  dot.className = dirty
    ? 'w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse'
    : 'w-1.5 h-1.5 rounded-full bg-emerald-500';
  label.textContent = dirty ? 'Unsaved' : 'Saved';
  refreshAges();
}

/** Consecutive identical runs are one row with a `×N` badge. */
function collapseBursts(runs: CompletionRun[]): { run: CompletionRun; count: number }[] {
  const bursts: { run: CompletionRun; count: number }[] = [];
  for (const run of runs) {
    const last = bursts[bursts.length - 1];
    if (
      last &&
      last.run.template === run.template &&
      last.run.query === run.query &&
      last.run.error === run.error
    ) {
      last.count += 1;
    } else {
      bursts.push({ run, count: 1 });
    }
  }
  return bursts;
}

function renderRuns() {
  const list = document.getElementById('templateRunsList')!;
  const all = getRuns();
  const visible = all.filter(
    (run) => runsScope === 'all' || templateTabLabel(run.template) === activeTab
  );

  document.getElementById('templateRunsScopeThis')!.textContent = activeTab;
  document.getElementById('templateRunsCount')!.textContent = `${visible.length} of ${all.length}`;
  for (const button of document
    .getElementById('templateRunsScope')!
    .querySelectorAll<HTMLElement>('[data-scope]')) {
    button.dataset.state = button.dataset.scope === runsScope ? 'active' : 'inactive';
  }

  ageLabels.length = 0;
  list.replaceChildren();

  if (visible.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'p-3 text-gray-500 dark:text-gray-400';
    empty.textContent =
      all.length === 0
        ? 'No completion queries yet. Trigger a completion in the editor.'
        : `No runs for ${activeTab}. Switch the scope to All.`;
    list.appendChild(empty);
    return;
  }

  collapseBursts(visible).forEach((burst, index) => {
    list.appendChild(renderRun(burst.run, burst.count, index));
  });
}

function renderRun(run: CompletionRun, count: number, index: number): HTMLLIElement {
  const failed = run.error !== undefined || run.resultCount === undefined;
  const open = openRun === index && !failed && run.query !== '';

  const item = document.createElement('li');
  item.className = `border-b border-l-2 border-b-gray-200 dark:border-b-gray-700 ${
    failed
      ? 'border-l-red-500'
      : open
        ? 'border-l-green-500 bg-gray-50 dark:bg-neutral-700/40'
        : 'border-l-transparent'
  }`;

  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-button-hover';

  // NOTE: The chevron and the row body expand; only the buttons on the right act.
  const chevron = document.createElement('span');
  chevron.className = `shrink-0 text-gray-400 dark:text-gray-500 ${open ? 'rotate-90' : ''}`;
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" class="w-2.5 h-2.5"><path d="M9 6l6 6-6 6"></path></svg>';

  const status = document.createElement('span');
  if (failed) {
    status.className = 'font-semibold text-red-500';
    status.textContent = 'render failed';
  } else {
    status.className = open ? 'font-semibold text-green-600' : 'text-green-600';
    status.textContent = `${run.resultCount} results`;
    status.title = 'Bindings returned by the endpoint, before search term filtering';
  }

  header.append(chevron, status);

  // NOTE: In "All" scope the row has to say which template it came from; within a
  // tab only the ctx/plain variant is left to distinguish.
  const tagText = templateRunLabel(run.template);
  if (tagText !== null) {
    const name = document.createElement('span');
    name.className = 'px-1.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300';
    name.textContent = tagText;
    header.appendChild(name);
  }

  if (count > 1) {
    const burst = document.createElement('span');
    burst.className =
      'px-1 rounded border border-button-border font-mono text-[10px] text-gray-500 dark:text-gray-400';
    burst.textContent = `×${count}`;
    burst.title = 'Identical runs collapsed';
    header.appendChild(burst);
  }

  const meta = document.createElement('span');
  meta.className = 'ml-auto shrink-0 font-mono text-gray-500 dark:text-gray-400';
  meta.textContent = `${run.durationMs}ms · ${formatAge(run.at)}`;
  ageLabels.push({ element: meta, at: run.at, durationMs: run.durationMs });
  header.appendChild(meta);

  const actions = document.createElement('span');
  actions.className =
    'flex items-center gap-1 pl-1.5 border-l border-gray-200 dark:border-gray-700';

  const copyButton = iconButton(
    'Copy query to the clipboard',
    '<rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path>'
  );
  const runButton = iconButton(
    'Open in a new tab and execute',
    '<path d="M7 5l11 7-11 7z"></path>'
  );

  if (run.query === '') {
    // NOTE: Nothing to copy or run when the template itself failed to render.
    copyButton.disabled = true;
    runButton.disabled = true;
    copyButton.className = 'text-gray-400 opacity-40 cursor-not-allowed';
    runButton.className = 'text-gray-400 opacity-40 cursor-not-allowed';
  }

  copyButton.addEventListener('click', (event) => {
    event.stopPropagation();
    navigator.clipboard
      .writeText(run.query)
      .then(() => {
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'success', message: 'Query copied.', duration: 2000 },
          })
        );
      })
      .catch(() => {
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'error', message: 'Could not copy query.', duration: 3000 },
          })
        );
      });
  });

  runButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!editorRef) return;
    openOrCreateTab(editorRef, 'completion query', run.query).then(() => {
      executeQuery();
    });
  });

  actions.append(copyButton, runButton);
  header.appendChild(actions);
  item.appendChild(header);

  if (run.error !== undefined) {
    item.appendChild(renderError(run.error));
  }

  header.addEventListener('click', () => {
    openRun = openRun === index ? -1 : index;
    renderRuns();
  });

  if (open) {
    const query = document.createElement('pre');
    query.className =
      'mx-2 mb-2 ml-7 max-h-28 overflow-auto rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-neutral-800 p-2 font-mono text-[11px] whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300';
    query.textContent = run.query;
    item.appendChild(query);
  }

  return item;
}

function iconButton(title: string, path: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = title;
  button.className =
    'flex items-center justify-center w-5 h-5 rounded cursor-pointer text-gray-500 dark:text-gray-400 hover:text-green-600';
  button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="w-3 h-3">${path}</svg>`;
  return button;
}

/** The cause, plus a link to the offending line when the server named one. */
function renderError(message: string): HTMLDivElement {
  const error = document.createElement('div');
  error.className = 'pb-1.5 pl-7 pr-2 text-red-500 whitespace-pre-wrap break-words';

  const line = /line (\d+)/i.exec(message);
  if (!line) {
    error.textContent = message;
    return error;
  }

  error.append(message.slice(0, line.index));
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'underline decoration-dotted cursor-pointer';
  link.textContent = line[0];
  link.addEventListener('click', (event) => {
    event.stopPropagation();
    const lineNumber = Number(line[1]);
    templateEditor?.revealLineInCenter(lineNumber);
    templateEditor?.setPosition({ lineNumber, column: 1 });
    templateEditor?.focus();
  });
  error.append(link, message.slice(line.index + line[0].length));
  return error;
}

function buildTabs(editor: Editor) {
  const container = document.getElementById('templateTabs')!;
  container.replaceChildren();

  for (const { label } of TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.tab = label;
    button.addEventListener('click', () => {
      activeTab = label;
      openRun = -1;
      selectTemplate(activeTemplateKey(), editor);
    });
    container.appendChild(button);
  }
}

/** Reflects the active tab and whether its ctx variant is in play. */
function renderTabs() {
  for (const button of document
    .getElementById('templateTabs')!
    .querySelectorAll<HTMLElement>('[data-tab]')) {
    button.className = button.dataset.tab === activeTab ? TAB_ACTIVE_CLASS : TAB_INACTIVE_CLASS;
  }

  const toggle = document.getElementById('templateCtxToggle')!;
  const hasCtx = tab(activeTab).ctx !== undefined;
  toggle.classList.toggle('hidden', !hasCtx);
  toggle.classList.toggle('flex', hasCtx);
  for (const button of toggle.querySelectorAll<HTMLElement>('[data-ctx]')) {
    button.dataset.state = (button.dataset.ctx === '1') === ctxOn ? 'active' : 'inactive';
  }
}

function selectTemplate(key: QueryTemplate, editor: Editor) {
  if (!currentConfig || !templateEditor) return;

  // NOTE: Save current editor content back before switching.
  if (activeKey && currentConfig.queries[activeKey] !== undefined) {
    currentConfig.queries[activeKey]! = templateEditor.getValue();
  }

  // NOTE: Drop the listener before setValue, or swapping templates counts as an edit.
  clearTimeout(debounceTimer);
  changeListener?.dispose();
  changeListener = null;

  activeKey = key;
  const value = currentConfig.queries[key] ?? '';
  templateEditor.setValue(value);

  renderTabs();
  renderStatus();
  renderRuns();

  // NOTE: Re-register the change listener for instant apply.
  changeListener = templateEditor.onDidChangeModelContent(() => {
    dirty = true;
    renderStatus();
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => applyTemplate(editor), DEBOUNCE_MS);
  });
}

function applyTemplate(editor: Editor) {
  if (!currentConfig || !templateEditor || !activeKey) return;

  currentConfig.queries[activeKey] = templateEditor.getValue();

  editor.languageClient
    .sendRequest('qlueLs/addBackend', currentConfig)
    .then(() => {
      appliedAt = Date.now();
      refreshAges();
    })
    .catch((err) => {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: 'error',
            message: `Failed to apply template:<pre class="mt-1 text-xs whitespace-pre-wrap">${escapeHtml(err.message)}</pre>`,
            duration: 3000,
          },
        })
      );
    });
}

function saveTemplates() {
  if (!currentConfig || !templateEditor || !activeKey) return;

  // NOTE: Flush current editor content into the active template.
  currentConfig.queries[activeKey] = templateEditor.getValue();

  const apiKey = getApiKey();
  if (!apiKey) {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: 'Missing API key!<br>Enter an API key to save templates.',
          duration: 3000,
        },
      })
    );
    return;
  }

  apiFetch(`endpoints/${currentConfig.name}/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ queryTemplates: currentConfig.queries }),
  })
    .then((response) => {
      if (!response.ok) {
        let message = 'Templates could not be saved.';
        if (response.status === 403) {
          clearApiKey();
          message = 'Missing permissions!<br>Log into the API to save templates.';
        }
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'error', message, duration: 3000 },
          })
        );
      } else {
        dirty = false;
        renderStatus();
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'success', message: 'Templates saved.', duration: 3000 },
          })
        );
      }
    })
    .catch(() => {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: { type: 'error', message: 'Templates could not be saved.', duration: 3000 },
        })
      );
    });
}

function closeTemplatesEditor() {
  // NOTE: Stop listening for content changes.
  clearTimeout(debounceTimer);
  clearInterval(ticker);
  changeListener?.dispose();
  changeListener = null;

  // NOTE: Dispose the standalone editor.
  templateEditor?.dispose();
  templateEditor = null;
  activeKey = null;
  currentConfig = null;

  const panel = document.getElementById('templatePanel')!;
  panel.classList.add('hidden');
  panel.classList.remove('flex');

  // NOTE: Clear the editor container and the rendered run list (the history itself is kept).
  document.getElementById('templateEditorContainer')!.innerHTML = '';
  document.getElementById('templateRunsList')!.replaceChildren();
  ageLabels.length = 0;

  // NOTE: Restore the container width (respects wide mode).
  toggleWideMode();

  // NOTE: Relayout Monaco after the panel closes.
  setTimeout(() => {
    window.__editor?.editorApp.getEditor()?.layout();
  }, 50);
}
