// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import { Uri } from 'monaco-editor';
import editorWorkerUrl from 'monaco-editor/esm/vs/editor/editor.worker?worker&url';
import type { EditorAppConfig } from 'monaco-languageclient/editorApp';
import { type LanguageClientConfig, LcWorker } from 'monaco-languageclient/lcwrapper';
import type { MonacoVscodeApiConfig } from 'monaco-languageclient/vscodeApiWrapper';
import {
  useWorkerFactory,
  Worker as WorkerDescriptor,
  type WorkerLoader,
} from 'monaco-languageclient/workerFactory';
import { initStep } from '../../timing';
import languageServerWorkerUrl from './languageServer.worker?worker&url';
import sparqlLanguageConfig from './sparql.configuration.json?raw';
import sparqlThemeDark from './sparql.theme.dark.json?raw';
import sparqlThemeLight from './sparql.theme.light.json?raw';

export function buildWrapperConfig(initial: string) {
  const workerLoaders: Partial<Record<string, WorkerLoader>> = {
    editorWorkerService: () => new WorkerDescriptor(editorWorkerUrl, { type: 'module' }),
  };
  const extensionFilesOrContents = new Map<string, string | URL>();
  extensionFilesOrContents.set('/sparql-configuration.json', sparqlLanguageConfig);
  extensionFilesOrContents.set('/sparql-theme-light.json', sparqlThemeLight);
  extensionFilesOrContents.set('/sparql-theme-dark.json', sparqlThemeDark);

  // Monaco VSCode API configuration
  const vscodeApiConfig: MonacoVscodeApiConfig = {
    $type: 'extended',
    viewsConfig: {
      $type: 'EditorService',
    },
    userConfiguration: {
      json: JSON.stringify({
        'workbench.colorTheme': 'QlueUiThemeDark',
        'editor.semanticHighlighting.enabled': true,
        'editor.tabSize': 2,
        'files.eol': '\n',
      }),
    },
    monacoWorkerFactory: () => {
      useWorkerFactory({ workerLoaders });
    },
    extensions: [
      {
        config: {
          name: 'langium-sparql',
          publisher: 'Ioannis Nezis',
          version: '1.0.0',
          engines: {
            vscode: '*',
          },
          contributes: {
            languages: [
              {
                id: 'sparql',
                extensions: ['.rq'],
                aliases: ['sparql', 'SPARQL'],
                configuration: '/sparql-configuration.json',
              },
            ],
            themes: [
              {
                id: 'QlueUiThemeLight',
                label: 'Qlue-UI Custom Theme Light',
                uiTheme: 'vs',
                path: './sparql-theme-light.json',
              },
              {
                id: 'QlueUiThemeDark',
                label: 'Qlue-UI Custom Theme Dark',
                uiTheme: 'vs-dark',
                path: './sparql-theme-dark.json',
              },
            ],
          },
        },
        filesOrContents: extensionFilesOrContents,
      },
    ],
  };

  // Language client configuration
  const languageClientConfig: LanguageClientConfig = {
    languageId: 'sparql',
    clientOptions: {
      documentSelector: [{ language: 'sparql' }],
      workspaceFolder: {
        index: 0,
        name: 'workspace',
        uri: Uri.parse('file:/'),
      },
      progressOnInitialization: true,
      diagnosticPullOptions: {
        onChange: true,
        onSave: false,
      },
    },
    connection: {
      options: {
        $family: 'Worker',
        realization: () => new LcWorker(),
        workerUrl: new URL(languageServerWorkerUrl, import.meta.url),
        type: 'module',
        workerName: 'Language Server',
      },
      retryConfig: {
        retries: 5,
        timeout: 1000,
        disposeOnRestart: true,
      },
    },
  };

  // editor app / monaco-editor configuration
  const editorAppConfig: EditorAppConfig = {
    codeResources: {
      modified: {
        uri: 'query.rq',
        text: initial,
      },
    },
    editorOptions: {
      tabCompletion: 'on',
      formatOnType: true,
      suggestOnTriggerCharacters: true,
      // NOTE: Pin the pre-v37 default; "offWhenInlineCompletions" delays quick suggestions
      // and leaks disposables (DisposableStore warning) on every trigger.
      quickSuggestions: {
        other: 'on',
        comments: 'off',
        strings: 'off',
      },
      quickSuggestionsDelay: 100,
      fontSize: 14,
      fontFamily: 'Source Code Pro',
      detectIndentation: false,
      insertSpaces: true,
      links: false,
      minimap: {
        enabled: false,
      },
      overviewRulerLanes: 0,
      scrollBeyondLastLine: false,
      scrollbar: {
        alwaysConsumeMouseWheel: false,
      },
      padding: {
        top: 8,
        bottom: 8,
      },
      lineDecorationsWidth: 0,
      lineNumbersMinChars: 2,
      glyphMargin: true,
      contextmenu: false,
      folding: true,
      foldingImportsByDefault: false,
      wordBasedSuggestions: 'off',
      snippetSuggestions: 'bottom',
      suggest: {
        filterGraceful: false,
        localityBonus: false,
        shareSuggestSelections: false,
        showWords: false,
      },
      autoIndent: 'none',
      guides: {
        bracketPairsHorizontal: 'active',
      },
      fixedOverflowWidgets: true,
    },
  };
  return {
    vscodeApiConfig: vscodeApiConfig,
    languageClientConfig: languageClientConfig,
    editorAppConfig: editorAppConfig,
  };
}

/**
 * Resolves once the language server worker has instantiated the qlue-ls wasm,
 * and shows a toast if the language server crashes later on.
 */
export function waitForLanguageServer(worker: Worker): Promise<void> {
  worker.addEventListener('message', (e) => {
    if (e.data.type === 'crash') {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: 'error',
            message:
              'Language Server Crashed!<br> Please restart the application.<br><br> If you can reproduce this,<br> please open a github issue :)',
          },
        })
      );
    }
  });
  return new Promise((resolve) => {
    // NOTE: Use addEventListener, the language client's message reader owns worker.onmessage.
    worker.addEventListener('message', (event) => {
      if (event.data.type === 'booting') {
        initStep('load language server worker script');
      }
      if (event.data.type === 'ready') {
        initStep('load + instantiate qlue-ls wasm');
        resolve();
      }
    });
  });
}
