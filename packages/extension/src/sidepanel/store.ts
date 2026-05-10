/**
 * Side-panel state — a Zustand store backed by chrome.storage.local for survival across reloads.
 *
 * Drives the view router (main / dependency / verifying / success / failure / settings) plus the
 * claims list and per-request SSE event log.
 */

import { create } from 'zustand';
import { PORT_NAME, type Claim, type PortMessage, type PortRequest, type SseEvent } from '@lale/shared';

export type View = 'main' | 'dependency' | 'verifying' | 'success' | 'failure' | 'settings' | 'empty';

export interface Settings {
  backendUrl: string;
}

const DEFAULT_SETTINGS: Settings = {
  backendUrl: 'http://localhost:8765',
};

const PERSIST_KEY = 'lale.sidepanel.v1';

interface PerRequestState {
  requestId: string;
  targetClaimId: string;
  events: SseEvent[];
  finished: 'verified' | 'failed' | 'partial' | null;
}

interface State {
  view: View;
  selectedClaimId: string | null;
  claims: Claim[];
  settings: Settings;
  connected: boolean;
  byRequest: Record<string, PerRequestState>;
  activeRequestId: string | null;
  errorMessage: string | null;

  setView: (v: View) => void;
  selectClaim: (id: string | null) => void;
  startVerify: (claimId: string) => void;
  cancelVerify: () => void;
  setSettings: (s: Settings) => void;
  applySse: (ev: SseEvent) => void;
  receiveSnapshot: (claims: Claim[]) => void;
  receiveSettings: (s: Settings) => void;
  setError: (msg: string | null) => void;
}

let port: chrome.runtime.Port | null = null;

function connect(setState: (fn: (s: State) => Partial<State>) => void): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.connect) {
    return; // dev outside Chrome
  }
  port = chrome.runtime.connect({ name: PORT_NAME });
  setState(() => ({ connected: true }));
  port.onDisconnect.addListener(() => {
    setState(() => ({ connected: false }));
    port = null;
    // Reconnect with backoff.
    setTimeout(() => connect(setState), 500);
  });
  port.onMessage.addListener((msg: unknown) => {
    const m = msg as PortMessage;
    if (m.type === 'claimsSnapshot') {
      useStore.getState().receiveSnapshot(m.claims);
    } else if (m.type === 'sse') {
      useStore.getState().applySse(m.event);
    } else if (m.type === 'settings') {
      useStore.getState().receiveSettings(m.settings);
    } else if (m.type === 'error') {
      useStore.getState().setError(m.message);
    }
  });
  // Ask for fresh snapshot + settings.
  send({ type: 'listClaims' });
  send({ type: 'getSettings' });
}

export function send(req: PortRequest): void {
  port?.postMessage(req);
}

function loadPersisted(): Partial<State> {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<State>;
  } catch {
    return {};
  }
}

function normalizeSettings(raw: unknown): Settings {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { backendUrl?: unknown }).backendUrl === 'string'
  ) {
    return { backendUrl: (raw as { backendUrl: string }).backendUrl };
  }
  return DEFAULT_SETTINGS;
}

function persist(s: State): void {
  try {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        view: s.view,
        selectedClaimId: s.selectedClaimId,
        settings: s.settings,
        activeRequestId: s.activeRequestId,
      }),
    );
  } catch {
    /* localStorage might be blocked in some contexts */
  }
}

export const useStore = create<State>((set, get) => {
  const initial = loadPersisted();
  return {
    view: (initial.view as View) ?? 'main',
    selectedClaimId: initial.selectedClaimId ?? null,
    claims: [],
    settings: normalizeSettings(initial.settings),
    connected: false,
    byRequest: {},
    activeRequestId: initial.activeRequestId ?? null,
    errorMessage: null,

    setView: (v) => {
      set({ view: v });
      persist(get());
    },
    selectClaim: (id) => {
      set({ selectedClaimId: id });
      persist(get());
    },
    startVerify: (claimId) => {
      set({ view: 'verifying', selectedClaimId: claimId, errorMessage: null });
      persist(get());
      send({ type: 'verifyClaim', claimId });
    },
    cancelVerify: () => {
      const { activeRequestId } = get();
      if (activeRequestId) {
        send({ type: 'cancelVerification', requestId: activeRequestId });
      }
      set({ view: 'main', activeRequestId: null });
      persist(get());
    },
    setSettings: (s) => {
      set({ settings: s });
      persist(get());
      send({ type: 'setSettings', settings: s });
    },
    receiveSettings: (s) => {
      set({ settings: s });
      persist(get());
    },
    applySse: (ev) => {
      const { byRequest, claims } = get();
      const prev = byRequest[ev.requestId] ?? {
        requestId: ev.requestId,
        targetClaimId: ev.type === 'orchestratorStarted' ? ev.targetClaimId : '',
        events: [],
        finished: null,
      };
      const nextEvents = [...prev.events, ev];
      const finished =
        ev.type === 'orchestratorFinished' ? ev.overall : prev.finished;
      const next: PerRequestState = {
        ...prev,
        events: nextEvents,
        finished,
        targetClaimId:
          ev.type === 'orchestratorStarted' ? ev.targetClaimId : prev.targetClaimId,
      };
      const view: View | undefined =
        ev.type === 'orchestratorFinished'
          ? ev.overall === 'verified'
            ? 'success'
            : 'failure'
          : undefined;

      let updatedClaims = claims;
      if (ev.type === 'claimDependencies') {
        updatedClaims = claims.map((c) =>
          c.id === ev.claimId ? { ...c, llmDependencyIds: ev.llmDependencyIds } : c,
        );
      } else if (ev.type === 'claimStatus') {
        updatedClaims = claims.map((c) =>
          c.id === ev.claimId ? { ...c, status: ev.status } : c,
        );
      } else if (ev.type === 'claimVerified') {
        updatedClaims = claims.map((c) =>
          c.id === ev.claimId ? { ...c, status: 'verified' as const } : c,
        );
      } else if (ev.type === 'claimFailed') {
        updatedClaims = claims.map((c) =>
          c.id === ev.claimId ? { ...c, status: 'failed' as const } : c,
        );
      }

      set({
        byRequest: { ...byRequest, [ev.requestId]: next },
        activeRequestId: ev.requestId,
        claims: updatedClaims,
        ...(view ? { view } : {}),
      });
      persist(get());
    },
    receiveSnapshot: (claims) => {
      const { view, selectedClaimId } = get();
      const claimExists = selectedClaimId != null && claims.some((c) => c.id === selectedClaimId);
      // If the user switched papers while on a claim-specific view, navigate back to main
      // so they see the new paper's claims instead of a dead-end "Claim not found" screen.
      if (!claimExists && (view === 'dependency' || view === 'success' || view === 'failure')) {
        set({ claims, view: 'main', selectedClaimId: null });
        persist(get());
      } else {
        set({ claims });
      }
    },
    setError: (msg) => set({ errorMessage: msg }),
  };
});

// Kick off the connection on first import.
connect((fn) => useStore.setState(fn(useStore.getState())));
