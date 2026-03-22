import { closeExamples } from './examples/utils';
import { closeHelp, openHelp } from './buttons/help';
import { closeSettings, openSettings } from './settings/utils';
import { closeShare } from './share';
import { closeDatasetInformation } from './buttons/dataset_information';
import { closeCommandPrompt, openCommandPrompt } from './commands/utils';

type Shortcut = {
  ctrl?: boolean; // true if Ctrl must be pressed
  meta?: boolean; // true if ⌘ must be pressed
  shift?: boolean; // true if Shift must be pressed
  alt?: boolean; // true if Alt must be pressed
  key: string; // The key to listen for, e.g., ',' or '?'
};

type ShortcutHandler = (event: KeyboardEvent) => void;

/**
 * Registers global keyboard shortcuts for the UI shell (outside the editor).
 *
 * These shortcuts only fire when focus is **not** on an input, textarea, or
 * the Monaco editor. Editor-specific keybindings are managed separately in
 * `editor/keys.ts`.
 * This introduces some code duplication.
 */
export function setupKeybindings() {
  registerShortcut({ key: '?' }, () => {
    closeAllModals();
    openHelp();
  });
  registerShortcut({ shift: true, key: '?' }, () => {
    console.log('open help');
    closeAllModals();
    openHelp();
  });
  registerShortcut({ ctrl: true, key: ',' }, () => {
    closeAllModals();
    openSettings();
  });
  registerShortcut({ ctrl: true, key: 'Enter' }, () => {
    closeAllModals();
    window.dispatchEvent(new Event('cancel-or-execute'));
  });
  registerShortcut({ key: 'Escape' }, () => closeAllModals());
  registerShortcut({ shift: true, key: ':' }, () => openCommandPrompt());
  registerShortcut({ ctrl: true, key: 'p' }, () => openCommandPrompt());
}

function registerShortcut(shortcut: Shortcut, handler: ShortcutHandler) {
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    // NOTE: Ignore when user is tying in inputs
    if (
      target.isContentEditable ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.role === 'textbox'
    )
      return;
    const modifierMatch =
      (shortcut.ctrl ?? false) === event.ctrlKey &&
      (shortcut.meta ?? false) === event.metaKey &&
      (shortcut.shift ?? false) === event.shiftKey &&
      (shortcut.alt ?? false) === event.altKey;
    if (modifierMatch && event.key === shortcut.key) {
      event.preventDefault();
      handler(event);
    }
  });
}

export function closeAllModals() {
  closeHelp();
  closeSettings();
  closeExamples();
  closeShare();
  closeDatasetInformation();
  closeCommandPrompt();
}
