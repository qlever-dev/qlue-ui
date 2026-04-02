import type { Editor } from './editor/init';
import { openParseTree } from './parse_tree/init';
import { getShareLinkId, getSharedQuery } from './share';
import { openOrCreateTab } from './tabs';
import type { QlueLsServiceConfig } from './types/backend';
import { getPathParameters } from './utils';

/**
 * Handles URL-based parameters to configure the editor on page load.
 *
 * Supported parameters:
 * - `?query=<sparql>` — populates the editor with the given query string
 * - `/<backend>/<id>` (path) — loads a saved query by its short ID
 * - `?exec` — automatically executes the query after loading
 * - `?parseTree` — opens the parse tree panel
 */
export async function handleRequestParameter(editor: Editor) {
  const params = new URLSearchParams(window.location.search);
  const query = params.get('query');
  if (query) {
    editor.setContent(query);
  }
  // NOTE: if there is a saved-query id fetch and show the query in a new tab
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length == 2) {
    const shareId = segments[1];
    const savedQuery = await getSharedQuery(shareId);
    if (savedQuery !== editor.getContent()) {
      await openOrCreateTab(editor, shareId, savedQuery);
    }
  }
  const exec = params.get('exec');
  if (exec) {
    window.dispatchEvent(new Event('execute-start-request'));
  }

  const parseTree = params.get('parseTree');
  if (parseTree) {
    openParseTree(editor);
  }

  // Clean URL after consuming inbound parameters, keeping only the backend slug
  const slug = segments[0];
  if (slug) {
    history.replaceState(null, '', `/${slug}`);
  } else {
    history.replaceState(null, '', '/');
  }
}

/** Updates the URL with a share link after every successful query execution. */
export function setupUrlSync(editor: Editor) {
  window.addEventListener('execute-started', async () => {
    const query = editor.getContent();
    if (!query.trim()) return;
    const shareId = await getShareLinkId(query).catch(() => null);
    if (!shareId) return;
    let [slug] = getPathParameters();
    if (slug == undefined) {
      // NOTE: get backend slug if path parameter is empty.
      const backend = (await editor.languageClient.sendRequest(
        'qlueLs/getBackend',
        {}
      )) as QlueLsServiceConfig;
      slug = backend.name;
    }
    history.replaceState(null, '', `/${slug}/${shareId}`);
  });
}
