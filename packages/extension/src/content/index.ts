/**
 * Content script — runs in the Overleaf tab.
 *
 * 1. Locate the CodeMirror 6 editor view.
 * 2. Read the doc, parse claims, debounce 1.5s.
 * 3. Push the latest claim snapshot to the service worker.
 * 4. Listen for `setStatus` messages from the service worker and update gutter decorations.
 *
 * Degrades gracefully if Overleaf's editor internals can't be reached — the side panel offers a
 * paste-LaTeX fallback in that case.
 */

import { type ClaimStatus, type ContentMessage } from '@lale/shared';
import { parseClaims } from './parser';
import { setClaimStatus, setDecorations } from './editor-decorations';

const DEBOUNCE_MS = 1500;
let timer: ReturnType<typeof setTimeout> | null = null;
let mo: MutationObserver | null = null;

function getDocText(): string | null {
  // CM6 editor view is exposed via .cm-editor at the DOM root. We can also walk the React
  // internal but that's even more fragile. Fall back to .cm-content text content.
  const editor = document.querySelector('.cm-editor');
  if (!editor) return null;
  // Prefer cmView.view.state.doc if reachable (more reliable than concatenating .cm-line text,
  // since CM virtualizes long docs).
  const anyEditor = editor as unknown as { cmView?: { view?: { state?: { doc?: { toString(): string } } } } };
  const doc = anyEditor.cmView?.view?.state?.doc;
  if (doc && typeof doc.toString === 'function') {
    return doc.toString();
  }
  // Best-effort fallback.
  return editor.querySelector('.cm-content')?.textContent ?? null;
}

async function parseAndPush(): Promise<void> {
  const src = getDocText();
  if (src == null) return;
  const claims = await parseClaims(src);

  setDecorations(
    claims.map((c) => ({ claimId: c.id, line: c.startLine, status: c.status })),
  );

  const snapshotMessage: ContentMessage = {
    type: 'claimsSnapshot',
    claims,
  };
  chrome.runtime.sendMessage(snapshotMessage).catch(() => {
    // Service worker might be asleep; it'll wake on the next message.
  });
}

function scheduleParse(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void parseAndPush();
  }, DEBOUNCE_MS);
}

function attachObserver(): void {
  if (mo) return;
  const editor = document.querySelector('.cm-editor');
  if (!editor) {
    setTimeout(attachObserver, 1000);
    return;
  }
  mo = new MutationObserver(() => scheduleParse());
  mo.observe(editor, { childList: true, subtree: true, characterData: true });
  // Initial parse.
  void parseAndPush();
}

attachObserver();

// Listen for status updates pushed from the service worker.
chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: string }).type === 'setStatus'
  ) {
    const m = msg as { type: 'setStatus'; claimId: string; status: ClaimStatus };
    setClaimStatus(m.claimId, m.status);
  }
});
