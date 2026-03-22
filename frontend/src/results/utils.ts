import * as d3 from 'd3';
import type { Head, Meta } from '../types/lsp_messages';
import type { Editor } from '../editor/init';
import type { Binding } from '../types/rdf';
import type { QlueLsServiceConfig } from '../types/backend';

export function clearQueryStats() {
  document.getElementById('resultSize')!.innerText = '?';
  document.getElementById('queryTimeTotal')!.innerText = '0';
  document.getElementById('queryTimeCompute')!.innerText = '0';
  document.getElementById('queryTimeComputeContainer')!.classList.add('hidden');
}

export function showQueryMetaData(meta: Meta) {
  const sizeEl = document.getElementById('resultSize')!;
  sizeEl.classList.add('normal-nums');
  sizeEl.classList.remove('tabular-nums');
  sizeEl.innerText = meta['result-size-total'].toLocaleString('en-US');
  document.getElementById('queryTimeComputeContainer')!.classList.remove('hidden');
  document.getElementById('queryTimeCompute')!.innerText =
    meta['query-time-ms'].toLocaleString('en-US') + 'ms';
}

export function showLoadingScreen() {
  const resultsContainer = document.getElementById('results') as HTMLSelectElement;
  const resultsTableContainer = document.getElementById(
    'resultsTableContainer'
  ) as HTMLSelectElement;
  const resultsLoadingScreen = document.getElementById('resultsLoadingScreen') as HTMLSelectElement;
  const resultsError = document.getElementById('resultsError') as HTMLSelectElement;
  resultsTableContainer.classList.add('hidden');
  resultsContainer.classList.remove('hidden');
  resultsLoadingScreen.classList.remove('hidden');
  resultsError.classList.add('hidden');
}

// Hides the loading screen and shows the results container.
// Also scrolles to the results container.
export function showResults() {
  const resultsTableContainer = document.getElementById(
    'resultsTableContainer'
  ) as HTMLSelectElement;
  const resultsLoadingScreen = document.getElementById('resultsLoadingScreen') as HTMLSelectElement;

  resultsLoadingScreen.classList.add('hidden');
  resultsTableContainer.classList.remove('hidden');
}

export function scrollToResults() {
  const resultsContainer = document.getElementById('results') as HTMLSelectElement;
  window.scrollTo({
    top: resultsContainer.offsetTop + 10,
    behavior: 'smooth',
  });
}

export function extractIriLabel(iri: string): string {
  try {
    const url = new URL(iri);

    // Priority 1: Fragment
    if (url.hash && url.hash.length > 1) {
      return url.hash.slice(1);
    }

    // Priority 2 & 3: Last non-empty path segment (handles trailing slashes)
    const pathSegments = url.pathname.split('/').filter((segment) => segment.length > 0);
    if (pathSegments.length > 0) {
      return pathSegments[pathSegments.length - 1];
    }

    // Priority 5: Fallback to domain only
    return url.hostname;
  } catch {
    // Fallback for malformed URLs: return original
    return iri;
  }
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'tiff'];

export function isImageUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const ext = pathname.split('.').pop()?.toLowerCase();
    return ext !== undefined && IMAGE_EXTENSIONS.includes(ext);
  } catch {
    return false;
  }
}

export function startQueryTimer(): d3.Timer {
  const timerEl = document.getElementById('queryTimeTotal')!;
  timerEl.classList.remove('normal-nums');
  timerEl.classList.add('tabular-nums');
  const timer = d3.timer((elapsed) => {
    timerEl.innerText = elapsed.toLocaleString('en-US') + 'ms';
  });
  return timer;
}

export function stopQueryTimer(timer: d3.Timer) {
  const timerEl = document.getElementById('queryTimeTotal')!;
  timerEl.classList.add('normal-nums');
  timerEl.classList.remove('tabular-nums');
  timer.stop();
}

export function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[<>&"']/g, (char) => escapeMap[char] ?? char);
}

// Show "Map view" button if the last column contains a WKT string otherwise.
export async function showMapViewButton(editor: Editor, head: Head, bindings: Binding[]) {
  const mapViewButton = document.getElementById('mapViewButton') as HTMLAnchorElement;
  const n_rows = bindings.length;
  const last_col_var = head.vars[head.vars.length - 1];
  if (n_rows > 0 && last_col_var in bindings[0]) {
    const binding = bindings[0][last_col_var];
    if (
      binding.type == 'literal' &&
      binding.datatype === 'http://www.opengis.net/ont/geosparql#wktLiteral'
    ) {
      const backend = (await editor.languageClient.sendRequest(
        'qlueLs/getBackend',
        {}
      )) as QlueLsServiceConfig;
      let mapViewBaseUrl = backend.additionalData.mapViewUrl ?? 'https://qlever.dev/petrimaps/';
      mapViewButton?.classList.remove('hidden');
      const query: string = editor.getContent();
      const params = {
        query: query,
        backend: backend.url,
      };
      mapViewButton.href = `${mapViewBaseUrl}?${new URLSearchParams(params)}`;
      return;
    }
  }
  mapViewButton?.classList.add('hidden');
}

export function showFullResultButton() {
  const fullResultButton = document.getElementById('fullResultButton') as HTMLButtonElement;
  fullResultButton.classList.remove('hidden');
}

export function hideFullResultButton() {
  const fullResultButton = document.getElementById('fullResultButton') as HTMLButtonElement;
  fullResultButton.classList.add('hidden');
}

export type QueryStatus = 'idle' | 'running' | 'canceling';

// function setupInfiniteScroll(editorAndLanguageClient: EditorAndLanguageClient) {
//   const window_size = 100;
//   let offset = window_size;
//   let mutex = false;
//   let done = false;
//   const resultReloadingAnimation = document.getElementById('resultReloadingAnimation')!;
//
//   async function onScroll() {
//     if (mutex || done) return;
//     const scrollPosition = window.innerHeight + window.scrollY;
//     const pageHeight = document.body.offsetHeight;
//     if (scrollPosition >= pageHeight - 1000) {
//       resultReloadingAnimation.classList.remove('hidden');
//       mutex = true;
//       const results = await executeQuery(editorAndLanguageClient, window_size, offset);
//       const resultsTable = document.getElementById('resultsTable')! as HTMLTableElement;
//       const rows = renderTableRows(results, offset);
//       resultsTable.appendChild(rows);
//       resultReloadingAnimation.classList.add('hidden');
//       offset += window_size;
//       mutex = false;
//     }
//   }
//
//   function stopReload() {
//     done = true;
//   }
//
//   function reset() {
//     offset = window_size;
//     mutex = false;
//     done = false;
//   }
//
//   document.addEventListener('scroll', onScroll);
//   document.addEventListener('infinite-reset', () => {
//     reset();
//   });
//   document.addEventListener('infinite-stop', stopReload);
// }
