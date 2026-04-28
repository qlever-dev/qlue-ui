// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

/**
 * Tab management for the SPARQL editor.
 *
 * Tabs are persisted to `localStorage` under the `"QLeverUI tabs"` key and
 * namespaced per backend slug — each backend keeps its own independent tab
 * list. Query-execution status (running / success / error) is deliberately
 * *ephemeral*: it is neither persisted nor kept across backend switches,
 * because that state isn't meaningful outside the session and backend it was
 * produced in.
 *
 * ### Two-phase init
 *
 * `setupTabs` runs before the backend selector has emitted its initial
 * `backend-selected` event, so per-backend state can't be loaded yet:
 *
 *  - **Phase 1** (inside `setupTabs`) — create a temporary default state
 *    seeded from the current editor content so the tab bar can render
 *    immediately.
 *  - **Phase 2** (first `backend-selected` event) — if the newly selected
 *    backend already has saved tabs, swap them in; otherwise keep the Phase 1
 *    state and associate it with the new slug. Every subsequent
 *    `backend-selected` event is a regular backend switch.
 */

import type { Editor } from '../editor/init';
import type { ExampleOrigin, TabQueryStatus } from './types';
import { DEFAULT_URI } from './types';
import {
  activeTab,
  currentSlug,
  makeDefaultState,
  nextQueryName,
  queryTabId,
  setCurrentSlug,
  setEditorRef,
  setQueryTabId,
  setState,
  setStore,
  setTabBar,
  state,
  store,
  tabQueryStatus,
} from './state';
import { debouncedSave, loadStore, saveState } from './persistence';
import { renameActiveTab, switchBackend } from './operations';
import { renderTabBar } from './render';

// Re-exports — external consumers should import from `./tabs/init`.
export type { ExampleOrigin };
export {
  getActiveTabExampleOrigin,
  getActiveTabName,
  openOrCreateTab,
  renameActiveTab,
  switchToNextTab,
  switchToPrevTab,
} from './operations';

/**
 * Initializes the tabs module. Wires up:
 *
 *  - persistence (debounced localStorage saves + save on `beforeunload`),
 *  - initial tab bar render,
 *  - Monaco `onDidChangeModelContent` tracking (auto-renames the tab back to
 *    `Query N` when its content is fully cleared),
 *  - `example-selected` → store `exampleOrigin` and rename the active tab,
 *  - `execute-start-request` / `execute-ended` → per-tab running / success /
 *    error indicators,
 *  - `backend-selected` → two-phase init on the first event, `switchBackend`
 *    on subsequent ones.
 */
export function setupTabs(editor: Editor): void {
  setEditorRef(editor);

  // load tab bar element.
  setTabBar(document.getElementById('tabBar')! as HTMLElement);

  // Load persisted store or start fresh.
  setStore(loadStore() ?? { backends: {} });

  // Phase 1: create a temporary default state from current editor content.
  // The real backend-specific state is applied in Phase 2 (first backend-selected event).
  setState(makeDefaultState(editor.getContent()));

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
    setQueryTabId(state.activeTabId);
    tabQueryStatus.set(state.activeTabId, 'running');
    renderTabBar(editor);
  });
  window.addEventListener('execute-ended', (event) => {
    if (queryTabId) {
      // Guard: only update status if the tab still exists in the current backend's tabs.
      if (!state.tabs.some((t) => t.id === queryTabId)) {
        setQueryTabId(null);
        return;
      }
      const detail = (event as CustomEvent).detail;
      const result: string = detail?.result ?? 'success';
      if (result === 'canceled') {
        tabQueryStatus.delete(queryTabId);
      } else {
        tabQueryStatus.set(queryTabId, result as TabQueryStatus);
      }
      setQueryTabId(null);
      renderTabBar(editor);
    }
  });

  // Backend selection handler (two-phase init + subsequent switches).
  document.addEventListener('backend-selected', (e: Event) => {
    const newSlug = (e as CustomEvent<string>).detail;
    if (!newSlug) return;

    if (currentSlug === null) {
      // Phase 2: first backend-selected event — finalize initialization.
      setCurrentSlug(newSlug);

      if (store.backends[newSlug]) {
        // Restore saved tabs for this backend.
        setState(store.backends[newSlug]);
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
