// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { Editor } from '../editor/init';
import type { BackendTabsStore, TabQueryStatus, TabState, TabsState } from './types';
import { DEFAULT_URI } from './types';

// Per-backend persisted tab store (localStorage). Reassigned on load in setupTabs.
export let store: BackendTabsStore;
// Backend slug of the currently-visible tab set. `null` until the first
// `backend-selected` event arrives (see the two-phase init in init.ts).
export let currentSlug: string | null = null;
// Active tab set (the entry of `store.backends[currentSlug]` in steady state).
export let state: TabsState;
// DOM host for the tab bar, resolved once in setupTabs.
export let tabBar: HTMLElement;
// Editor reference captured in setupTabs; used by helpers that are invoked
// without an explicit editor argument (e.g. keybinding callbacks).
export let editorRef: Editor | null = null;

// Ephemeral per-tab query-execution status — deliberately not persisted and
// cleared on backend switch, because query state isn't meaningful across
// backends or sessions.
export const tabQueryStatus = new Map<string, TabQueryStatus>();
export let queryTabId: string | null = null;

export function setStore(value: BackendTabsStore): void {
  store = value;
}

export function setCurrentSlug(value: string | null): void {
  currentSlug = value;
}

export function setState(value: TabsState): void {
  state = value;
}

export function setTabBar(value: HTMLElement): void {
  tabBar = value;
}

export function setEditorRef(value: Editor | null): void {
  editorRef = value;
}

export function setQueryTabId(value: string | null): void {
  queryTabId = value;
}

export function activeTab(): TabState {
  return state.tabs.find((t) => t.id === state.activeTabId)!;
}

export function makeTabId(n: number): string {
  return `tab-${n}`;
}

export function makeTabUri(id: string): string {
  return `${id}.rq`;
}

export function nextQueryName(): string {
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

export function makeDefaultState(content: string): TabsState {
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
