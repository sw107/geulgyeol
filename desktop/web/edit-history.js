// Studio owns document history; ordinary dialog fields own browser history.
const composingDocuments = new WeakSet();
const observedDocuments = new WeakSet();
export function observeComposition(document) {
  if (observedDocuments.has(document)) return;
  observedDocuments.add(document);
  document.addEventListener('compositionstart', () => composingDocuments.add(document), true);
  document.addEventListener('compositionend', () => composingDocuments.delete(document), true);
  document.defaultView?.addEventListener('pagehide', () => composingDocuments.delete(document));
}

export async function routeHistory(action, {document, editor, busy = false}) {
  if (!['undo', 'redo'].includes(action) || busy || !editor) return;
  let focusedDocument = document;
  let active = focusedDocument.activeElement;
  while (active?.tagName === 'IFRAME' && active.contentDocument) {
    if (focusedDocument.querySelector('dialog[open], [aria-modal="true"]')) return;
    focusedDocument = active.contentDocument;
    active = focusedDocument.activeElement;
  }
  // Do not change history beneath an uncommitted IME composition. Do not queue:
  // by compositionend the user may have changed the document or focus.
  if (composingDocuments.has(focusedDocument)) return;
  const isDocumentInput = active?.getAttribute?.('aria-label') === '문서 편집 입력';
  const isField = active && (['INPUT', 'TEXTAREA'].includes(active.tagName) || active.isContentEditable);
  if (isField && !isDocumentInput) {
    focusedDocument.execCommand(action);
    return;
  }
  // A modal must not allow an unrelated document edit behind it.
  if (focusedDocument.querySelector('dialog[open], [aria-modal="true"]')) return;
  return editor.commands.execute(`edit:${action}`);
}
