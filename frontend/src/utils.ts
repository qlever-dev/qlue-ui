/** Runtime base path, derived from the server-injected `<base href>` (e.g. `/` or `/ui/`). */
export const BASE_PATH = new URL(document.baseURI).pathname;

/** Returns a debounced version of `fn` that delays invocation by `delay` ms. */
export function debounce<T extends (...args: never[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
    }, delay);
  };
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extracts `[backendSlug, savedQueryId]` from the URL pathname segments. */
export function getPathParameters(): [string | undefined, string | undefined] {
  let path = window.location.pathname;
  if (path.startsWith(BASE_PATH)) path = path.slice(BASE_PATH.length);
  const segments = path.split('/').filter(Boolean);
  switch (segments.length) {
    case 0:
      return [undefined, undefined];
    case 1:
      return [segments[0], undefined];
    default:
      return [segments[0], segments[1]];
  }
}

/** Removes the initial loading overlay after the color theme has settled. */
export async function removeLoadingScreen() {
  // NOTE: Wait 10 frames for the color theme to take effect
  for (let index = 0; index < 10; index++) {
    await new Promise(requestAnimationFrame);
  }
  document.getElementById('loadingScreen')!.remove();
}

/** Reads a cookie value by name from `document.cookie`. */
export function getCookie(name: string): string | null {
  let cookieValue = null;
  if (document.cookie && document.cookie !== '') {
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
      const cookie = cookies[i].trim();
      if (cookie.substring(0, name.length + 1) === `${name}=`) {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

/** Logs the build-time git commit hash to the console and shows it via toast on demand. */
export function showCommitHash() {
  if (__GIT_COMMIT__) {
    console.log(`qlue-ui commit: ${__GIT_COMMIT__}`);
  }
}

export function displayVersion() {
  const hash = __GIT_COMMIT__ || 'unknown';
  document.dispatchEvent(
    new CustomEvent('toast', {
      detail: { type: 'info', message: `Build: ${hash}`, duration: 5000 },
    })
  );
}

/**
 * Escapes `text` for interpolation into a toast message, which is assigned as
 * raw HTML.
 */
export function escapeHtml(text: string): string {
  const element = document.createElement('span');
  element.textContent = text;
  return element.innerHTML;
}
