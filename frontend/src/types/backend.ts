export interface PrefixMap {
  [key: string]: string;
}

export interface QlueLsServiceConfig {
  name: string;
  url: string;
  engine?: string;
  healthCheckUrl?: string;
  prefixMap: Record<string, string>;
  queries: CompletionTemplates;
  default: boolean;
  additionalData: any;
}

// --- Types derived from the UI-API Swagger spec ---

/** Completion query templates for a SPARQL endpoint (from /endpoints/ API). */
export interface CompletionTemplates {
  subjectCompletion?: string;
  predicateCompletionContextSensitive?: string;
  predicateCompletionContextInsensitive?: string;
  objectCompletionContextSensitive?: string;
  objectCompletionContextInsensitive?: string;
  valuesCompletionContextSensitive?: string;
  valuesCompletionContextInsensitive?: string;
  hover?: string;
}

/** A single SPARQL endpoint configuration as returned by the UI-API. */
export interface SparqlEndpointConfiguration {
  name: string;
  url: string;
  engine?: string;
  default: boolean;
  prefixMap: Record<string, string>;
  mapViewUrl?: string;
  queryTemplates?: CompletionTemplates;
}

/** Response from GET /endpoints/ — a dict keyed by slug. */
export type EndpointListResponse = Record<string, SparqlEndpointConfiguration>;
