import type { SparqlRequest } from './types';

interface QueryResult {
  index: number;
  resultSize: number | null;
  timeMs: number;
  error?: any;
}

export function startQueries(
  requests: SparqlRequest[],
  startTime: number,
  onProcessDone: (res: QueryResult) => void
): [Promise<void>, AbortController][] {
  const requests_and_controller: [Promise<void>, AbortController][] = [];
  requests.forEach((request, index) => {
    const controller = new AbortController();
    const signal = controller.signal;

    const promise = fetch(request.url, {
      signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/sparql-query',
        Accept: 'application/sparql-results+json',
      },
      body: request.query,
    })
      .then((result) => {
        const end = performance.now();
        const timeMs = end - startTime;
        if (result.ok) {
          onProcessDone({ index, resultSize: 42, timeMs });
        } else {
          onProcessDone({ index, resultSize: null, timeMs, error: result.statusText });
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          console.log('Fetch was cancelled');
        } else {
          const end = performance.now();
          const timeMs = end - startTime;
          onProcessDone({ index, resultSize: null, timeMs, error });
        }
      });
    requests_and_controller.push([promise, controller]);
  });
  return requests_and_controller;
}
