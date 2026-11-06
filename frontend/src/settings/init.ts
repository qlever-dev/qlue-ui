import type { Editor } from '../editor/init';
import type { UiSettings } from '../types/settings';
import { getInputByPath, handleClickEvents, hasPath, setByPath, walk } from './utils';

export const settings: UiSettings = {
  general: {
    accessToken: '',
    uiToken: '',
    clearCacheBeforeExecute: false,
  },
  editor: {
    format: {
      alignPrefixes: false,
      alignPredicates: true,
      capitalizeKeywords: true,
      filterSameLine: true,
      separatePrologue: false,
      whereNewLine: false,
      insertSpaces: true,
      contractTriples: false,
      keepEmptyLines: false,
      tabSize: 2,
      compact: null,
      lineLength: 120,
    },
    completion: {
      timeoutMs: 5_000,
      resultSizeLimit: 101,
      subjectCompletionTriggerLength: 3,
      objectCompletionSuffix: true,
      sameSubjectSemicolon: true,
      variableCompletionLimit: 10,
    },
    prefixes: {
      addMissing: true,
      removeUnused: false,
    },
    jumpWithTab: false,
    autoLineBreak: false,
  },
  results: {
    typeAnnotations: true,
    langAnnotations: true,
    loadImages: true,
    shortenIris: true,
    limit: 100,
  },
};

/**
 * Initializes the settings panel by binding DOM inputs to the {@link settings}
 * object, restoring values from localStorage, and syncing editor-related
 * settings with the language server.
 */
export function setupSettings(editor: Editor) {
  handleClickEvents();
  handleInput(editor);
  loadFromLocalStorage();
  updateDom();
  updateGeneralDisplay();
  updateLanguageServer(editor);
}

/** Single writer for the Qlue-UI token — keeps state, storage and DOM in sync. */
export function setUiToken(token: string) {
  settings.general.uiToken = token;
  saveToLocalStorage();
  getInputByPath(['general', 'uiToken']).value = token;
}

/** Single writer for "clear cache before every query" — keeps state, storage and DOM in sync. */
export function setClearCacheBeforeExecute(value: boolean) {
  settings.general.clearCacheBeforeExecute = value;
  saveToLocalStorage();
  getInputByPath(['general', 'clearCacheBeforeExecute']).checked = value;
  updateGeneralDisplay();
}

function updateLanguageServer(editor: Editor) {
  editor.languageClient.sendNotification('qlueLs/changeSettings', settings.editor).catch((err) => {
    console.error('Error during changeSettings: ', err);
  });
}

function updateDom() {
  walk(
    settings,
    (path, value) => {
      const input = getInputByPath(path);
      switch (typeof value) {
        case 'boolean':
          input.checked = value;
          break;
        default:
          input.value = value === null ? '' : String(value);
          break;
      }
    },
    []
  );
}

function handleInput(editor: Editor) {
  const stringFields = ['accessToken', 'uiToken'];
  const nullableFields = ['compact', 'variableCompletionLimit'];
  walk(
    settings,
    (path, value) => {
      const input = getInputByPath(path);
      const fieldName = path[path.length - 1];
      switch (typeof value) {
        case 'boolean':
          input.addEventListener('input', () => {
            setByPath(settings, path, input.checked);
            saveToLocalStorage();
            if (path[0] === 'editor') updateLanguageServer(editor);
            else if (path[0] === 'results') updateResultsDisplay();
            else if (path[0] === 'general') updateGeneralDisplay();
          });
          break;
        default:
          input.addEventListener('input', () => {
            let newValue: string | number | null;
            if (input.value === '') {
              if (!nullableFields.includes(fieldName)) return;
              newValue = null;
            } else if (stringFields.includes(fieldName)) {
              newValue = input.value;
            } else {
              newValue = parseInt(input.value, 10);
            }
            setByPath(settings, path, newValue);
            saveToLocalStorage();
            if (path[0] === 'editor') updateLanguageServer(editor);
            if (path[0] === 'results') updateResultsDisplay();
          });
          break;
      }
    },
    []
  );
}

function updateGeneralDisplay() {
  const clearCachePinButton = document.getElementById('clearCachePinButton')! as HTMLButtonElement;
  clearCachePinButton.ariaPressed = String(settings.general.clearCacheBeforeExecute);
  clearCachePinButton.title = settings.general.clearCacheBeforeExecute
    ? 'Unpin: stop clearing before every query'
    : 'Pin: clear before every query';
}

function updateResultsDisplay() {
  document.querySelectorAll('.type-tag').forEach((el) => {
    el.classList.toggle('hidden', !settings.results.typeAnnotations);
  });
  document.querySelectorAll('.lang-tag').forEach((el) => {
    el.classList.toggle('hidden', !settings.results.langAnnotations);
  });
  document.querySelectorAll('.iri-short').forEach((el) => {
    el.classList.toggle('hidden', !settings.results.shortenIris);
  });
  document.querySelectorAll('.iri-full').forEach((el) => {
    el.classList.toggle('hidden', settings.results.shortenIris);
  });
}

function loadFromLocalStorage() {
  const storedQlueLsSettings = localStorage.getItem('QLeverUI settings');
  if (storedQlueLsSettings) {
    const newSettings = JSON.parse(storedQlueLsSettings);
    walk(newSettings, (path, value) => {
      // Ignore stored keys that no longer exist (e.g. removed settings),
      // otherwise updateDom would look up a missing DOM input and crash.
      if (hasPath(settings, path)) {
        setByPath(settings, path, value);
      }
    });
  }
}

function saveToLocalStorage() {
  localStorage.setItem('QLeverUI settings', JSON.stringify(settings));
}
