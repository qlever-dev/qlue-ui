// NOTE: Centralized container-width management.
// All xl:w-* class changes on #mainContainer go through these helpers
// to avoid conflicts between wide mode and side-panel open/close.

const ORIGINAL_XL_WIDTH = 'xl:w-[72rem]';
const WIDE_XL_WIDTH = 'xl:w-[96%]';
const PANEL_XL_WIDTH = 'xl:w-full';
const ALL_XL_WIDTHS = [ORIGINAL_XL_WIDTH, WIDE_XL_WIDTH, PANEL_XL_WIDTH];
const STORAGE_KEY = 'wideMode';

let wideMode = false;

export function isWideMode(): boolean {
  return wideMode;
}

/** Sets the container to the correct xl width based on wide-mode state. */
export function applyContainerWidth() {
  const container = document.getElementById('mainContainer')!;
  container.classList.remove(...ALL_XL_WIDTHS);
  container.classList.add(wideMode ? WIDE_XL_WIDTH : ORIGINAL_XL_WIDTH);
}

/** Sets the container to full width for side panels. */
export function applyPanelWidth() {
  wideMode = true;
  applyContainerWidth();
  updateButtonIcon(wideMode);
}

function updateButtonIcon(active: boolean) {
  document.getElementById('wide-mode-expand')!.classList.toggle('hidden', active);
  document.getElementById('wide-mode-collapse')!.classList.toggle('hidden', !active);
}

export function setupWideMode() {
  wideMode = localStorage.getItem(STORAGE_KEY) === 'true';
  const button = document.getElementById('wide-mode-switch')!;

  if (wideMode) {
    applyContainerWidth();
    button.classList.add('text-green-600', 'dark:text-green-400');
    updateButtonIcon(true);
  }

  button.addEventListener('click', () => {
    wideMode = !wideMode;
    localStorage.setItem(STORAGE_KEY, String(wideMode));
    applyContainerWidth();
    button.classList.toggle('text-green-600', wideMode);
    button.classList.toggle('dark:text-green-400', wideMode);
    updateButtonIcon(wideMode);

    // NOTE: Relayout Monaco after width change.
    setTimeout(() => {
      (window as any).__editor?.editorApp.getEditor()?.layout();
    }, 50);
  });
}

export function toggleWideMode() {
  document.getElementById('wide-mode-switch')!.click();
}
