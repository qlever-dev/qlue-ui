import type { Editor } from '../editor/init';
import { clearCache } from '../buttons/clear_cache';
import { executeQuery } from '../buttons/execute';
import { formatDocument } from '../buttons/format';
import { openExamples } from '../examples/utils';
import { openParseTree } from '../parse_tree/init';
import { openQueryExecutionTree } from '../query_execution_tree/init';
import { openTemplatesEditor } from '../templates/init';
import { toggleWideMode } from '../buttons/wide_mode';
import { displayVersion } from '../utils';
import { closeCommandPrompt, handleClickEvents } from './utils';
import { createExample, updateExample } from './examples';
import {
  setupCommandCompletions,
  handleKey as completionsHandleKey,
  hide as completionsHide,
  show as completionsShow,
} from './completions';

type CommandHandler = (editor: Editor, params: string[]) => void;
export interface Command {
  handler: CommandHandler;
  description: string;
}
const commands: Record<string, Command> = {};

/** Initializes the vim-style command prompt (`:command`) with built-in commands. */
export function setupCommands(editor: Editor) {
  handleClickEvents();
  registerCommand('execute', executeQuery, 'Run the current query');
  registerCommand('format', formatDocument, 'Format the editor content');
  registerCommand('examples', openExamples, 'Browse query examples');
  registerCommand('createExample', createExample, 'Save current query as example');
  registerCommand('updateExample', updateExample, 'Update the loaded example');
  registerCommand('parseTree', openParseTree, 'Show the SPARQL parse tree');
  registerCommand('analysis', openQueryExecutionTree, 'Show the query execution tree');
  registerCommand('templates', openTemplatesEditor, 'Edit prefix templates');
  registerCommand('clearCache', clearCache, 'Clear the language server cache');
  registerCommand('toggleWideMode', toggleWideMode, 'Toggle wide editor layout');
  registerCommand('version', displayVersion, 'Show the build version');

  const commandPrompt = document.getElementById('commandPrompt')! as HTMLInputElement;

  setupCommandCompletions(commandPrompt, commands, (name: string) => {
    commands[name].handler(editor, []);
    closeCommandPrompt();
    completionsHide();
    setTimeout(() => editor.focus(), 50);
  });

  commandPrompt.addEventListener('keydown', (event: KeyboardEvent) => {
    // Completions get first priority
    if (completionsHandleKey(event)) return;

    if (event.key === 'Enter') {
      const input = commandPrompt.value;
      if (input === '') return;
      const [command, ...params] = parseInput(input);
      if (command in commands) {
        commands[command].handler(editor, params);
        closeCommandPrompt();
        completionsHide();
        setTimeout(() => editor.focus(), 50);
      } else {
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: {
              type: 'error',
              message: 'Unknown command: ' + command,
              duration: 3000,
            },
          })
        );
      }
    } else if (event.key === 'Escape') {
      closeCommandPrompt();
      completionsHide();
    }
  });

  // Show completions when the prompt is opened (focused)
  commandPrompt.addEventListener('focus', () => {
    completionsShow();
  });
}

/** Splits input into command name + quoted arguments. Unquoted words are kept as-is. */
function parseInput(input: string): string[] {
  const tokens: string[] = [];
  const regex = /"([^"]*)"|\S+/g;
  let match;
  while ((match = regex.exec(input)) !== null) {
    tokens.push(match[1] ?? match[0]);
  }
  return tokens;
}

function registerCommand(name: string, handler: CommandHandler, description: string) {
  commands[name] = { handler, description };
}
