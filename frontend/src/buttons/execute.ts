import type { QueryStatus } from '../results/utils';

export function setupExecute() {
  const executeButton = document.getElementById('executeButton')! as HTMLButtonElement;
  executeButton.addEventListener('click', () => {
    window.dispatchEvent(new Event('cancel-or-execute'));
  });

  window.addEventListener('execute-cancle-request', () => {
    updateExecuteButton('canceling');
  });
  window.addEventListener('execute-query', () => {
    updateExecuteButton('running');
  });
  window.addEventListener('execute-ended', () => {
    updateExecuteButton('idle');
  });
}

export function executeQuery() {
  window.dispatchEvent(new Event('cancel-or-execute'));
}

export function updateExecuteButton(queryStatus: QueryStatus) {
  const executeButton = document.getElementById('executeButton')! as HTMLButtonElement;
  switch (queryStatus) {
    case 'idle':
      executeButton.children[0].classList.remove('hidden');
      executeButton.children[0].classList.add('inline-flex');
      executeButton.children[1].classList.add('hidden');
      executeButton.children[1].classList.remove('inline-flex');
      break;
    case 'running':
      executeButton.children[0].classList.add('hidden');
      executeButton.children[0].classList.remove('inline-flex');
      executeButton.children[1].classList.remove('hidden');
      executeButton.children[1].classList.add('inline-flex');
      executeButton.children[1].children[0].classList.add('hidden');
      executeButton.children[1].children[1].classList.remove('hidden');
      break;
    case 'canceling':
      executeButton.children[0].classList.add('hidden');
      executeButton.children[0].classList.remove('inline-flex');
      executeButton.children[1].classList.remove('hidden');
      executeButton.children[1].classList.add('inline-flex');
      executeButton.children[1].children[0].classList.remove('hidden');
      executeButton.children[1].children[1].classList.add('hidden');
      break;
  }
}
