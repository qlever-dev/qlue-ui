export function setupHelp() {
  const helpButton = document.getElementById('helpButton')!;
  const helpModal = document.getElementById('helpModal')!;
  const helpContainer = document.getElementById('helpContainer')!;

  helpModal.addEventListener('click', () => {
    closeHelp();
  });

  helpButton.addEventListener('click', () => {
    openHelp();
  });

  helpContainer.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  if (detectOS() === 'mac') {
    helpContainer.querySelectorAll('.modkey').forEach((kbd) => {
      kbd.textContent = '⌘';
    });
  }
}

export function openHelp() {
  const helpModal = document.getElementById('helpModal')!;
  helpModal.classList.remove('hidden');
}

export function closeHelp() {
  const helpModal = document.getElementById('helpModal')!;
  helpModal.classList.add('hidden');
}

function detectOS() {
  // Fallback
  return navigator.platform.toLowerCase().includes('mac')
    ? 'mac'
    : navigator.platform.toLowerCase().includes('win')
      ? 'windows'
      : navigator.platform.toLowerCase().includes('linux')
        ? 'linux'
        : 'unknown';
}
