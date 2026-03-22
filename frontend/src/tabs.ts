// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { Editor } from './editor/init';

// ── Types ────────────────────────────────────────────────────────────────

export interface ExampleOrigin {
  name: string;
  service: string;
}

interface TabState {
  id: string;
  name: string;
  uri: string;
  content: string;
  exampleOrigin?: ExampleOrigin;
}

interface TabsState {
  tabs: TabState[];
  activeTabId: string;
  nextId: number;
}

interface BackendTabsStore {
  backends: Record<string, TabsState>;
}

// ── Constants ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'QLeverUI tabs';
const DEFAULT_URI = 'query.rq';
const SAVE_DEBOUNCE_MS = 500;

// ── Module state ─────────────────────────────────────────────────────────

let store: BackendTabsStore;
let currentSlug: string | null = null;
let state: TabsState;
let tabBar: HTMLElement;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// ── Query status per tab (not persisted) ─────────────────────────────────

type TabQueryStatus = 'idle' | 'running' | 'success' | 'error';
const tabQueryStatus = new Map<string, TabQueryStatus>();
let queryTabId: string | null = null;

// ── Persistence ──────────────────────────────────────────────────────────

function saveState(): void {
  if (currentSlug) {
    store.backends[currentSlug] = state;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function loadStore(): BackendTabsStore | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.backends) {
      return parsed as BackendTabsStore;
    }
  } catch {
    console.warn(
      `Corrupted tab data in localStorage ("${STORAGE_KEY}"). ` +
      `Run localStorage.removeItem("${STORAGE_KEY}") in the console to reset.`
    );
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'warning',
          message: `Corrupted tab data. Run localStorage.removeItem("${STORAGE_KEY}") in the console to reset.`,
        },
      })
    );
  }
  return null;
}

function debouncedSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, SAVE_DEBOUNCE_MS);
}

// ── Tab operations ───────────────────────────────────────────────────────

function activeTab(): TabState {
  return state.tabs.find((t) => t.id === state.activeTabId)!;
}

function makeTabId(n: number): string {
  return `tab-${n}`;
}

function makeTabUri(id: string): string {
  return `${id}.rq`;
}

function nextQueryName(): string {
  const used = new Set(
    state.tabs
      .map((t) => t.name.match(/^Query (\d+)$/))
      .filter(Boolean)
      .map((m) => Number(m![1]))
  );
  let n = 1;
  while (used.has(n)) n++;
  return `Query ${n}`;
}

function makeDefaultState(content: string): TabsState {
  return {
    tabs: [
      {
        id: makeTabId(1),
        name: 'Query 1',
        uri: DEFAULT_URI,
        content,
      },
    ],
    activeTabId: makeTabId(1),
    nextId: 2,
  };
}

async function switchTab(editor: Editor, tabId: string): Promise<void> {
  if (tabId === state.activeTabId) return;

  // Save current tab's content.
  const current = activeTab();
  current.content = editor.getContent();

  // Activate new tab.
  state.activeTabId = tabId;
  const next = activeTab();

  await editor.editorApp.updateCodeResources({
    modified: { uri: next.uri, text: next.content },
  });

  saveState();
  renderTabBar(editor);
  editor.focus();
}

async function createTab(editor: Editor, name?: string, content?: string): Promise<void> {
  // Save current tab content first.
  activeTab().content = editor.getContent();

  const id = makeTabId(state.nextId);
  const tab: TabState = {
    id,
    name: name ?? nextQueryName(),
    uri: makeTabUri(id),
    content: content ?? '',
  };
  state.nextId++;
  state.tabs.push(tab);
  state.activeTabId = id;

  await editor.editorApp.updateCodeResources({
    modified: { uri: tab.uri, text: tab.content },
  });

  saveState();
  renderTabBar(editor);
  editor.focus();
}

async function closeTab(editor: Editor, tabId: string): Promise<void> {
  if (state.tabs.length <= 1) return;

  tabQueryStatus.delete(tabId);
  const idx = state.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  state.tabs.splice(idx, 1);

  if (state.activeTabId === tabId) {
    // Switch to neighbor: prefer the tab to the right, fall back to the left.
    const newIdx = Math.min(idx, state.tabs.length - 1);
    state.activeTabId = state.tabs[newIdx].id;
    const next = activeTab();

    await editor.editorApp.updateCodeResources({
      modified: { uri: next.uri, text: next.content },
    });

    editor.focus();
  }

  saveState();
  renderTabBar(editor);
}

function renameTab(tabId: string, name: string): void {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const trimmed = name.trim();
  if (trimmed) {
    tab.name = trimmed;
    tab.exampleOrigin = undefined;
  }
  saveState();
}

// ── Backend switching ────────────────────────────────────────────────────

async function switchBackend(editor: Editor, newSlug: string): Promise<void> {
  // Save current tab's latest editor content.
  activeTab().content = editor.getContent();
  store.backends[currentSlug!] = state;

  // Clear ephemeral query status (not meaningful across backends).
  tabQueryStatus.clear();
  queryTabId = null;

  // Switch to new backend.
  currentSlug = newSlug;
  state = store.backends[newSlug] ?? makeDefaultState('');
  store.backends[newSlug] = state;

  // Restore active tab content in editor.
  const tab = activeTab();
  await editor.editorApp.updateCodeResources({
    modified: { uri: tab.uri, text: tab.content },
  });

  saveState();
  renderTabBar(editor);
}

// ── Tab bar rendering ────────────────────────────────────────────────────

function renderTabBar(editor: Editor): void {
  tabBar.innerHTML = '';

  for (const tab of state.tabs) {
    const isActive = tab.id === state.activeTabId;
    const status = tabQueryStatus.get(tab.id) ?? 'idle';
    const isRunning = status === 'running';

    const el = document.createElement('div');

    let statusClasses: string;
    if (isRunning) {
      statusClasses = isActive
        ? 'border-transparent font-bold text-gray-900 dark:text-gray-100 bg-green-500/5 dark:bg-green-500/10'
        : 'border-transparent text-gray-700 dark:text-gray-300 bg-green-500/5 dark:bg-green-500/10';
    } else if (isActive) {
      statusClasses = 'border-green-500 font-bold text-gray-900 dark:text-gray-100';
    } else {
      statusClasses =
        'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50';
    }

    el.className = `group relative flex items-center gap-1 px-3 py-1.5 cursor-pointer select-none whitespace-nowrap border-b-2 transition-colors ${statusClasses}`;

    // Status dot (success / error).
    if (status === 'success' || status === 'error') {
      const dot = document.createElement('span');
      const color = status === 'success' ? 'bg-green-500' : 'bg-red-500';
      dot.className = `size-1.5 rounded-full ${color} animate-tab-status-pop shrink-0`;
      el.appendChild(dot);
    }

    // Tab name (double-click to rename).
    const nameSpan = document.createElement('span');
    nameSpan.className = 'text-sm';
    nameSpan.textContent = tab.name;
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename(editor, tab, nameSpan);
    });
    el.appendChild(nameSpan);

    // Close button (hidden on last tab).
    if (state.tabs.length > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className =
        'opacity-0 group-hover:opacity-100 ml-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs leading-none transition-opacity';
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(editor, tab.id);
      });
      // Also show close button on active tab always.
      if (isActive) closeBtn.classList.replace('opacity-0', 'opacity-60');
      el.appendChild(closeBtn);
    }

    // Running animation: gradient sweep along bottom border.
    if (isRunning) {
      const barContainer = document.createElement('div');
      barContainer.className = 'absolute -bottom-0.5 inset-x-0 h-0.5 overflow-hidden';

      const bar = document.createElement('div');
      bar.className = 'absolute inset-y-0 w-2/5 rounded-full animate-tab-sweep';
      bar.style.background =
        'linear-gradient(90deg, transparent, #4ade80, #bbf7d0, #4ade80, transparent)';

      barContainer.appendChild(bar);
      el.appendChild(barContainer);
    }

    // Click to switch.
    el.addEventListener('click', () => switchTab(editor, tab.id));

    // Middle-click to close.
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        closeTab(editor, tab.id);
      }
    });

    tabBar.appendChild(el);
  }

  // "+" button to add new tab.
  const addBtn = document.createElement('button');
  addBtn.className =
    'px-2.5 py-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 text-sm transition-colors';
  addBtn.textContent = '+';
  addBtn.title = 'New tab';
  addBtn.addEventListener('click', () => createTab(editor));
  tabBar.appendChild(addBtn);
}

function startRename(editor: Editor, tab: TabState, nameSpan: HTMLSpanElement): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = tab.name;
  input.className =
    'text-sm bg-transparent border-b border-gray-400 dark:border-gray-500 outline-none w-24 text-gray-900 dark:text-gray-100';

  const commit = () => {
    renameTab(tab.id, input.value);
    renderTabBar(editor);
  };
  const cancel = () => renderTabBar(editor);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', commit);

  nameSpan.replaceWith(input);
  input.focus();
  input.select();
}

// ── Public API ───────────────────────────────────────────────────────────

export async function openOrCreateTab(
  editor: Editor,
  name: string,
  content: string
): Promise<void> {
  const existing = state.tabs.find((t) => t.name === name && t.content === content);
  if (existing) {
    await switchTab(editor, existing.id);
  } else {
    await createTab(editor, name, content);
  }
}

export function switchToNextTab(): void {
  if (!editorRef || state.tabs.length <= 1) return;
  const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
  switchTab(editorRef, state.tabs[(idx + 1) % state.tabs.length].id);
}

export function switchToPrevTab(): void {
  if (!editorRef || state.tabs.length <= 1) return;
  const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
  switchTab(editorRef, state.tabs[(idx - 1 + state.tabs.length) % state.tabs.length].id);
}

export function getActiveTabExampleOrigin(): ExampleOrigin | undefined {
  return activeTab().exampleOrigin;
}

export function getActiveTabName(): string {
  return activeTab().name;
}

export function renameActiveTab(name: string): void {
  const tab = activeTab();
  if (!tab) return;
  const trimmed = name.trim();
  if (trimmed) tab.name = trimmed;
  saveState();
  if (tabBar) renderTabBar(editorRef!);
}

let editorRef: Editor | null = null;

// ── Setup ────────────────────────────────────────────────────────────────

export function setupTabs(editor: Editor): void {
  editorRef = editor;

  // load tab bar element.
  tabBar = document.getElementById("tabBar")! as HTMLElement;

  // Load persisted store or start fresh.
  store = loadStore() ?? { backends: {} };

  // Phase 1: create a temporary default state from current editor content.
  // The real backend-specific state is applied in Phase 2 (first backend-selected event).
  state = makeDefaultState(editor.getContent());

  renderTabBar(editor);

  // Track content changes with debounced persistence.
  const monacoEditor = editor.editorApp.getEditor()!;
  monacoEditor.onDidChangeModelContent(() => {
    const tab = activeTab();
    tab.content = monacoEditor.getValue();

    // Reset tab name when content is fully cleared (e.g. Ctrl+A, Del).
    if (!tab.content.trim() && !tab.name.match(/^Query \d+$/)) {
      tab.name = nextQueryName();
      tab.exampleOrigin = undefined;
      renderTabBar(editor);
    }

    debouncedSave();
  });

  // Store example origin and rename active tab when an example is loaded.
  document.addEventListener('example-selected', (e: Event) => {
    const { name, service } = (e as CustomEvent<ExampleOrigin>).detail;
    activeTab().exampleOrigin = { name, service };
    renameActiveTab(name);
  });

  // Track query execution status per tab.
  window.addEventListener('execute-start-request', () => {
    queryTabId = state.activeTabId;
    tabQueryStatus.set(state.activeTabId, 'running');
    renderTabBar(editor);
  });
  window.addEventListener('execute-ended', (event) => {
    if (queryTabId) {
      // Guard: only update status if the tab still exists in the current backend's tabs.
      if (!state.tabs.some((t) => t.id === queryTabId)) {
        queryTabId = null;
        return;
      }
      const detail = (event as CustomEvent).detail;
      const result: string = detail?.result ?? 'success';
      if (result === 'canceled') {
        tabQueryStatus.delete(queryTabId);
      } else {
        tabQueryStatus.set(queryTabId, result as TabQueryStatus);
      }
      queryTabId = null;
      renderTabBar(editor);
    }
  });

  // Backend selection handler (two-phase init + subsequent switches).
  document.addEventListener('backend-selected', (e: Event) => {
    const newSlug = (e as CustomEvent<string>).detail;
    if (!newSlug) return;

    if (currentSlug === null) {
      // Phase 2: first backend-selected event — finalize initialization.
      currentSlug = newSlug;

      if (store.backends[newSlug]) {
        // Restore saved tabs for this backend.
        state = store.backends[newSlug];
      }
      // Otherwise keep the temporary default state created in Phase 1.

      store.backends[newSlug] = state;

      // Restore active tab content in editor.
      const tab = activeTab();
      editor.setContent(tab.content);
      if (tab.uri !== DEFAULT_URI) {
        editor.editorApp.updateCodeResources({
          modified: { uri: tab.uri, text: tab.content },
        });
      }

      saveState();
      renderTabBar(editor);
    } else if (newSlug !== currentSlug) {
      // Subsequent backend switch.
      switchBackend(editor, newSlug);
    }
  });

  // Save on page unload.
  window.addEventListener('beforeunload', () => {
    activeTab().content = editor.getContent();
    saveState();
  });
}
