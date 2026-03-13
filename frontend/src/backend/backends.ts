// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { QlueLsServiceConfig, UiServiceConfig } from '../types/backend';
import { MonacoLanguageClient } from 'monaco-languageclient';
import { getPathParameters } from '../utils';
import type { Editor } from '../editor/init';

interface ServiceDescription {
  name: string;
  slug: string;
  is_default: boolean;
  api_url: string;
}

const serviceConfigPromisses: Record<string, Promise<Response>> = {};

const serviceDescriptionPromises: Promise<ServiceDescription[]> = fetch(
  `${import.meta.env.VITE_API_URL}/api/backends/`
)
  .then((response) => {
    if (!response.ok) {
      throw new Error(
        `Error while fetching backends: \nstatus: ${response.status} \nmessage: ${response.statusText} `
      );
    }
    return response.json();
  })
  .then((serviceDescriptions) => {
    for (const service of serviceDescriptions) {
      serviceConfigPromisses[service.slug] = fetch(service.api_url);
    }
    return serviceDescriptions;
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
 * Fetches all SPARQL endpoint configurations from the API, registers them
 * with the language server, and populates the backend selector dropdown.
 *
 * The default backend is determined by the URL path slug, falling back to
 * the API-designated default. Non-default backends are loaded in the
 * background. Switching backends clears the editor and notifies the
 * language server.
 */
export async function configureBackends(editor: Editor) {
  const backendSelector = document.getElementById('backendSelector') as HTMLSelectElement;
  const [path_slug, _] = getPathParameters();
  let default_service_slug: string | null = null;

  // NOTE: fetch ALL service descriptions
  const services = await serviceDescriptionPromises;

  // NOTE: find default service then fetch & load its configuration (blocking)
  for (const service of services) {
    const is_default = path_slug == service.slug || (path_slug == undefined && service.is_default);
    backendSelector.add(new Option(service.name, service.slug, false, is_default));
    default_service_slug = is_default ? service.slug : default_service_slug;
    if (is_default) {
      await addService(editor.languageClient, service, true);
    }
  }
  if (default_service_slug == null) {
    // NOTE: path slug was provided but did not match any known backend
    if (path_slug != undefined) {
      const BASE_PATH = import.meta.env.BASE_URL ?? '/';
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
    const service = services.find((service) => service.is_default);
    if (service) {
      default_service_slug = service.slug;
      await addService(editor.languageClient, service, true);
      backendSelector.value = service.slug;
    } else if (services.length > 0) {
      // NOTE: the path did not match any service and there is no default service.
      default_service_slug = services[0].slug;
      await addService(editor.languageClient, services[0], true);
      backendSelector.value = services[0].slug;
    } else {
      document.dispatchEvent(
        new CustomEvent('toast', {
          detail: {
            type: 'warning',
            message: 'No SPARQL endpoint configuration found.',
          },
        })
      );
    }
  }

  document.dispatchEvent(new CustomEvent('backend-selected', { detail: default_service_slug }));

  // NOTE: add all other services non-blocking
  for (let service of services) {
    if (service.slug != default_service_slug) {
      addService(editor.languageClient, service);
    }
  }

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
  serviceDescription: ServiceDescription,
  is_default = false
) {
  const sparqlEndpointconfig = (await serviceConfigPromisses[serviceDescription.slug]
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `Error while fetching backend details: \nstatus: ${response.status} \nmessage: ${response.statusText} `
        );
      }
      return response.json();
    })
    .catch((err) => {
      console.error('Error while fetching SPARQL endpoint configuration:', err);
    })) as UiServiceConfig;

  const serviceConfig: QlueLsServiceConfig = {
    name: sparqlEndpointconfig.slug,
    url: sparqlEndpointconfig.url,
    engine: sparqlEndpointconfig.engine,
    prefixMap: sparqlEndpointconfig.prefix_map,
    queries: {
      subjectCompletion: sparqlEndpointconfig['subject_completion'],
      predicateCompletionContextSensitive:
        sparqlEndpointconfig['predicate_completion_context_sensitive'],
      predicateCompletionContextInsensitive:
        sparqlEndpointconfig['predicate_completion_context_insensitive'],
      objectCompletionContextSensitive: sparqlEndpointconfig['object_completion_context_sensitive'],
      objectCompletionContextInsensitive:
        sparqlEndpointconfig['object_completion_context_insensitive'],
      valuesCompletionContextSensitive: sparqlEndpointconfig['values_completion_context_sensitive'],
      valuesCompletionContextInsensitive:
        sparqlEndpointconfig['values_completion_context_insensitive'],
      hover: sparqlEndpointconfig['hover'],
    },
    default: is_default,
    additionalData: {
      mapViewUrl: sparqlEndpointconfig['map_view_url'],
    },
  };

  await languageClient.sendNotification('qlueLs/addBackend', serviceConfig).catch((err) => {
    console.error(err);
  });
}
