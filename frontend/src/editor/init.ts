// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import './style.css';
import * as monaco from 'monaco-editor';
import type { MonacoLanguageClient } from 'monaco-languageclient';
import { EditorApp } from 'monaco-languageclient/editorApp';
import { LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';
import { MonacoVscodeApiWrapper } from 'monaco-languageclient/vscodeApiWrapper';
import { initStep } from '../timing';
import { setup_commands } from './commands';
import { setupCompletion } from './completion';
import { buildWrapperConfig } from './config/config';
import { setup_key_bindings } from './keys';

/**
 * Wrapper around the Monaco editor and its LSP language client.
 *
 * Provides a simplified interface for reading and writing editor content,
 * managing focus, and communicating with the Qlue-ls language server.
 */
export interface Editor {
  editorApp: EditorApp;
  languageClient: MonacoLanguageClient;
  getContent(): string;
  setContent(content: string): void;
  focus(): void;
  getDocumentUri(): string;
}

/**
 * Initializes the Monaco editor with Qlue-ls language client support.
 *
 * Creates the VSCode API wrapper, starts the language client (WASM web worker),
 * mounts the editor into the given container, and wires up keybindings,
 * commands, and theme switching.
 */
export async function setupEditor(container_id: string): Promise<Editor> {
  const editorContainer = document.getElementById(container_id);
  if (editorContainer) {
    const configs = await buildWrapperConfig(``);
    initStep('build wrapper config');
    // NOTE: Create the monaco-vscode api Wrapper and start it before anything else.
    const apiWrapper = new MonacoVscodeApiWrapper(configs.vscodeApiConfig);
    await apiWrapper.start();
    initStep('start monaco-vscode api');

    // NOTE: Create language client wrapper.
    const lcWrapper = new LanguageClientWrapper(configs.languageClientConfig);
    await lcWrapper.start();
    const languageClient = lcWrapper.getLanguageClient()!;
    initStep('start language client (qlue-ls wasm)');

    // NOTE: Create and start the editor app.
    const editorApp = new EditorApp(configs.editorAppConfig);

    const editor: Editor = {
      editorApp: editorApp,
      languageClient: languageClient,
      getContent(): string {
        return this.editorApp.getEditor()?.getValue() ?? '';
      },
      setContent(content: string) {
        this.editorApp.getEditor()?.setValue(content);
      },
      focus() {
        this.editorApp.getEditor()!.focus();
      },
      getDocumentUri() {
        return this.editorApp.getEditor()!.getModel()!.uri.toString();
      },
    };

    await editor.editorApp.start(editorContainer);
    initStep('mount editor');

    setup_key_bindings(editor);
    setup_commands(editor);
    // NOTE: after the keybindings, so the completion Tab rule wins over the jump rule.
    const completion = setupCompletion(editor);
    setup_toggle_theme();

    // NOTE: Initially focus the editor.
    editorApp.getEditor()!.focus();

    // NOTE: Re-layout the editor when the editor area is resized.
    const editorArea = document.getElementById('editorArea');
    if (editorArea) {
      new ResizeObserver(() => {
        editorApp.getEditor()!.layout();
      }).observe(editorArea);
    }

    // NOTE: Dismiss fixed overflow widgets on page scroll.
    // fixedOverflowWidgets uses position:fixed to prevent clipping by
    // overflow:hidden containers, but fixed elements don't move with the page.
    // Only react to scroll events outside the editor to avoid interfering
    // with Monaco's internal scroll events (which fire during rendering
    // and would dismiss the suggest widget on every other keystroke).
    const monacoEditor = editorApp.getEditor()!;
    document.addEventListener(
      'scroll',
      (e) => {
        if (editorContainer.contains(e.target as Node)) return;
        completion.hide();
        monacoEditor.trigger('scroll', 'editor.action.hideHover', {});
      },
      { passive: true, capture: true }
    );

    return editor;
  } else {
    throw new Error(`No element with id: "${container_id}" found`);
  }
}

function setup_toggle_theme() {
  // Check current theme & add event listener.
  const themeSwitch = document.getElementById('theme-switch')! as HTMLInputElement;
  const set_editor_theme = () => {
    if (themeSwitch.checked) {
      monaco.editor.setTheme('QlueUiThemeDark');
    } else {
      monaco.editor.setTheme('QlueUiThemeLight');
    }
  };
  set_editor_theme();
  themeSwitch.addEventListener('change', set_editor_theme);
}
