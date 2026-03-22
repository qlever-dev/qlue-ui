import type { Editor } from '../editor/init';
import { clear, run, toggleClamp } from './benchmark_viz';

export async function setupQueryBenchmark(editor: Editor) {
  const executeButton = document.getElementById('executeButton')! as HTMLButtonElement;
  const clampButton = document.getElementById('clampButton')! as HTMLButtonElement;
  const container = document.getElementById('benchmarkContainer')! as HTMLDivElement;
  executeButton.addEventListener('click', async () => {
    await clear();
    container.classList.remove('hidden');
    run(editor);
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
