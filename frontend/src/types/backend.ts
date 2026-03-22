export interface PrefixMap {
  [key: string]: string;
}

export interface Queries {
  [key: string]: string;
}

export interface QlueLsServiceConfig {
  name: string;
  url: string;
  engine: string;
  healthCheckUrl?: string;
  prefixMap: PrefixMap;
  queries: Queries;
  default: boolean;
  additionalData: any;
}

export interface UiServiceConfig {
  slug: string;
  url: string;
  engine: string;
  prefix_map: PrefixMap;
  subject_completion: string;
  predicate_completion_context_sensitive: string;
  predicate_completion_context_insensitive: string;
  object_completion_context_sensitive: string;
  object_completion_context_insensitive: string;
  values_completion_context_sensitive: string;
  values_completion_context_insensitive: string;
  hover: string;
  map_view_url?: string;
}
