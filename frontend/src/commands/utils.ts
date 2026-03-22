export function handleClickEvents() {
  const commandModal = document.getElementById('commandPromptModal')!;
  const commandPrompt = document.getElementById('commandPrompt')!;
  commandModal.addEventListener('click', () => {
    closeCommandPrompt();
  });

  commandPrompt.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

export function openCommandPrompt() {
  const commandPromptModal = document.getElementById('commandPromptModal')!;
  clearCommandPrompt();
  commandPromptModal.classList.remove('hidden');
  const commandPrompt = document.getElementById('commandPrompt')! as HTMLInputElement;
  commandPrompt.focus();
}

export function closeCommandPrompt() {
  const commandPromptModal = document.getElementById('commandPromptModal')!;
  commandPromptModal.classList.add('hidden');
}

function clearCommandPrompt() {
  const commandPrompt = document.getElementById('commandPrompt')! as HTMLInputElement;
  commandPrompt.value = '';
}
