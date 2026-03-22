import type { Editor } from '../editor/init';
import { reloadExample } from '../examples/utils';
import { getActiveTabExampleOrigin, getActiveTabName } from '../tabs';
import { getCookie } from '../utils';

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

  const csrftoken = getCookie('csrftoken');
  if (csrftoken == null) {
    toast('error', 'missing CSRF token!<br>Log into the API to update examples.');
    return;
  }

  fetch(`${import.meta.env.VITE_API_URL}/api/backends/${example.service}/examples`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrftoken,
    },
    body: JSON.stringify({ name: example.name, query: editor.getContent() }),
  })
    .then(async (response) => {
      if (!response.ok) {
        console.log(response);
        let message = `Example "${example.name}" update failed`;
        if (response.status == 403) {
          message = 'Missing permissions!<br>Log into the API to update examples.';
        }
        toast('error', message);
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

  const csrftoken = getCookie('csrftoken');
  if (csrftoken == null) {
    toast('error', 'Missing CSRF token!<br>Log into the API to create examples.');
    return;
  }

  const slug = (document.getElementById('backendSelector') as HTMLSelectElement).value;

  fetch(`${import.meta.env.VITE_API_URL}/api/backends/${slug}/examples?create=true`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRFToken': csrftoken,
    },
    body: JSON.stringify({ name, query }),
  })
    .then((response) => {
      if (response.status === 400) {
        toast('error', `Example "${name}" already exists.`);
      } else if (response.status === 403) {
        toast('error', 'Missing permissions!<br>Log into the API to create examples.');
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
