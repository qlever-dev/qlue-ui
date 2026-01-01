// ┌─────────────────────────────────┐ \\
// │ Copyright © 2025 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

import type { ServiceConfig } from '../types/backend';
import { MonacoLanguageClient } from 'monaco-languageclient';
import { getPathParameters } from '../utils';
import type { Editor } from '../editor/init';

interface ServiceDescription {
  name: string;
  slug: string;
  is_default: boolean;
  api_url: string;
}

export async function configureBackends(editor: Editor) {
  const backendSelector = document.getElementById('backendSelector') as HTMLSelectElement;

  const services = (await fetch(`${import.meta.env.VITE_API_URL}/api/backends/`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          `Error while fetching backends: \nstatus: ${response.status} \nmessage: ${response.statusText} `
        );
      }
      return response.json();
    })
    .catch((err) => {
      console.error('Error while fetching backends list:', err);
      return [];
    })) as ServiceDescription[];

  const [path_slug, _] = getPathParameters();
  let default_found = false;

  for (let serviceDescription of services) {
    const sparqlEndpointconfig = await fetch(serviceDescription.api_url)
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
      });

    const is_default =
      path_slug == serviceDescription.slug ||
      (path_slug == undefined && sparqlEndpointconfig.is_default);

    default_found = default_found || is_default;

    const option = new Option(serviceDescription.name, serviceDescription.slug, false, is_default);
    backendSelector.add(option);

    const config: ServiceConfig = {
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
        objectCompletionContextSensitive:
          sparqlEndpointconfig['object_completion_context_sensitive'],
        objectCompletionContextInsensitive:
          sparqlEndpointconfig['object_completion_context_insensitive'],
      },
      default: is_default,
    };

    await addBackend(editor.languageClient, config);
  }

  if (!default_found) {
    const service = services.find((service) => service.is_default);
    if (service) {
      updateDefaultService(editor, service);
    } else if (services.length > 0) {
      // NOTE: the path did not match any service and there is no default service.
      updateDefaultService(editor, services[0]);
    } else {
      throw new Error('No SPARQL backend provided');
    }
  }

  document.dispatchEvent(new Event('backend-selected'));

  backendSelector.addEventListener('change', () => {
    editor.setContent('');
    editor.languageClient
      .sendNotification('qlueLs/updateDefaultBackend', {
        backendName: backendSelector.value,
      })
      .then(() => {
        history.pushState({}, '', `/${backendSelector.value}`);
        document.dispatchEvent(new Event('backend-selected'));
      })
      .catch((err) => {
        console.error(err);
      });
  });
}

async function updateDefaultService(editor: Editor, service: ServiceDescription) {
  const backendSelector = document.getElementById('backendSelector') as HTMLSelectElement;
  await editor.languageClient
    .sendNotification('qlueLs/updateDefaultBackend', {
      backendName: service.slug,
    })
    .then(() => {
      backendSelector.value = service.slug;
    })
    .catch((err) => {
      console.error(err);
    });
}

async function addBackend(languageClient: MonacoLanguageClient, conf: ServiceConfig) {
  await languageClient.sendNotification('qlueLs/addBackend', conf).catch((err) => {
    console.error(err);
  });
}
