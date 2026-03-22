export interface FormatSettings {
  alignPrefixes: boolean;
  alignPredicates: boolean;
  separatePrologue: boolean;
  capitalizeKeywords: boolean;
  insertSpaces: boolean;
  tabSize: number;
  whereNewLine: boolean;
  filterSameLine: boolean;
  contractTriples: boolean;
  keepEmptyLines: boolean;
  compact: number | null;
  lineLength: number;
}

export interface CompletionSettings {
  timeoutMs: number;
  resultSizeLimit: number;
  subjectCompletionTriggerLength: number;
  objectCompletionSuffix: boolean;
  sameSubjectSemicolon: boolean;
  variableCompletionLimit: number | null;
}

export interface PrefixSettings {
  addMissing: boolean;
  removeUnused: boolean;
}

export interface Replacement {
  pattern: string;
  replacement: string;
}

export interface Replacements {
  objectVariable: Replacement[];
}

export interface QlueLsSettings {
  format: FormatSettings;
  completion: CompletionSettings;
  prefixes: PrefixSettings;
  replacements?: Replacements;
  jumpWithTab: boolean;
  autoLineBreak: boolean;
}

export interface MonacoSettings {
  vimMode: boolean;
}

export interface UiSettings {
  general: GeneralSettings;
  editor: QlueLsSettings;
  results: ResultsSettings;
}

export interface ResultsSettings {
  typeAnnotations: boolean;
  langAnnotations: boolean;
  loadImages: boolean;
  shortenIris: boolean;
  limit: number;
}

export interface GeneralSettings {
  accessToken: string | null;
  uiMode: UiMode;
}

export type UiMode = 'results' | 'compare';
