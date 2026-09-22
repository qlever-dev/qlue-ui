// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import './toast';
import { configureBackends } from './backend/backends';
import { setupButtons } from './buttons/init';
import { setupThemeSwitcher } from './buttons/theme_switcher';
import { setupWideMode } from './buttons/wide_mode';
import { setupCommands } from './commands/init';
import { endpointAvailability } from './connection';
import { setupEditor } from './editor/init';
import { setupExamples } from './examples/init';
import { setupKeybindings } from './keybindings';
import { setupParseTree } from './parse_tree/init';
import { setupQueryExecutionTree } from './query_execution_tree/init';
import { handleRequestParameter, setupUrlSync } from './request_params';
import { setupResults } from './results/init';
import { setupSettings } from './settings/init';
import { setupShare } from './share/init';
import { setupTabs } from './tabs/init';
import { setupTemplatesEditor } from './templates/init';
import { setupCompletionRuns } from './templates/runs';
import { initDone, initStep } from './timing';
import { removeLoadingScreen, showCommitHash } from './utils';

initStep('load bundle');
showCommitHash();
setupThemeSwitcher();
setupWideMode();
setupEditor('editor').then(async (editor) => {
  // INFO: Expose editor for e2e test access via page.evaluate().
  window.__editor = editor;
  setupTabs(editor);
  setupSettings(editor);
  setupQueryExecutionTree(editor);
  setupExamples(editor);
  setupResults(editor);
  setupButtons(editor);
  setupShare(editor);
  setupKeybindings();
  setupCommands(editor);
  setupParseTree(editor);
  setupTemplatesEditor(editor);
  setupCompletionRuns(editor);
  endpointAvailability(editor);
  initStep('setup ui modules');
  await configureBackends(editor);
  initStep('configure backends');
  setupUrlSync(editor);
  handleRequestParameter(editor);
  initStep('handle request parameters');

  await removeLoadingScreen();
  initDone();
});
