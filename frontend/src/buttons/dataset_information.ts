import type { Editor } from '../editor/init';
import type { QlueLsServiceConfig } from '../types/backend';
import { SparqlEngine } from '../types/lsp_messages';

export async function setupDatasetInformation(editor: Editor) {
  const datasetInformationModal = document.getElementById('datasetInformationModal')!;
  const datasetInformation = document.getElementById('datasetInformation')!;
  const datasetInformationButton = document.getElementById('datasetInformationButton')!;

  datasetInformationButton.addEventListener('click', async () => {
    openDatasetInformation(editor);
  });

  datasetInformationModal.addEventListener('click', () => {
    closeDatasetInformation();
  });

  datasetInformation.firstElementChild?.addEventListener('click', (e) => {
    e.stopPropagation();
  });
}

export async function openDatasetInformation(editor: Editor) {
  const datasetInformationModal = document.getElementById('datasetInformationModal')!;
  await loadDatasetInformation(editor);
  datasetInformationModal.classList.remove('hidden');
}

export function closeDatasetInformation() {
  const datasetInformationModal = document.getElementById('datasetInformationModal')!;
  datasetInformationModal.classList.add('hidden');
}

async function loadDatasetInformation(editor: Editor): Promise<void> {
  const service = (await editor.languageClient.sendRequest('qlueLs/getBackend', {})) as
    | QlueLsServiceConfig
    | { error: string };
  const datasetUrl = document.getElementById('datasetUrl')!;
  const datasetDescription = document.getElementById('datasetDescription')!;
  const datasetNumberOfTriples = document.getElementById('datasetNumberOfTriples')!;
  const datasetNumberOfSubjects = document.getElementById('datasetNumberOfSubjects')!;
  const datasetNumberOfPredicates = document.getElementById('datasetNumberOfPredicates')!;
  const datasetNumberOfObjects = document.getElementById('datasetNumberOfObjects')!;
  if ('error' in service) {
    throw new Error('No backend was configured.');
  }

  if (service.engine != SparqlEngine.QLever) {
    throw new Error('Dataset information is only availiable for QLever-based Backends.');
  }
  fetch(`${service.url}?cmd=stats`)
    .then((response) => {
      if (!response.ok) {
        throw new Error('Could new retreive dataset information.');
      }
      return response.json();
    })
    .then((stats) => {
      datasetUrl.innerText = service.url;
      datasetDescription.innerText = stats['name-index'];
      datasetNumberOfTriples.innerText = stats['num-triples-normal'].toLocaleString('en-US');
      datasetNumberOfSubjects.innerText = stats['num-subjects-normal'].toLocaleString('en-US');
      datasetNumberOfPredicates.innerText = stats['num-predicates-normal'].toLocaleString('en-US');
      datasetNumberOfObjects.innerText = stats['num-objects-normal'].toLocaleString('en-US');
    });
}
