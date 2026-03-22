// NOTE: Template editor panel lifecycle — open/close, selector, and LS communication.

import * as monaco from 'monaco-editor';
import type { Editor } from '../editor/init';
import type { QlueLsServiceConfig } from '../types/backend';
import { applyPanelWidth, toggleWideMode } from '../buttons/wide_mode';
import { getCookie } from '../utils';

const DEBOUNCE_MS = 300;

const TEMPLATE_GROUPS: { label: string; keys: { key: string; display: string }[] }[] = [
  { label: 'Subject', keys: [{ key: 'subjectCompletion', display: 'Subject' }] },
  {
    label: 'Predicate',
    keys: [
      { key: 'predicateCompletionContextSensitive', display: 'Predicate (ctx)' },
      { key: 'predicateCompletionContextInsensitive', display: 'Predicate' },
    ],
  },
  {
    label: 'Object',
    keys: [
      { key: 'objectCompletionContextSensitive', display: 'Object (ctx)' },
      { key: 'objectCompletionContextInsensitive', display: 'Object' },
    ],
  },
  {
    label: 'Values',
    keys: [
      { key: 'valuesCompletionContextSensitive', display: 'Values (ctx)' },
      { key: 'valuesCompletionContextInsensitive', display: 'Values' },
    ],
  },
  { label: 'Hover', keys: [{ key: 'hover', display: 'Hover' }] },
];

// NOTE: Maps camelCase query keys (used by the language server) to snake_case API fields.
const CAMEL_TO_SNAKE: Record<string, string> = {
  subjectCompletion: 'subject_completion',
  predicateCompletionContextSensitive: 'predicate_completion_context_sensitive',
  predicateCompletionContextInsensitive: 'predicate_completion_context_insensitive',
  objectCompletionContextSensitive: 'object_completion_context_sensitive',
  objectCompletionContextInsensitive: 'object_completion_context_insensitive',
  valuesCompletionContextSensitive: 'values_completion_context_sensitive',
  valuesCompletionContextInsensitive: 'values_completion_context_insensitive',
  hover: 'hover',
};

let templateEditor: monaco.editor.IStandaloneCodeEditor | null = null;
let activeKey: string | null = null;
let currentConfig: QlueLsServiceConfig | null = null;
let debounceTimer: number | undefined;
let changeListener: monaco.IDisposable | null = null;

/** Registers the close/save buttons and backend-switch listener for the templates editor. */
export function setupTemplatesEditor(editor: Editor) {
  document.getElementById('templatePanelClose')!.addEventListener('click', () => {
    closeTemplatesEditor();
    editor.focus();
  });

  document.getElementById('templatePanelSave')!.addEventListener('click', () => {
    saveTemplates();
  });

  document.addEventListener('backend-selected', () => {
    if (templateEditor) {
      closeTemplatesEditor();
    }
  });
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

  // NOTE: Widen the parent container to make room for the template panel.
  applyPanelWidth();

  panel.classList.remove('hidden');
  panel.classList.add('flex');

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
        ? 'QleverUiThemeDark'
        : 'QleverUiThemeLight'
      : undefined,
  });

  buildSelector(editor);
  selectTemplate(TEMPLATE_GROUPS[0].keys[0].key, editor);
}

function buildSelector(editor: Editor) {
  const container = document.getElementById('templateSelector')!;
  container.innerHTML = '';

  TEMPLATE_GROUPS.forEach((group, groupIdx) => {
    if (groupIdx > 0) {
      const sep = document.createElement('div');
      sep.className = 'w-px bg-gray-300 dark:bg-gray-600 mx-0.5';
      container.appendChild(sep);
    }

    for (const { key, display } of group.keys) {
      const btn = document.createElement('button');
      btn.textContent = display;
      btn.dataset.templateKey = key;
      btn.className =
        'px-2 py-0.5 rounded cursor-pointer border border-gray-300 dark:border-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600';
      btn.addEventListener('click', () => {
        selectTemplate(key, editor);
      });
      container.appendChild(btn);
    }
  });
}

function selectTemplate(key: string, editor: Editor) {
  if (!currentConfig || !templateEditor) return;

  // NOTE: Save current editor content back before switching.
  if (activeKey && currentConfig.queries[activeKey] !== undefined) {
    currentConfig.queries[activeKey] = templateEditor.getValue();
  }

  activeKey = key;
  const value = currentConfig.queries[key] ?? '';
  templateEditor.setValue(value);

  // NOTE: Update selector button styles.
  const buttons = document.getElementById('templateSelector')!.querySelectorAll('button');
  for (const btn of buttons) {
    if ((btn as HTMLButtonElement).dataset.templateKey === key) {
      btn.className =
        'px-2 py-0.5 rounded cursor-pointer border border-green-600 bg-green-600 text-white';
    } else {
      btn.className =
        'px-2 py-0.5 rounded cursor-pointer border border-gray-300 dark:border-gray-500 hover:bg-gray-200 dark:hover:bg-gray-600';
    }
  }

  // NOTE: Re-register the change listener for instant apply.
  changeListener?.dispose();
  changeListener = templateEditor.onDidChangeModelContent(() => {
    clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => applyTemplate(editor), DEBOUNCE_MS);
  });
}

function applyTemplate(editor: Editor) {
  if (!currentConfig || !templateEditor || !activeKey) return;

  currentConfig.queries[activeKey] = templateEditor.getValue();

  editor.languageClient.sendNotification('qlueLs/addBackend', currentConfig).catch((err) => {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: { type: 'error', message: `Failed to apply template: ${err}`, duration: 3000 },
      })
    );
  });
}

function saveTemplates() {
  if (!currentConfig || !templateEditor || !activeKey) return;

  // NOTE: Flush current editor content into the active template.
  currentConfig.queries[activeKey] = templateEditor.getValue();

  const csrftoken = getCookie('csrftoken');
  if (csrftoken == null) {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: 'Missing CSRF token!<br>Log into the API to save templates.',
          duration: 3000,
        },
      })
    );
    return;
  }

  // NOTE: Convert camelCase query keys to snake_case for the API.
  const payload: Record<string, string> = {};
  for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE)) {
    if (currentConfig.queries[camel] !== undefined) {
      payload[snake] = currentConfig.queries[camel];
    }
  }

  fetch(`${import.meta.env.VITE_API_URL}/api/backends/${currentConfig.name}/templates`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrftoken,
    },
    body: JSON.stringify(payload),
  })
    .then((response) => {
      if (!response.ok) {
        let message = 'Templates could not be saved.';
        if (response.status === 403) {
          message = 'Missing permissions!<br>Log into the API to save templates.';
        }
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: { type: 'error', message, duration: 3000 },
          })
        );
      } else {
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

  // NOTE: Clear the editor container.
  document.getElementById('templateEditorContainer')!.innerHTML = '';

  // NOTE: Restore the container width (respects wide mode).
  toggleWideMode();

  // NOTE: Relayout Monaco after the panel closes.
  setTimeout(() => {
    (window as any).__editor?.editorApp.getEditor()?.layout();
  }, 50);
}
