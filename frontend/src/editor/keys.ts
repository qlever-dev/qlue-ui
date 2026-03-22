// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as monaco from 'monaco-editor';
import type { FormattingResult, JumpResult } from '../types/lsp_messages';
import type { Edit } from '../types/monaco';
import type { Editor } from './init';
import { settings } from '../settings/init';
import { toMonacoRange } from './utils';
import { openCommandPrompt } from '../commands/utils';
import { openSettings } from '../settings/utils';
import { closeAllModals } from '../keybindings';

export function setup_key_bindings(editor: Editor) {
  const monacoEditor = editor.editorApp.getEditor()!;

  // NOTE: execute query on Ctrl + Enter
  monacoEditor.addAction({
    id: 'Execute Query',
    label: 'Execute',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.5,
    run() {
      window.dispatchEvent(new Event('cancel-or-execute'));
    },
  });

  // NOTE: format on Ctrl + f
  monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
    monacoEditor.getAction('editor.action.formatDocument')!.run();
  });

  // NOTE: override Ctrl + P (disables Monaco's Quick Open) with custom command line
  monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
    openCommandPrompt();
  });

  // NOTE: open settings  on Ctrl + ,
  monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Comma, () => {
    closeAllModals();
    openSettings();
  });

  // NOTE: jump forward on TAB and backward on Shift + TAB
  monaco.editor.addKeybindingRule({
    command: 'jumpToNextPosition',
    commandArgs: 'next',
    keybinding: monaco.KeyCode.Tab,
    when: '!inSnippetMode && editorTextFocus',
  });
  monaco.editor.addKeybindingRule({
    command: 'jumpToNextPosition',
    commandArgs: 'prev',
    keybinding: monaco.KeyMod.Shift | monaco.KeyCode.Tab,
    when: '!inSnippetMode && editorTextFocus',
  });

  // NOTE:jump to next or prev position
  monaco.editor.addCommand({
    id: 'jumpToNextPosition',
    run: (_get, args) => {
      if (!settings.editor.jumpWithTab) return;
      // NOTE: Format document
      editor.languageClient
        .sendRequest('textDocument/formatting', {
          textDocument: { uri: editor.getDocumentUri() },
          options: {
            tabSize: 2,
            insertSpaces: true,
          },
        })
        .then((response) => {
          const jumpResult = response as FormattingResult;
          const edits: Edit[] = jumpResult.map((edit) => ({
            range: toMonacoRange(edit.range),
            text: edit.newText,
          }));
          monacoEditor.getModel()!.applyEdits(edits);

          // NOTE: request jump position
          const cursorPosition = monacoEditor.getPosition()!;
          editor.languageClient
            .sendRequest('qlueLs/jump', {
              textDocument: { uri: editor.getDocumentUri() },
              position: {
                line: cursorPosition.lineNumber - 1,
                character: cursorPosition.column - 1,
              },
              previous: args === 'prev',
            })
            .then((response) => {
              // NOTE: move cursor
              if (response) {
                const typedResponse = response as JumpResult;
                const newCursorPosition = {
                  lineNumber: typedResponse.position.line + 1,
                  column: typedResponse.position.character + 1,
                };
                if (typedResponse.insertAfter) {
                  monacoEditor.executeEdits('jumpToNextPosition', [
                    {
                      range: new monaco.Range(
                        newCursorPosition.lineNumber,
                        newCursorPosition.column,
                        newCursorPosition.lineNumber,
                        newCursorPosition.column
                      ),
                      text: typedResponse.insertAfter,
                    },
                  ]);
                }
                monacoEditor.setPosition(newCursorPosition, 'jumpToNextPosition');
                if (typedResponse.insertBefore) {
                  monacoEditor.getModel()?.applyEdits([
                    {
                      range: new monaco.Range(
                        newCursorPosition.lineNumber,
                        newCursorPosition.column,
                        newCursorPosition.lineNumber,
                        newCursorPosition.column
                      ),
                      text: typedResponse.insertBefore,
                    },
                  ]);
                }
              }
            });
        });
      monacoEditor.trigger('jumpToNextPosition', 'editor.action.formatDocument', {});
    },
  });
}
