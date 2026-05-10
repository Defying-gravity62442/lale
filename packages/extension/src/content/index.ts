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

// Inject into the main world so we can access the CodeMirror instance directly.
// Use a variable (not a string literal) so CRXJS's static analysis doesn't treat
// main-world.js as a content-script entry and generate a broken MAIN-world loader.
const mainWorldResource = 'main-world.js';
const script = document.createElement('script');
script.src = chrome.runtime.getURL(mainWorldResource);
document.head.appendChild(script);

const DEBOUNCE_MS = 1500;
let timer: ReturnType<typeof setTimeout> | null = null;
let mo: MutationObserver | null = null;

function requestDocText(): Promise<string | null> {
  return new Promise((resolve) => {
    const nonce = Math.random().toString(36).substring(7);

    const listener = (event: MessageEvent) => {
      if (
        event.source === window &&
        event.data?.type === 'LALE_DOC_TEXT_REPLY' &&
        event.data?.nonce === nonce
      ) {
        window.removeEventListener('message', listener);
        if (timeout) clearTimeout(timeout);
        resolve(event.data.text ?? null);
      }
    };

    window.addEventListener('message', listener);
    window.postMessage({ type: 'LALE_DOC_TEXT_REQUEST', nonce }, '*');

    // Fallback timeout in case the main world script fails to respond
    const timeout = setTimeout(() => {
      window.removeEventListener('message', listener);
      resolve(null);
    }, 1000);
  });
}

async function parseAndPush(): Promise<void> {
  const src = await requestDocText();
  if (src == null) return;
  console.log('[lale] raw LaTeX doc:\n', src);
  const claims = await parseClaims(src);

  setDecorations(
    claims.map((c) => ({ claimId: c.id, label: c.label, line: c.startLine, status: c.status })),
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
