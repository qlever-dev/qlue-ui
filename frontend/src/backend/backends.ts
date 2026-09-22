// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { MonacoLanguageClient } from 'monaco-languageclient';
import { apiFetch } from '../api';
import type { Editor } from '../editor/init';
import type {
  EndpointListResponse,
  QlueLsServiceConfig,
  SparqlEndpointConfiguration,
} from '../types/backend';
import { BASE_PATH, escapeHtml, getPathParameters } from '../utils';

const BACKEND_STORAGE_KEY = 'QLeverUI backend';

const endpointConfigPromise: Promise<EndpointListResponse> = apiFetch('endpoints/')
  .then((response) => {
    if (!response.ok) {
      throw new Error(
        `Error while fetching backends: \nstatus: ${response.status} \nmessage: ${response.statusText} `
      );
    }
    return response.json();
  })
  .catch((err) => {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: 'The UI API is unreachable.<br>The application will not work as intended.',
        },
      })
    );
    console.error('Error while fetching backends list:', err);
    return [];
  });

/**
 * Fetch a single endpoint configuration by slug, or null if there is none.
 *
 * Used for hidden endpoints, which are absent from the endpoint list.
 */
function fetchEndpointConfig(slug: string): Promise<SparqlEndpointConfiguration | null> {
  return apiFetch(`endpoints/${slug}/`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
}

/**
 * Register each SPARQL endpoint at the language server,
 * and populates the backend selector dropdown.
 *
 * The default backend is determined by the URL path slug, falling back to
 * the API-designated default. Non-default backends are loaded in the
 * background. Switching backends clears the editor and notifies the
 * language server.
 */
export async function configureBackends(editor: Editor) {
  const backendSelector = document.getElementById('backendSelector') as HTMLSelectElement;
  const [path_slug, _] = getPathParameters();
  let activeEndpointSlug: string | null = null;
  let defaultEndpointSlug: string | null = null;
  const endpointConfigs = await endpointConfigPromise;

  // NOTE: when no backend is specified in the path, fall back to the last
  // selected backend (persisted in localStorage), so a new tab opens the
  // backend the user was last using.
  const storedSlug = localStorage.getItem(BACKEND_STORAGE_KEY);
  const preferredSlug =
    path_slug === undefined && storedSlug !== null && storedSlug in endpointConfigs
      ? storedSlug
      : path_slug;

  // NOTE: find default service then fetch & load its configuration (blocking)
  for (const [slug, config] of Object.entries(endpointConfigs)) {
    const is_active = preferredSlug === slug || (preferredSlug === undefined && config.default);
    backendSelector.add(new Option(config.name, slug, false, is_active));
    activeEndpointSlug = is_active ? slug : activeEndpointSlug;
    if (config.default) {
      defaultEndpointSlug = slug;
    }
    await addService(editor.languageClient, slug, config, is_active);
  }
  if (activeEndpointSlug == null && path_slug !== undefined) {
    // NOTE: hidden endpoints are not part of the endpoint list, they are only
    // reachable by their slug in the URL. Fetch such a slug directly; the
    // resulting option is added hidden, so the selector can display it as the
    // current choice without offering it in the dropdown.
    const hiddenConfig = await fetchEndpointConfig(path_slug);
    if (hiddenConfig) {
      const option = new Option(hiddenConfig.name, path_slug, false, true);
      option.hidden = true;
      backendSelector.add(option);
      await addService(editor.languageClient, path_slug, hiddenConfig, true);
      activeEndpointSlug = path_slug;
    }
  }
  if (activeEndpointSlug == null) {
    // NOTE: path slug was provided but did not match any known backend
    if (path_slug !== undefined) {
      history.replaceState(null, '', BASE_PATH);
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: 'warning',
            message: `No SPARQL endpoint with the slug '${path_slug}' was found.<br>Resetting URL.`,
          },
        })
      );
    }
    if (defaultEndpointSlug) {
      await addService(
        editor.languageClient,
        defaultEndpointSlug,
        endpointConfigs[defaultEndpointSlug],
        true
      );
      backendSelector.value = defaultEndpointSlug;
      activeEndpointSlug = defaultEndpointSlug;
    } else {
      const firstConfig = Object.entries(endpointConfigs)[0];
      if (firstConfig) {
        // NOTE: the path did not match any service and there is no default service.
        await addService(editor.languageClient, firstConfig[0], firstConfig[1], true);
        backendSelector.value = firstConfig[0];
        activeEndpointSlug = firstConfig[0];
      } else {
        document.dispatchEvent(
          new CustomEvent('toast', {
            detail: {
              type: 'error',
              message: 'No SPARQL endpoint configuration found.',
            },
          })
        );
      }
    }
  }
  // NOTE: reflect the loaded backend in the URL path when none was specified.
  if (path_slug === undefined && activeEndpointSlug) {
    history.replaceState(null, '', `${BASE_PATH}${activeEndpointSlug}${window.location.search}`);
  }
  // NOTE: remember the loaded backend so a new tab without a path reuses it.
  if (activeEndpointSlug) {
    localStorage.setItem(BACKEND_STORAGE_KEY, activeEndpointSlug);
  }
  document.dispatchEvent(new CustomEvent('backend-selected', { detail: activeEndpointSlug }));

  backendSelector.addEventListener('change', () => {
    editor.languageClient
      .sendNotification('qlueLs/updateDefaultBackend', {
        backendName: backendSelector.value,
      })
      .then(() => {
        localStorage.setItem(BACKEND_STORAGE_KEY, backendSelector.value);
        history.pushState({}, '', `${BASE_PATH}${backendSelector.value}`);
        document.dispatchEvent(
          new CustomEvent('backend-selected', { detail: backendSelector.value })
        );
      })
      .catch((err) => {
        console.error(err);
      });
  });
}

async function addService(
  languageClient: MonacoLanguageClient,
  slug: string,
  sparqlEndpointconfig: SparqlEndpointConfiguration,
  is_default = false
) {
  const serviceConfig: QlueLsServiceConfig = {
    name: slug,
    url: sparqlEndpointconfig.url,
    engine: sparqlEndpointconfig.engine,
    prefixMap: sparqlEndpointconfig.prefixMap,
    queries: sparqlEndpointconfig.queryTemplates ?? {},
    default: is_default,
    additionalData: {
      mapViewUrl: sparqlEndpointconfig.mapViewUrl,
    },
  };

  await languageClient.sendRequest('qlueLs/addBackend', serviceConfig).catch((err) => {
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'error',
          message: `Configuring Service "${serviceConfig.name}" failed:<pre class="mt-1 text-xs whitespace-pre-wrap">${escapeHtml(err.message)}</pre>`,
        },
      })
    );
  });
}
