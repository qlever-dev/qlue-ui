export function setupFullResult() {
  const fullResultButton = document.getElementById('fullResultButton') as HTMLButtonElement;

  fullResultButton.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('cancel-or-execute', { detail: { limited: false } }));
  });
}
