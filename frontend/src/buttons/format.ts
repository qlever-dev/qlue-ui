import type { Editor } from '../editor/init';

export function setupFormat(editor: Editor) {
  const formatButton = document.getElementById('formatButton')!;
  formatButton.addEventListener('click', () => {
    formatDocument(editor);
  });
}

export function formatDocument(editor: Editor) {
  editor.editorApp.getEditor()!.trigger('button', 'editor.action.formatDocument', {});
}
