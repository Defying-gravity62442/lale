/**
 * Service worker / background.
 *
 * Responsibilities:
 *   - Maintain per-tab claim snapshots (in chrome.storage.local for service-worker-death survival)
 *   - Route side-panel port traffic
 *   - Handle verifyClaim → backend `/verify_paper` SSE stream → push events back over the port
 *   - On wakeup, rehydrate any in-flight requestId from chrome.storage and call /status/{id}
 *     to catch up.
 *
 * The service worker can be killed at any time. Anything that must survive death lives in
 * chrome.storage; nothing that matters lives in module-level Maps.
 */

import {
  PORT_NAME,
  type Claim,
  type ContentMessage,
  type PortMessage,
  type PortRequest,
  type SseEvent,
} from '@lale/shared';

interface Settings {
  backendUrl: string;
}

const DEFAULT_SETTINGS: Settings = {
  backendUrl: 'http://localhost:8765',
};

const STORAGE_KEYS = {
  claimsByTab: 'claimsByTab',
  inflight: 'inflight',
  settings: 'settings',
} as const;

interface InflightEntry {
  requestId: string;
  tabId: number;
  targetClaimId: string;
  startedAt: number;
}

// In-memory only: AbortControllers for active fetches. Meaningless after service-worker death
// (the fetch dies with the worker), so no need to persist.
const inflightAborts = new Map<string, AbortController>();

// ---------- Storage helpers ----------

async function getSettings(): Promise<Settings> {
  const got = await chrome.storage.sync.get(STORAGE_KEYS.settings);
  const saved = got[STORAGE_KEYS.settings] as Partial<Settings> | undefined;
  return { backendUrl: saved?.backendUrl ?? DEFAULT_SETTINGS.backendUrl };
}

async function setSettings(s: Settings): Promise<void> {
  await chrome.storage.sync.set({ [STORAGE_KEYS.settings]: s });
}

async function getClaimsForTab(tabId: number): Promise<Claim[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.claimsByTab);
  const map = (got[STORAGE_KEYS.claimsByTab] ?? {}) as Record<string, Claim[]>;
  return map[String(tabId)] ?? [];
}

async function setClaimsForTab(tabId: number, claims: Claim[]): Promise<void> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.claimsByTab);
  const map = (got[STORAGE_KEYS.claimsByTab] ?? {}) as Record<string, Claim[]>;
  map[String(tabId)] = claims;
  await chrome.storage.local.set({ [STORAGE_KEYS.claimsByTab]: map });
}

async function getInflight(): Promise<InflightEntry[]> {
  const got = await chrome.storage.local.get(STORAGE_KEYS.inflight);
  return (got[STORAGE_KEYS.inflight] ?? []) as InflightEntry[];
}

async function addInflight(entry: InflightEntry): Promise<void> {
  const list = await getInflight();
  list.push(entry);
  await chrome.storage.local.set({ [STORAGE_KEYS.inflight]: list });
}

async function removeInflight(requestId: string): Promise<void> {
  const list = await getInflight();
  await chrome.storage.local.set({
    [STORAGE_KEYS.inflight]: list.filter((e) => e.requestId !== requestId),
  });
}

// ---------- Active port for the side panel ----------
//
// We don't try to persist this — if the worker dies, the panel reconnects.

let panelPort: chrome.runtime.Port | null = null;

function postToPanel(msg: PortMessage): void {
  panelPort?.postMessage(msg);
}

// ---------- Active tab tracking ----------

let activeTabId: number | null = null;

async function refreshActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tab?.id ?? null;
}

// ---------- Content script messages ----------

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id ?? -1;
  const m = msg as ContentMessage;
  if (m.type === 'claimsSnapshot') {
    void setClaimsForTab(tabId, m.claims).then(async () => {
      // Forward snapshot to the panel if it's the active tab.
      if (panelPort && tabId === activeTabId) {
        postToPanel({ type: 'claimsSnapshot', claims: m.claims });
      }
    });
  }
});

// ---------- Port: side panel ----------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === PORT_NAME) {
    panelPort = port;
    void onPanelConnected(port);
    port.onDisconnect.addListener(() => {
      if (panelPort === port) panelPort = null;
    });
    port.onMessage.addListener((req: unknown) => {
      void handlePortRequest(port, req as PortRequest);
    });
  }
});

async function onPanelConnected(port: chrome.runtime.Port): Promise<void> {
  await refreshActiveTab();
  // Push current snapshot.
  if (activeTabId != null) {
    const claims = await getClaimsForTab(activeTabId);
    port.postMessage({ type: 'claimsSnapshot', claims } satisfies PortMessage);
  } else {
    port.postMessage({ type: 'claimsSnapshot', claims: [] } satisfies PortMessage);
  }
  port.postMessage({ type: 'settings', settings: await getSettings() } satisfies PortMessage);

  // Resume any in-flight verifications.
  const inflight = await getInflight();
  for (const entry of inflight) {
    if (entry.tabId === activeTabId) {
      void resumeInflight(entry);
    }
  }
}

async function handlePortRequest(port: chrome.runtime.Port, req: PortRequest): Promise<void> {
  if (req.type === 'getSettings') {
    port.postMessage({ type: 'settings', settings: await getSettings() } satisfies PortMessage);
    return;
  }
  if (req.type === 'setSettings') {
    await setSettings(req.settings);
    port.postMessage({ type: 'settings', settings: req.settings } satisfies PortMessage);
    return;
  }
  if (req.type === 'listClaims') {
    if (activeTabId == null) await refreshActiveTab();
    const claims = activeTabId != null ? await getClaimsForTab(activeTabId) : [];
    port.postMessage({ type: 'claimsSnapshot', claims } satisfies PortMessage);
    return;
  }
  if (req.type === 'verifyClaim') {
    await refreshActiveTab();
    if (activeTabId == null) {
      port.postMessage({ type: 'error', message: 'No active Overleaf tab.' } satisfies PortMessage);
      return;
    }
    const claims = await getClaimsForTab(activeTabId);
    const target = claims.find((c) => c.id === req.claimId);
    if (!target) {
      port.postMessage({ type: 'error', message: `Unknown claim id: ${req.claimId}` } satisfies PortMessage);
      return;
    }
    void startVerification(activeTabId, req.claimId, claims);
    return;
  }
  if (req.type === 'cancelVerification') {
    inflightAborts.get(req.requestId)?.abort();
    inflightAborts.delete(req.requestId);
    await removeInflight(req.requestId);
    // Reset any claims still in-progress so MainView doesn't show them as "translating".
    if (activeTabId != null) {
      const claims = await getClaimsForTab(activeTabId);
      const reset = claims.map((c) =>
        c.status === 'translating' || c.status === 'verifying'
          ? { ...c, status: 'unverified' as const }
          : c,
      );
      await setClaimsForTab(activeTabId, reset);
      postToPanel({ type: 'claimsSnapshot', claims: reset });
    }
    return;
  }
}

// ---------- Backend interaction ----------

function uuid(): string {
  return crypto.randomUUID();
}

async function startVerification(tabId: number, targetClaimId: string, claims: Claim[]): Promise<void> {
  const settings = await getSettings();
  const requestId = uuid();
  const entry: InflightEntry = {
    requestId,
    tabId,
    targetClaimId,
    startedAt: Date.now(),
  };
  await addInflight(entry);

  // Update content-script gutter optimistically: target -> verifying.
  await pushStatusToContent(tabId, targetClaimId, 'verifying');

  const controller = new AbortController();
  inflightAborts.set(requestId, controller);

  const url = new URL('/verify_paper', settings.backendUrl);
  console.log('[lale] startVerification →', url.toString(), { requestId, targetClaimId, claimCount: claims.length });
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId,
        targetClaimId,
        claims,
        leanVersion: '4.13.0',
        mathlibVersion: 'local',
      }),
      signal: controller.signal,
    });
    console.log('[lale] verify_paper response', res.status, res.statusText);
    if (!res.ok || !res.body) {
      postToPanel({
        type: 'error',
        message: `Backend rejected verify_paper: ${res.status} ${res.statusText}`,
      });
      await removeInflight(requestId);
      return;
    }
    await consumeSse(res.body, tabId, requestId);
  } catch (err) {
    console.error('[lale] verify_paper fetch error', err);
    if ((err as Error).name !== 'AbortError') {
      postToPanel({
        type: 'error',
        message: `Backend unreachable at ${settings.backendUrl}: ${(err as Error).message}`,
      });
    }
    await removeInflight(requestId);
  } finally {
    inflightAborts.delete(requestId);
  }
}

async function consumeSse(body: ReadableStream<Uint8Array>, tabId: number, requestId: string): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let chunkCount = 0;
  console.log('[lale] consumeSse started', requestId);
  while (true) {
    const { value, done } = await reader.read();
    if (done) { console.log('[lale] consumeSse stream done', { chunkCount }); break; }
    chunkCount++;
    const text = decoder.decode(value, { stream: true });
    console.log('[lale] SSE chunk #' + chunkCount, JSON.stringify(text.slice(0, 200)));
    buf += text;
    const events = parseSseChunks(buf);
    buf = events.tail;
    for (const ev of events.events) {
      try {
        const parsed = JSON.parse(ev) as SseEvent;
        console.log('[lale] SSE event', parsed.type, parsed);
        await handleSseEvent(tabId, parsed);
      } catch (e) {
        console.warn('[lale] malformed SSE chunk', ev, e);
      }
    }
  }
  await removeInflight(requestId);
}

function parseSseChunks(buf: string): { events: string[]; tail: string } {
  const out: string[] = [];
  const parts = buf.replace(/\r\n/g, '\n').split('\n\n');
  const tail = parts.pop() ?? '';
  for (const block of parts) {
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) out.push(dataLines.join('\n'));
  }
  return { events: out, tail };
}

async function handleSseEvent(tabId: number, ev: SseEvent): Promise<void> {
  postToPanel({ type: 'sse', event: ev });
  if (ev.type === 'claimStatus') {
    await pushStatusToContent(tabId, ev.claimId, ev.status);
  } else if (ev.type === 'claimVerified') {
    await pushStatusToContent(tabId, ev.claimId, 'verified');
  } else if (ev.type === 'claimFailed') {
    await pushStatusToContent(tabId, ev.claimId, 'failed');
  }
}

async function pushStatusToContent(
  tabId: number,
  claimId: string,
  status: Claim['status'],
): Promise<void> {
  // Persist the new status in the snapshot so the side panel re-show is consistent.
  const claims = await getClaimsForTab(tabId);
  const next = claims.map((c) => (c.id === claimId ? { ...c, status } : c));
  await setClaimsForTab(tabId, next);
  // Push to content for gutter.
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'setStatus', claimId, status });
  } catch {
    /* tab might be closed */
  }
  // Push to panel as a snapshot so it can re-render.
  postToPanel({ type: 'claimsSnapshot', claims: next });
}

async function resumeInflight(entry: InflightEntry): Promise<void> {
  const settings = await getSettings();
  const url = new URL(`/status/${entry.requestId}`, settings.backendUrl);
  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      await removeInflight(entry.requestId);
      return;
    }
    const data = (await res.json()) as { events: SseEvent[]; state: string };
    for (const ev of data.events) {
      await handleSseEvent(entry.tabId, ev);
    }
    if (data.state !== 'running') {
      await removeInflight(entry.requestId);
    }
  } catch {
    /* backend down */
  }
}

// ---------- Side panel binding ----------

chrome.action?.onClicked.addListener(async (tab) => {
  if (tab.id != null) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// ---------- Tab tracking ----------

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  activeTabId = tabId;
  if (panelPort) {
    const claims = await getClaimsForTab(tabId);
    postToPanel({ type: 'claimsSnapshot', claims });
  }
});

void refreshActiveTab();
