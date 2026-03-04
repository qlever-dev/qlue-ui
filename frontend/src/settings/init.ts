import type { Editor } from '../editor/init';
import type { UiSettings } from '../types/settings';
import { getInputByPath, handleClickEvents, setByPath, walk } from './utils';

export let settings: UiSettings = {
  general: {
    accessToken: '',
    uiMode: 'results',
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
  updateLanguageServer(editor);
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
          input.value = value === null ? '' : value;
          break;
      }
    },
    []
  );
}

function handleInput(editor: Editor) {
  const stringFields = ['accessToken', 'uiMode'];
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
            if (path[0] === 'results') updateResultsDisplay();
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
              newValue = parseInt(input.value);
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
      setByPath(settings, path, value);
    });
  }
}

function saveToLocalStorage() {
  localStorage.setItem('QLeverUI settings', JSON.stringify(settings));
}
