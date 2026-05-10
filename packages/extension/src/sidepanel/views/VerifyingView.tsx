import { useMemo, useRef, useEffect, useState } from 'react';
import { Loader2, Check, X, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useStore } from '../store';
import { ClaimTypePill } from '../components/ClaimTypePill';
import { StatusBadge } from '../components/StatusBadge';
import type { Claim, SseEvent } from '@lale/shared';

// ── helpers ──────────────────────────────────────────────────────────────────

function shortId(claims: Claim[], id: string): string {
  const c = claims.find((x) => x.id === id);
  return c?.label ?? id;
}

const ROOT_CAUSE_LABEL: Record<string, string> = {
  unknownIdentifier: 'unknown identifier',
  typeMismatch: 'type mismatch',
  tacticFailed: 'tactic failed',
  timeout: 'timed out',
  malformedJson: 'translation failed',
  other: 'error',
};

const VERDICT_LABEL: Record<string, string> = {
  mathlib_candidate: 'Mathlib candidate ★',
  project_local: 'project-local',
  duplicate_likely: 'likely duplicate',
  needs_generalization: 'needs generalization',
  not_worth_submitting: 'not for Mathlib',
  unsure: 'unsure',
  skipped: 'skipped',
};

// ── log entry types ───────────────────────────────────────────────────────────

type LogKind = 'translating' | 'verifying' | 'verified' | 'failed' | 'info' | 'analysis';

interface LogEntry {
  key: string;
  kind: LogKind;
  message: string;
  sub?: string;
  lean?: string;
}

function toLogEntries(events: SseEvent[], claims: Claim[]): LogEntry[] {
  const out: LogEntry[] = [];
  let i = 0;
  for (const ev of events) {
    const k = String(i++);

    if (ev.type === 'orchestratorStarted') {
      const n = ev.plan.reduce((s, l) => s + l.claimIds.length, 0);
      const lvls = ev.plan.length;
      out.push({
        key: k,
        kind: 'info',
        message: `Plan: ${n} claim${n !== 1 ? 's' : ''} across ${lvls} level${lvls !== 1 ? 's' : ''}`,
      });

    } else if (ev.type === 'claimStatus') {
      const name = shortId(claims, ev.claimId);

      if (ev.status === 'translating') {
        if (!ev.detail) {
          out.push({ key: k, kind: 'translating', message: `Translating ${name}`, sub: 'LaTeX → Lean 4 via Claude' });
        } else if (ev.detail === 'retrieving local Mathlib context') {
          out.push({ key: k, kind: 'translating', message: `Searching Mathlib`, sub: `looking up lemmas for ${name}` });
        } else if (ev.detail.startsWith('retry after ')) {
          const err = ev.detail.replace('retry after ', '');
          out.push({ key: k, kind: 'translating', message: `Retrying ${name}`, sub: ROOT_CAUSE_LABEL[err] ?? err });
        } else {
          out.push({ key: k, kind: 'translating', message: name, sub: ev.detail });
        }
      } else if (ev.status === 'verifying') {
        if (ev.detail === 'semantic review') {
          out.push({ key: k, kind: 'verifying', message: `Semantic review`, sub: `checking ${name} for faithfulness` });
        } else {
          const sub = ev.detail ?? 'Lean 4 type-checker';
          out.push({ key: k, kind: 'verifying', message: `Running Lean 4 on ${name}`, sub });
        }
      }

    } else if (ev.type === 'claimVerified') {
      const name = shortId(claims, ev.claimId);
      const time = ev.elapsedMs > 0 ? `${(ev.elapsedMs / 1000).toFixed(1)}s` : null;
      out.push({
        key: k,
        kind: 'verified',
        message: `${name} verified`,
        sub: ev.cacheHit ? 'cache hit' : time ?? undefined,
      });

    } else if (ev.type === 'claimFailed') {
      const name = shortId(claims, ev.claimId);
      out.push({
        key: k,
        kind: 'failed',
        message: `${name} failed`,
        sub: ROOT_CAUSE_LABEL[ev.rootCauseCategory] ?? 'error',
        lean: ev.leanOutput ?? undefined,
      });

    } else if (ev.type === 'mathlibWorthiness') {
      const verdict = VERDICT_LABEL[ev.verdict] ?? ev.verdict;
      const conf = Math.round(ev.confidence * 100);
      out.push({
        key: k,
        kind: 'analysis',
        message: `Mathlib: ${verdict}`,
        sub: `${conf}% confidence — ${ev.reason.slice(0, 90)}${ev.reason.length > 90 ? '…' : ''}`,
      });
    }
  }
  return out;
}

// ── per-claim live status for plan overview ───────────────────────────────────

function buildClaimLive(events: SseEvent[]): Map<string, { status: string; detail?: string; cacheHit?: boolean }> {
  const m = new Map<string, { status: string; detail?: string; cacheHit?: boolean }>();
  for (const ev of events) {
    if (ev.type === 'claimStatus') {
      m.set(ev.claimId, { status: ev.status, detail: ev.detail ?? undefined });
    } else if (ev.type === 'claimVerified') {
      m.set(ev.claimId, { status: 'verified', cacheHit: ev.cacheHit });
    } else if (ev.type === 'claimFailed') {
      m.set(ev.claimId, { status: 'failed' });
    }
  }
  return m;
}

// ── main component ────────────────────────────────────────────────────────────

export function VerifyingView() {
  const requestId = useStore((s) => s.activeRequestId);
  const byRequest = useStore((s) => s.byRequest);
  const claims = useStore((s) => s.claims);

  const run = requestId ? byRequest[requestId] : undefined;
  const target = claims.find((c) => c.id === run?.targetClaimId);

  const plan = useMemo(() => {
    if (!run) return [];
    const start = run.events.find((e) => e.type === 'orchestratorStarted');
    if (start?.type === 'orchestratorStarted') return start.plan;
    return [];
  }, [run]);

  const allPlanIds = useMemo(() => plan.flatMap((l) => l.claimIds), [plan]);

  const claimLive = useMemo(() => buildClaimLive(run?.events ?? []), [run]);

  const doneCount = useMemo(
    () => allPlanIds.filter((id) => ['verified', 'failed'].includes(claimLive.get(id)?.status ?? '')).length,
    [allPlanIds, claimLive],
  );

  const logEntries = useMemo(() => toLogEntries(run?.events ?? [], claims), [run, claims]);

  // Auto-scroll to bottom as log grows.
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logEntries.length]);

  const [expandedLean, setExpandedLean] = useState<Set<string>>(new Set());
  const toggleLean = (key: string) =>
    setExpandedLean((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Loader2 size={13} className="animate-spin" style={{ color: 'var(--status-verifying)' }} />
            <h2 className="font-semibold text-sm">Verifying</h2>
          </div>
          {allPlanIds.length > 1 && (
            <span className="text-[10px] text-muted-foreground">
              {doneCount} / {allPlanIds.length} done
            </span>
          )}
        </div>
        {target && (
          <div className="flex items-center gap-2">
            <ClaimTypePill type={target.type} />
            <code className="text-[11px] text-muted-foreground truncate" style={{ fontFamily: 'var(--font-mono)' }}>
              {target.label ?? target.id}
            </code>
          </div>
        )}
      </div>

      {/* ── Plan overview (only when multiple claims) ── */}
      {allPlanIds.length > 1 && (
        <div className="px-4 py-2 border-b border-border shrink-0 space-y-1">
          {allPlanIds.map((cid) => {
            const cl = claims.find((c) => c.id === cid);
            const live = claimLive.get(cid);
            return (
              <div key={cid} className="flex items-center gap-2">
                <StatusBadge status={(live?.status ?? 'unverified') as never} />
                {cl && <ClaimTypePill type={cl.type} />}
                <code className="text-[10px] text-muted-foreground truncate flex-1" style={{ fontFamily: 'var(--font-mono)' }}>
                  {cl?.label ?? cid}
                </code>
                {live?.detail && (
                  <span className="text-[9px] text-muted-foreground/60 shrink-0 italic">{live.detail}</span>
                )}
                {live?.cacheHit && (
                  <span className="text-[9px] text-muted-foreground/60 shrink-0">cache</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Activity log ── */}
      <div ref={logRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5">
        {logEntries.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground">
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
              style={{ backgroundColor: 'var(--status-verifying)' }}
            />
            Waiting for backend…
          </div>
        ) : (
          logEntries.map((entry) => (
            <LogRow
              key={entry.key}
              entry={entry}
              expanded={expandedLean.has(entry.key)}
              onToggle={() => toggleLean(entry.key)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── LogRow ────────────────────────────────────────────────────────────────────

const KIND_COLOR: Record<LogKind, string> = {
  translating: '#8b5cf6',
  verifying: 'var(--status-verifying)',
  verified: 'var(--status-verified)',
  failed: 'var(--status-failed)',
  info: 'var(--muted-foreground)',
  analysis: 'var(--muted-foreground)',
};

function LogRow({ entry, expanded, onToggle }: { entry: LogEntry; expanded: boolean; onToggle: () => void }) {
  const { kind, message, sub, lean } = entry;
  const color = KIND_COLOR[kind];

  const icon =
    kind === 'translating' ? (
      <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1 animate-pulse" style={{ backgroundColor: color }} />
    ) : kind === 'verifying' ? (
      <Loader2 size={11} className="animate-spin shrink-0 mt-0.5" style={{ color }} />
    ) : kind === 'verified' ? (
      <Check size={11} className="shrink-0 mt-0.5" style={{ color }} />
    ) : kind === 'failed' ? (
      <X size={11} className="shrink-0 mt-0.5" style={{ color }} />
    ) : kind === 'analysis' ? (
      <Sparkles size={11} className="shrink-0 mt-0.5" style={{ color }} />
    ) : (
      <span className="w-1 h-1 rounded-full shrink-0 mt-1.5 bg-muted-foreground/40" />
    );

  return (
    <div>
      <div className="flex items-start gap-2 text-[11px]">
        {icon}
        <div className="flex-1 min-w-0">
          <span className="font-medium" style={{ color }}>
            {message}
          </span>
          {sub && (
            <span className="text-muted-foreground/70"> — {sub}</span>
          )}
          {lean && (
            <button
              onClick={onToggle}
              className="ml-1.5 inline-flex items-center gap-0.5 text-muted-foreground/50 hover:text-muted-foreground"
            >
              {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              <span className="text-[9px]">lean output</span>
            </button>
          )}
        </div>
      </div>
      {lean && expanded && (
        <pre
          className="ml-5 mt-1 px-2 py-2 rounded text-[10px] overflow-x-auto overflow-y-auto"
          style={{
            fontFamily: 'var(--font-mono)',
            backgroundColor: 'color-mix(in srgb, var(--status-failed) 8%, transparent)',
            color: 'var(--status-failed)',
            maxHeight: '10rem',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {lean}
        </pre>
      )}
    </div>
  );
}
