import { apiFetch, clearApiKey, getApiKey } from '../api';
import type { Editor } from '../editor/init';
import { reloadExample } from '../examples/utils';
import { getActiveTabExampleOrigin, getActiveTabName } from '../tabs';

function toast(type: 'success' | 'error', message: string) {
  document.dispatchEvent(
    new CustomEvent('toast', {
      detail: { type, message, duration: 3000 },
    })
  );
}

export async function updateExample(editor: Editor) {
  const example = getActiveTabExampleOrigin();
  if (!example) {
    toast('error', 'No example is associated with this query.');
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) return;

  apiFetch(`endpoints/${example.service}/examples/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ name: example.name, query: editor.getContent() }),
  })
    .then(async (response) => {
      if (!response.ok) {
        if (response.status === 403) {
          clearApiKey();
          toast('error', 'Invalid API key.');
        } else {
          toast('error', `Example "${example.name}" update failed`);
        }
      } else {
        toast('success', `Example "${example.name}" updated`);
        reloadExample(editor);
      }
    })
    .catch((err) => {
      console.error(err);
      toast('error', 'Example could not be updated!');
    });
}

export async function createExample(editor: Editor, params: string[]) {
  if (params.length > 1) {
    toast('error', 'Usage: createExample "&lt;name&gt;"');
    return;
  }
  const name = params[0] ?? getActiveTabName();

  if (getActiveTabExampleOrigin()?.name === name) {
    toast('error', `Example "${name}" already exists. Use :updateExample to update it.`);
    return;
  }

  const query = editor.getContent();
  if (!query.trim()) {
    toast('error', 'Cannot create example from empty query.');
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) return;

  const slug = (document.getElementById('backendSelector') as HTMLSelectElement).value;

  apiFetch(`endpoints/${slug}/examples/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body: JSON.stringify({ name, query }),
  })
    .then((response) => {
      if (response.status === 409) {
        toast('error', `Example "${name}" already exists.`);
      } else if (response.status === 403) {
        clearApiKey();
        toast('error', 'Invalid API key.');
      } else if (!response.ok) {
        toast('error', `Example "${name}" could not be created.`);
      } else {
        document.dispatchEvent(
          new CustomEvent('example-selected', { detail: { name, service: slug } })
        );
        toast('success', `Example "${name}" created.`);
        reloadExample(editor);
      }
    })
    .catch(() => {
      toast('error', `Example "${name}" could not be created.`);
    });
}
