// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { Editor } from '../editor/init';
import type { ExampleOrigin, TabState } from './types';
import {
  activeTab,
  currentSlug,
  editorRef,
  makeDefaultState,
  makeTabId,
  makeTabUri,
  nextQueryName,
  setCurrentSlug,
  setQueryTabId,
  setState,
  state,
  store,
  tabBar,
  tabQueryStatus,
} from './state';
import { saveState } from './persistence';
import { renderTabBar } from './render';

// ── Internal tab mutations (consumed by render.ts click handlers) ────────

export async function switchTab(editor: Editor, tabId: string): Promise<void> {
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

export async function createTab(editor: Editor, name?: string, content?: string): Promise<void> {
  // NOTE: If the current tab is empty -> reuse it
  const old_content = editor.getContent();
  const tab = activeTab();
  if (old_content.trim() === "" && content != undefined) {
    tab.content = content;
    editor.editorApp.updateCodeResources({
      modified: { uri: tab.uri, text: tab.content },
    });
  }
  else {
    // Save current tab content first.
    activeTab().content = old_content;

    const id = makeTabId(state.nextId);
    const newTab: TabState = {
      id,
      name: name ?? nextQueryName(),
      uri: makeTabUri(id),
      content: content ?? '',
    };
    state.nextId++;
    state.tabs.push(newTab);
    state.activeTabId = id;

    await editor.editorApp.updateCodeResources({
      modified: { uri: newTab.uri, text: newTab.content },
    });
  }
  saveState();
  renderTabBar(editor);
  editor.focus();
}

export async function closeTab(editor: Editor, tabId: string): Promise<void> {
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

export function renameTab(tabId: string, name: string): void {
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

export async function switchBackend(editor: Editor, newSlug: string): Promise<void> {
  // Save current tab's latest editor content.
  activeTab().content = editor.getContent();
  store.backends[currentSlug!] = state;

  // Clear ephemeral query status (not meaningful across backends).
  tabQueryStatus.clear();
  setQueryTabId(null);

  // Switch to new backend.
  setCurrentSlug(newSlug);
  const nextState = store.backends[newSlug] ?? makeDefaultState('');
  setState(nextState);
  store.backends[newSlug] = nextState;

  // Restore active tab content in editor.
  const tab = activeTab();
  await editor.editorApp.updateCodeResources({
    modified: { uri: tab.uri, text: tab.content },
  });

  saveState();
  renderTabBar(editor);
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Activates the tab whose content exactly matches `content`, or creates a new
 * tab for it. De-duplicates by exact content match so that re-opening the same
 * shared query or `?query=…` parameter doesn't spawn a duplicate tab.
 */
export async function openOrCreateTab(
  editor: Editor,
  name: string | undefined,
  content: string
): Promise<void> {
  const existing = state.tabs.find((t) => t.content === content);
  if (existing) {
    await switchTab(editor, existing.id);
  } else {
    await createTab(editor, name, content);
  }
}

/** Switches to the next tab (wraps around). No-op before `setupTabs` runs or with fewer than two tabs. */
export function switchToNextTab(): void {
  if (!editorRef || state.tabs.length <= 1) return;
  const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
  switchTab(editorRef, state.tabs[(idx + 1) % state.tabs.length].id);
}

/** Switches to the previous tab (wraps around). No-op before `setupTabs` runs or with fewer than two tabs. */
export function switchToPrevTab(): void {
  if (!editorRef || state.tabs.length <= 1) return;
  const idx = state.tabs.findIndex((t) => t.id === state.activeTabId);
  switchTab(editorRef, state.tabs[(idx - 1 + state.tabs.length) % state.tabs.length].id);
}

/**
 * Example origin of the active tab, or `undefined` once the user edits or
 * renames the tab (both clear the association).
 */
export function getActiveTabExampleOrigin(): ExampleOrigin | undefined {
  return activeTab().exampleOrigin;
}

export function getActiveTabName(): string {
  return activeTab().name;
}

/** Renames the active tab. Trims input; empty strings are ignored. Re-renders when the tab bar is mounted. */
export function renameActiveTab(name: string): void {
  const tab = activeTab();
  if (!tab) return;
  const trimmed = name.trim();
  if (trimmed) tab.name = trimmed;
  saveState();
  if (tabBar) renderTabBar(editorRef!);
}
