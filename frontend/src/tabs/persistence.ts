// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { BackendTabsStore } from './types';
import { SAVE_DEBOUNCE_MS, STORAGE_KEY } from './types';
import { currentSlug, state, store } from './state';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveState(): void {
  if (currentSlug) {
    store.backends[currentSlug] = state;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function loadStore(): BackendTabsStore | null {
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

export function debouncedSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, SAVE_DEBOUNCE_MS);
}
