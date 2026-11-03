// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as monaco from 'monaco-editor';
import type { Editor } from '../init';
import { CompletionController } from './controller';

let controller: CompletionController | undefined;

/** Replaces Monaco's suggest widget with our own completion popup. */
export function setupCompletion(editor: Editor): CompletionController {
  controller = new CompletionController(editor);

  // NOTE: Monaco's own trigger is unbound in `keys.ts`; this replaces it.
  monaco.editor.addCommand({
    id: 'qlue.triggerCompletion',
    run: () => controller?.trigger(),
  });
  // NOTE: `WinCtrl` is the physical Ctrl key, which is what Monaco binds its own
  // trigger to when it believes it runs on macOS — including under Playwright's
  // WebKit, whose user agent says "Macintosh".
  for (const keybinding of [
    monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
    monaco.KeyMod.WinCtrl | monaco.KeyCode.Space,
  ]) {
    monaco.editor.addKeybindingRule({
      command: 'qlue.triggerCompletion',
      keybinding,
      when: 'editorTextFocus && !editorReadonly',
    });
  }

  return controller;
}

/** Hides the completion popup, if one is open. */
export function hideCompletion() {
  controller?.hide();
}

/** Requests completions at the current cursor position. */
export function triggerCompletion() {
  controller?.trigger();
}
