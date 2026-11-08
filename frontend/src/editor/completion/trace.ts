// ┌─────────────────────────────────┐ \\
// │ Copyright © 2026 Ioannis Nezis  │ \\
// ├─────────────────────────────────┤ \\
// │ Licensed under the MIT license. │ \\
// └─────────────────────────────────┘ \\

/**
 * Completion tracing.
 *
 * Off by default. Turn it on from the devtools console with
 * `completionTrace(true)`; the setting persists in `localStorage`.
 * Every request gets an id so the outgoing params and the incoming
 * response can be matched up, along with the round trip time.
 */

const STORAGE_KEY = 'qlue.completionTrace';

let enabled = localStorage.getItem(STORAGE_KEY) === 'true';
let nextId = 0;

declare global {
  interface Window {
    completionTrace: (on?: boolean) => void;
  }
}

window.completionTrace = (on = true) => {
  enabled = on;
  localStorage.setItem(STORAGE_KEY, String(on));
  console.debug(`[completion] tracing ${on ? 'enabled' : 'disabled'}`);
};

/**
 * Details are passed as a function so that nothing is computed while tracing
 * is off — arguments are evaluated eagerly, so an inline object would run its
 * lookups on every keystroke regardless.
 */
type Details = () => Record<string, unknown>;

/** A single request/response round trip. */
export class Trace {
  readonly id = ++nextId;
  private readonly start = performance.now();

  private constructor() {}

  /** Starts a trace, or returns `undefined` while tracing is off. */
  static start(label: string, details: Details): Trace | undefined {
    if (!enabled) return undefined;
    const trace = new Trace();
    console.debug(`[completion] #${trace.id} → ${label}`, details());
    return trace;
  }

  /** Logs an event on this trace, with the elapsed time since it started. */
  log(label: string, details?: Details) {
    const elapsed = (performance.now() - this.start).toFixed(1);
    console.debug(`[completion] #${this.id} ← ${label} (${elapsed}ms)`, details?.() ?? '');
  }
}

/** Logs an event that is not tied to a request. */
export function trace(label: string, details?: Details) {
  if (!enabled) return;
  console.debug(`[completion] ${label}`, details?.() ?? '');
}
