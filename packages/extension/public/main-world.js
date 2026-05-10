/**
 * Main world script — runs in the Overleaf tab's main context.
 *
 * Reads the full document from the CodeMirror 6 state (not the DOM, which is
 * virtualized and only contains visible lines).
 */

/**
 * Find the CM6 EditorView for a given .cm-editor element.
 *
 * CM6 sets `dom.cmView` on the *content* element (.cm-content), not on the
 * outer .cm-editor wrapper.  That cmView is a DocView whose `.view` property
 * is the EditorView we want.
 */
function findEditorView(editor) {
  // 1. Canonical CM6 path: .cm-content.cmView.view (DocView → EditorView).
  try {
    const v = editor.querySelector('.cm-content')?.cmView?.view;
    if (typeof v?.state?.doc?.toString === 'function') return v;
  } catch {}

  // 2. Scan every child element for a cmView that leads to an EditorView.
  for (const el of editor.querySelectorAll('*')) {
    try {
      if (typeof el.cmView?.view?.state?.doc?.toString === 'function') return el.cmView.view;
      if (typeof el.cmView?.state?.doc?.toString === 'function') return el.cmView;
    } catch {}
  }

  // 3. React fiber traversal — walk up the fiber tree from .cm-editor looking
  //    for a ref or state slot that holds an EditorView.
  const fiberKey = Object.keys(editor).find(
    (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'),
  );
  if (fiberKey) {
    let fiber = editor[fiberKey];
    let depth = 0;
    while (fiber && depth < 60) {
      try {
        let s = fiber.memoizedState;
        while (s) {
          const v = s.memoizedState ?? s;
          if (v?.state?.doc && typeof v.state.doc.toString === 'function') return v;
          s = s.next;
        }
        const props = fiber.memoizedProps;
        if (props) {
          for (const key of Object.keys(props)) {
            const v = props[key];
            if (v?.state?.doc && typeof v.state.doc.toString === 'function') return v;
          }
        }
      } catch {}
      fiber = fiber.return;
      depth++;
    }
  }

  return null;
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.type !== 'LALE_DOC_TEXT_REQUEST') return;

  const { nonce } = event.data;
  try {
    const editor = document.querySelector('.cm-editor');
    if (!editor) {
      console.warn('[lale] .cm-editor not found');
      window.postMessage({ type: 'LALE_DOC_TEXT_REPLY', text: null, nonce }, '*');
      return;
    }

    const view = findEditorView(editor);
    if (!view) {
      console.warn('[lale] could not locate CM6 EditorView on .cm-editor — virtualized DOM text unavailable');
      window.postMessage({ type: 'LALE_DOC_TEXT_REPLY', text: null, nonce }, '*');
      return;
    }

    const text = view.state.doc.toString();
    window.postMessage({ type: 'LALE_DOC_TEXT_REPLY', text, nonce }, '*');
  } catch (e) {
    console.error('[lale] main-world error:', e);
    window.postMessage({ type: 'LALE_DOC_TEXT_REPLY', text: null, nonce }, '*');
  }
});
