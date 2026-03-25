import type { Editor } from '../editor/init';

export function setupFormat(editor: Editor) {
  const formatButton = document.getElementById('formatButton')!;
  formatButton.addEventListener('click', () => {
    formatDocument(editor);
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: {
          type: 'success',
          message: 'Query formatted',
          duration: 2000,
        },
      })
    );
  });
}

export function formatDocument(editor: Editor) {
  editor.editorApp.getEditor()!.trigger('button', 'editor.action.formatDocument', {});
}
