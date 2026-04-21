// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { Editor } from '../editor/init';
import type { TabState } from './types';
import { closeTab, createTab, renameTab, switchTab } from './operations';
import { state, tabBar, tabQueryStatus } from './state';

export function renderTabBar(editor: Editor): void {
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
