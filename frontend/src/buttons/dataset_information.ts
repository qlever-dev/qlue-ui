import { closeDialog, openDialog, setupDialog } from '../dialogs';
import type { Editor } from '../editor/init';
import type { QlueLsServiceConfig } from '../types/backend';
import { SparqlEngine } from '../types/lsp_messages';

export async function setupDatasetInformation(editor: Editor) {
  const datasetInformationButton = document.getElementById('datasetInformationButton')!;

  setupDialog('datasetInformationModal');

  datasetInformationButton.addEventListener('click', async () => {
    openDatasetInformation(editor);
  });

  document.getElementById('datasetInformationClose')!.addEventListener('click', () => {
    closeDatasetInformation();
  });

  document.getElementById('datasetUrlCopy')!.addEventListener('click', () => {
    navigator.clipboard.writeText(document.getElementById('datasetUrl')!.innerText);
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: { type: 'success', message: 'Copied to clipboard', duration: 2000 },
      })
    );
  });
}

export async function openDatasetInformation(editor: Editor) {
  await loadDatasetInformation(editor);
  openDialog('datasetInformationModal');
}

export function closeDatasetInformation() {
  closeDialog('datasetInformationModal');
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
  const datasetEndpointVersion = document.getElementById('datasetEndpointVersion')!;
  const datasetEndpointServerHash = document.getElementById('datasetEndpointServerHash')!;
  const datasetEndpointIndexHash = document.getElementById('datasetEndpointIndexHash')!;
  if ('error' in service) {
    throw new Error('No backend was configured.');
  }

  if (service.engine !== SparqlEngine.QLever) {
    throw new Error('Dataset information is only availiable for QLever-based Backends.');
  }
  // Show the URL right away and clear stale stats, so an unreachable endpoint still shows its URL.
  datasetUrl.innerText = service.url;
  for (const element of [
    datasetDescription,
    datasetNumberOfTriples,
    datasetNumberOfSubjects,
    datasetNumberOfPredicates,
    datasetNumberOfObjects,
    datasetEndpointVersion,
    datasetEndpointServerHash,
    datasetEndpointIndexHash,
  ]) {
    element.innerText = '';
  }
  fetch(`${service.url}?cmd=stats`)
    .then((response) => {
      if (!response.ok) {
        throw new Error('Could new retreive dataset information.');
      }
      return response.json();
    })
    .then((stats) => {
      datasetDescription.innerText = stats['name-index'];
      datasetNumberOfTriples.innerText = stats['num-triples-normal'].toLocaleString('en-US');
      datasetNumberOfSubjects.innerText = stats['num-subjects-normal'].toLocaleString('en-US');
      datasetNumberOfPredicates.innerText = stats['num-predicates-normal'].toLocaleString('en-US');
      datasetNumberOfObjects.innerText = stats['num-objects-normal'].toLocaleString('en-US');
      datasetEndpointVersion.innerText = stats['version-server'];
      datasetEndpointServerHash.innerText = stats['git-hash-server'];
      datasetEndpointIndexHash.innerText = stats['git-hash-index'];
    })
    .catch(() => {
      datasetDescription.innerText =
        'Could not retrieve dataset information: endpoint is not reachable.';
    });
}
