// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { EndpointListResponse, QlueLsServiceConfig, SparqlEndpointConfiguration } from '../types/backend';
import { MonacoLanguageClient } from 'monaco-languageclient';
import { getPathParameters } from '../utils';
import type { Editor } from '../editor/init';
import { apiFetch } from '../api';
import { BASE_PATH } from '../utils';

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

  // NOTE: find default service then fetch & load its configuration (blocking)
  for (const [slug, config] of Object.entries(endpointConfigs)) {
    const is_active = path_slug == slug || (path_slug == undefined && config.default);
    backendSelector.add(new Option(config.name, slug, false, is_active));
    activeEndpointSlug = is_active ? slug : activeEndpointSlug;
    if (config.default) {
      defaultEndpointSlug = slug;
    }
    await addService(editor.languageClient, slug, config, is_active);
  }
  if (activeEndpointSlug == null) {
    // NOTE: path slug was provided but did not match any known backend
    if (path_slug != undefined) {
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
      await addService(editor.languageClient, defaultEndpointSlug, endpointConfigs[defaultEndpointSlug], true);
      backendSelector.value = defaultEndpointSlug;
      activeEndpointSlug = defaultEndpointSlug;
    } else {
      let firstConfig = Object.entries(endpointConfigs)[0];
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
  document.dispatchEvent(new CustomEvent('backend-selected', { detail: activeEndpointSlug }));

  backendSelector.addEventListener('change', () => {
    editor.languageClient
      .sendNotification('qlueLs/updateDefaultBackend', {
        backendName: backendSelector.value,
      })
      .then(() => {
        history.pushState({}, '', `/${backendSelector.value}`);
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
    prefixMap: sparqlEndpointconfig.prefixMap ?? {},
    queries: sparqlEndpointconfig.queryTemplates ?? {},
    default: is_default,
    additionalData: {
      mapViewUrl: sparqlEndpointconfig.mapViewUrl,
    },
  };

  await languageClient.sendNotification('qlueLs/addBackend', serviceConfig).catch((err) => {
    console.error(err);
  });
}
