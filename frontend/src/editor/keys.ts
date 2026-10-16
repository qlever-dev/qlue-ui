// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as monaco from 'monaco-editor';
import { openCommandPrompt } from '../commands/utils';
import { closeAllModals } from '../keybindings';
import { settings } from '../settings/init';
import { openSettings } from '../settings/utils';
import type { JumpResult } from '../types/lsp_messages';
import type { Edit } from '../types/monaco';
import type { Editor } from './init';
import { toMonacoRange } from './utils';

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

  // NOTE: bind the quick fix (action) widget to both Ctrl + . and Ctrl + Shift + .
  //       Firefox 150+ on Linux claims Ctrl + . for the GTK emoji picker, so
  //       Ctrl + Shift + . is offered as a fallback.
  monaco.editor.addKeybindingRule({
    command: 'editor.action.quickFix',
    keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Period,
    when: 'editorHasCodeActionsProvider && editorTextFocus && !editorReadonly',
  });
  monaco.editor.addKeybindingRule({
    command: 'editor.action.quickFix',
    keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Period,
    when: 'editorHasCodeActionsProvider && editorTextFocus && !editorReadonly',
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

  // NOTE: unbind every chord Monaco's suggest trigger holds; the custom
  //       completion widget rebinds Ctrl + Space to its own trigger in
  //       `completion/index.ts`. The `WinCtrl` variant is the one Monaco uses
  //       on macOS, so leaving it bound surfaced the built-in widget there.
  for (const keybinding of [
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
    monaco.KeyMod.WinCtrl | monaco.KeyCode.Space,
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI,
  ]) {
    monaco.editor.addKeybindingRule({ command: null, keybinding });
  }

  // NOTE:jump to next or prev position
  monaco.editor.addCommand({
    id: 'jumpToNextPosition',
    run: (_get, args) => {
      if (!settings.editor.jumpWithTab) {
        // NOTE: fall back to default Tab / Shift + Tab behavior
        monacoEditor.trigger('jumpToNextPosition', args === 'prev' ? 'outdent' : 'tab', null);
        return;
      }
      // NOTE: the server formats the document, computes the jump target on the
      //       formatted document and returns the edits + final cursor position
      const cursorPosition = monacoEditor.getPosition()!;
      editor.languageClient
        .sendRequest('qlueLs/jump', {
          textDocument: { uri: editor.getDocumentUri() },
          position: {
            line: cursorPosition.lineNumber - 1,
            character: cursorPosition.column - 1,
          },
          previous: args === 'prev',
          options: {
            tabSize: 2,
            insertSpaces: true,
          },
        })
        .then((response) => {
          if (!response) {
            return;
          }
          const jumpResult = response as JumpResult;
          const edits: Edit[] = jumpResult.edits.map((edit) => ({
            range: toMonacoRange(edit.range),
            text: edit.newText,
          }));
          monacoEditor.executeEdits('jumpToNextPosition', edits);
          if (jumpResult.position) {
            monacoEditor.setPosition(
              {
                lineNumber: jumpResult.position.line + 1,
                column: jumpResult.position.character + 1,
              },
              'jumpToNextPosition'
            );
          }
        });
    },
  });
}
