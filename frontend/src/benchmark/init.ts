import type { Editor } from '../editor/init';
import { cancel, clear, run, toggleClamp } from './benchmark_viz';

type QueryStatus = 'idle' | 'running' | 'canceling';

export async function setupQueryBenchmark(editor: Editor) {
  const clampButton = document.getElementById('clampButton')! as HTMLButtonElement;
  const container = document.getElementById('benchmarkContainer')! as HTMLDivElement;

  let queryStatus: QueryStatus = 'idle';

  window.addEventListener('cancel-or-execute', async () => {
    if (queryStatus == 'running') {
      window.dispatchEvent(new Event('execute-cancle-request'));
    } else if (queryStatus == 'idle') {
      await clear();
      container.classList.remove('hidden');
      window.dispatchEvent(new Event('execute-query'));
      run(editor);
    }
  });

  window.addEventListener('execute-cancle-request', () => {
    queryStatus = 'canceling';
    cancel();
  });
  window.addEventListener('execute-query', () => {
    queryStatus = 'running';
  });
  window.addEventListener('execute-ended', () => {
    queryStatus = 'idle';
  });

  clampButton.addEventListener('click', async () => {
    clampButton.children[0].classList.toggle('hidden');
    clampButton.children[0].classList.toggle('inline-flex');
    clampButton.children[1].classList.toggle('hidden');
    clampButton.children[1].classList.toggle('inline-flex');
  });

  document.getElementById('clampButton')!.addEventListener('click', () => {
    toggleClamp();
  });
}
