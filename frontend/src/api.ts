import { BASE_PATH } from './utils';

/** Fetches from the UI API, prefixing the path with the base URL. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_PATH}ui-api/${path}`, init);
}
