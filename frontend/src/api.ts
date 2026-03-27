import { BASE_PATH } from './utils';

const API_KEY_STORAGE_KEY = 'api-key';

export function getApiKey(): string | null {
  let key = sessionStorage.getItem(API_KEY_STORAGE_KEY);
  if (key) return key;
  key = prompt('Enter API key:');
  if (key) sessionStorage.setItem(API_KEY_STORAGE_KEY, key);
  return key;
}

export function clearApiKey(): void {
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
}

/** Fetches from the UI API, prefixing the path with the base URL. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_PATH}ui-api/${path}`, init);
}
