export function handleClickEvents() {
  const settingsButton = document.getElementById('settingsButton')!;
  const settingsModal = document.getElementById('settingsModal')!;
  const settingsContainer = document.getElementById('settingsContainer')!;

  settingsModal.addEventListener('click', () => {
    closeSettings();
  });

  settingsButton.addEventListener('click', () => {
    openSettings();
  });

  settingsContainer.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

export function openSettings() {
  const settingsModal = document.getElementById('settingsModal')!;
  settingsModal.classList.remove('hidden');
  // NOTE: remove focus from monaco editor
  document.getElementById("settings-general-accessToken")!.focus();
  document.getElementById("settings-general-accessToken")!.blur();
}

export function closeSettings() {
  const settingsModal = document.getElementById('settingsModal')!;
  settingsModal.classList.add('hidden');
}

export function walk(obj: any, fn: (path: string[], value: any) => void, path: string[] = []) {
  if (typeof obj !== 'object' || obj === null) return fn(path, obj);
  for (const [k, v] of Object.entries(obj)) walk(v, fn, [...path, k]);
}

export function getInputByPath(path: string[]): HTMLInputElement {
  return document.getElementById(['settings', ...path].join('-'))! as HTMLInputElement;
}

export function setByPath(obj: Record<string, any>, path: string[], value: unknown) {
  let current: any = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {};
    }
    current = current[key];
  }
  current[path[path.length - 1]] = value;
}
