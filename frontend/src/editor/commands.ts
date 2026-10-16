// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import * as monaco from 'monaco-editor';
import { triggerCompletion } from './completion';
import type { Editor } from './init';

export function setup_commands(_editor: Editor) {
  monaco.editor.addCommand({
    id: 'triggerNewCompletion',
    run: () => {
      triggerCompletion();
    },
  });
}
