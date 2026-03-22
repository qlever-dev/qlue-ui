import type { Editor } from '../editor/init';
import { setupClearCache } from './clear_cache';
import { setupDatasetInformation } from './dataset_information';
import { setupDownload } from './download';
import { setupExecute } from './execute';
import { setupFormat } from './format';
import { setupFullResult } from './full_result';
import { setupHelp } from './help';

/**
 * Initializes all toolbar buttons: execute, format, download, clear cache,
 * dataset information, help, and full-result toggle.
 */
export function setupButtons(editor: Editor) {
  setupExecute();
  setupFormat(editor);
  setupDownload(editor);
  setupClearCache(editor);
  setupDatasetInformation(editor);
  setupHelp();
  setupFullResult();
}
