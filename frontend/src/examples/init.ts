import type { Editor } from '../editor/init';
import { setupKeywordSearch } from './keyword_search';
import { clearExamples, handleClickEvents } from './utils';

interface QueryExample {
  name: string;
  service: string;
  query: string;
}

/**
 * Initializes the example queries panel. Listens for backend-selection
 * changes and fetches the corresponding example queries from the API.
 * Selecting an example populates the editor with its query text.
 */
export async function setupExamples(editor: Editor) {
  handleClickEvents();
  setupKeywordSearch();

  document.addEventListener('backend-selected', (e: Event) => {
    clearExamples();
    loadExamples(editor, (e as CustomEvent<string>).detail);
  });
}

export async function loadExamples(editor: Editor, serviceSlug: string) {
  const examplesList = document.getElementById('examplesList')!;
  const examplesModal = document.getElementById('examplesModal')!;

  let examples = (await fetch(
    `${import.meta.env.VITE_API_URL}/api/backends/${serviceSlug}/examples`
  )
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `Error while fetching backend examples: \nstatus: ${response.status} \nmessage: ${response.statusText} `
        );
      }
      return response.json();
    })
    .catch((err) => {
      console.error('Error while fetching backends examples:', err);
      return [];
    })) as QueryExample[];

  const fragment = new DocumentFragment();
  for (const example of examples) {
    const li = document.createElement('li');
    li.classList =
      'text-neutral-500 hover:text-neutral-200 dark:text-white p-2 hover:bg-neutral-500  hover:dark:bg-neutral-700 cursor-pointer';
    li.dataset.query = example.query;
    const span = document.createElement('span');
    span.innerText = example.name;
    li.appendChild(span);
    li.onclick = () => {
      editor.setContent(example.query);
      examplesModal.classList.add('hidden');
      document.dispatchEvent(
        new CustomEvent('example-selected', {
          detail: { name: example.name, service: serviceSlug },
        })
      );
      setTimeout(() => editor.focus(), 50);
    };
    fragment.appendChild(li);
  }
  examplesList.appendChild(fragment);
  document.dispatchEvent(new Event('examples-loaded'));
}
