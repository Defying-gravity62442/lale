import { useMemo, useState, useEffect, useRef } from 'react';
import { Loader2, X } from 'lucide-react';
import { useStore } from '../store';
import { ClaimTypePill } from '../components/ClaimTypePill';
import { StatusBadge } from '../components/StatusBadge';
import type { Claim } from '@lale/shared';

// ── LeanCodeBlock ─────────────────────────────────────────────────────────────

function LeanCodeBlock({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-0.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span
          className="inline-block transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : 'none' }}
        >
          ▶
        </span>
        Lean 4
      </button>
      {open ? (
        <pre
          className="mt-1 px-2 py-1.5 rounded text-[10px] leading-relaxed overflow-x-auto whitespace-pre"
          style={{
            backgroundColor: 'var(--muted)',
            color: 'var(--foreground)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {code}
        </pre>
      ) : null}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

const PLAN_STEPS = [
  { id: 'extract', label: 'Extracting dependencies' },
  { id: 'plan', label: 'Building verification plan' },
  { id: 'verify', label: 'Verifying with Lean' },
];

const CLAIM_STATUS_LABEL: Record<string, string> = {
  translating: 'Translating to Lean…',
  verifying: 'Type-checking…',
  verified: 'Verified',
  failed: 'Failed',
  sorry: 'Sorry (axiom placeholder)',
  unverified: 'Queued',
};

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function VerifyingView() {
  const requestId = useStore((s) => s.activeRequestId);
  const byRequest = useStore((s) => s.byRequest);
  const claims = useStore((s) => s.claims);
  const cancelVerify = useStore((s) => s.cancelVerify);
  const errorMessage = useStore((s) => s.errorMessage);

  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const mountedAt = useRef(Date.now());

  const run = requestId ? byRequest[requestId] : undefined;
  const target = claims.find((c: Claim) => c.id === run?.targetClaimId);

  useEffect(() => {
    mountedAt.current = Date.now();
    setElapsed(0);
    setCancelling(false);
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - mountedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [requestId]);

  const perClaim = useMemo(() => {
    const out = new Map<string, { status: string; lastDetail?: string; cacheHit?: boolean; leanCode?: string }>();
    if (!run) return out;
    for (const ev of run.events) {
      if (ev.type === 'claimStatus') {
        const prev = out.get(ev.claimId);
        out.set(ev.claimId, { ...prev, status: ev.status, lastDetail: ev.detail });
      } else if (ev.type === 'claimVerified') {
        const prev = out.get(ev.claimId);
        out.set(ev.claimId, { ...prev, status: 'verified', cacheHit: ev.cacheHit, leanCode: ev.leanCode });
      } else if (ev.type === 'claimFailed') {
        const prev = out.get(ev.claimId);
        out.set(ev.claimId, { ...prev, status: 'failed', leanCode: ev.leanCode });
      }
    }
    return out;
  }, [run]);

  const plan = useMemo(() => {
    if (!run) return [];
    const start = run.events.find((e) => e.type === 'orchestratorStarted');
    if (start?.type === 'orchestratorStarted') return start.plan;
    return [];
  }, [run]);

  const allClaimIds = useMemo(() => plan.flatMap((l) => l.claimIds), [plan]);

  const doneCount = useMemo(() => {
    let n = 0;
    for (const id of allClaimIds) {
      const st = perClaim.get(id)?.status;
      if (st === 'verified' || st === 'failed' || st === 'sorry') n++;
    }
    return n;
  }, [allClaimIds, perClaim]);

  const progressPct = allClaimIds.length > 0 ? (doneCount / allClaimIds.length) * 100 : 0;

  const eventCount = run?.events.length ?? 0;
  const activeStep = eventCount === 0 ? 0 : 1;

  function handleCancel() {
    setCancelling(true);
    cancelVerify();
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 size={14} className="animate-spin shrink-0" style={{ color: 'var(--status-verifying)' }} />
          <h2 className="font-semibold text-sm flex-1">Verifying</h2>
          <span className="text-[11px] text-muted-foreground tabular-nums font-mono">
            {formatElapsed(elapsed)}
          </span>
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 ml-1"
            title="Cancel verification"
          >
            <X size={12} />
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>

        {target ? (
          <div className="flex items-center gap-2 mb-2">
            <ClaimTypePill type={target.type} />
            <code className="text-[11px] text-muted-foreground truncate" style={{ fontFamily: 'var(--font-mono)' }}>
              {target.label ?? target.id}
            </code>
          </div>
        ) : null}

        {allClaimIds.length > 0 ? (
          <div className="mt-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground">
                {doneCount} / {allClaimIds.length} claims
              </span>
            </div>
            <div className="h-1 w-full rounded-full overflow-hidden" style={{ backgroundColor: 'var(--muted)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%`, backgroundColor: 'var(--status-verifying)' }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {errorMessage ? (
          <div className="mx-4 mt-4 px-3 py-2 rounded-md text-[11px] break-all" style={{ backgroundColor: 'var(--status-failed-bg)', color: 'var(--status-failed)', fontFamily: 'var(--font-mono)' }}>
            {errorMessage}
          </div>
        ) : null}

        {plan.length === 0 ? (
          <div className="px-4 py-5 space-y-4">
            {/* 3-step skeleton while plan is building */}
            <div className="space-y-3">
              {PLAN_STEPS.map((step, i) => {
                const isActive = i === activeStep;
                const isDone = i < activeStep;
                return (
                  <div key={step.id} className="flex items-center gap-3">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: isActive ? 'var(--status-verifying-bg)' : isDone ? 'var(--status-verified-bg)' : 'var(--muted)',
                      }}
                    >
                      {isActive ? (
                        <Loader2 size={10} className="animate-spin" style={{ color: 'var(--status-verifying)' }} />
                      ) : isDone ? (
                        <span className="text-[8px] font-bold" style={{ color: 'var(--status-verified)' }}>✓</span>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--muted-foreground)', opacity: 0.4 }} />
                      )}
                    </div>
                    <span
                      className="text-xs transition-opacity"
                      style={{
                        color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                        opacity: isActive ? 1 : isDone ? 0.7 : 0.4,
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Debug log — collapsed by default */}
            <div>
              <button
                onClick={() => setShowLog((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <span
                  className="inline-block transition-transform"
                  style={{ transform: showLog ? 'rotate(90deg)' : 'none' }}
                >
                  ▶
                </span>
                Debug log ({eventCount} events)
              </button>
              {showLog ? (
                <ul className="mt-1.5 max-h-40 overflow-y-auto space-y-0.5 text-[10px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
                  {run && run.events.length > 0 ? (
                    run.events.map((ev, i) => (
                      <li key={i} className="truncate">
                        {ev.type}
                        {'claimId' in ev ? ` · ${(ev as { claimId: string }).claimId.slice(0, 10)}` : ''}
                        {'status' in ev ? ` · ${(ev as { status: string }).status}` : ''}
                      </li>
                    ))
                  ) : (
                    <li>no events yet — is the backend running?</li>
                  )}
                </ul>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 space-y-4">
            {plan.map((level) => (
              <div key={level.level}>
                <div className="lale-section-label">
                  {level.level === 0 ? 'Foundations' : `Level ${level.level}`}
                </div>
                <ul className="space-y-1.5">
                  {level.claimIds.map((cid) => {
                    const cl = claims.find((c: Claim) => c.id === cid);
                    const info = perClaim.get(cid);
                    const st = info?.status ?? 'unverified';
                    const isActive = st === 'translating' || st === 'verifying';
                    return (
                      <li
                        key={cid}
                        className="flex flex-col gap-1 px-2.5 py-2 rounded-md border border-border transition-colors"
                        style={{ backgroundColor: isActive ? 'var(--status-verifying-bg)' : 'transparent' }}
                      >
                        <div className="flex items-center gap-2">
                          {cl ? <ClaimTypePill type={cl.type} /> : null}
                          <code className="text-[11px] truncate flex-1" style={{ fontFamily: 'var(--font-mono)' }}>
                            {cl?.label ?? cid.slice(0, 14)}
                          </code>
                          {info?.cacheHit ? (
                            <span className="lale-cache-pill" title="Loaded from cache — saved ~30 s">
                              cached
                            </span>
                          ) : null}
                          <StatusBadge status={st as never} />
                        </div>
                        {isActive ? (
                          <p className="text-[10px] pl-1" style={{ color: 'var(--status-verifying)' }}>
                            {info?.lastDetail ?? CLAIM_STATUS_LABEL[st] ?? st}
                          </p>
                        ) : info?.lastDetail ? (
                          <p className="text-[10px] text-muted-foreground pl-1">{info.lastDetail}</p>
                        ) : null}
                        {info?.leanCode ? (
                          <LeanCodeBlock code={info.leanCode} />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {/* Debug log — collapsed by default */}
            <div className="pt-1">
              <button
                onClick={() => setShowLog((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <span
                  className="inline-block transition-transform"
                  style={{ transform: showLog ? 'rotate(90deg)' : 'none' }}
                >
                  ▶
                </span>
                Debug log ({run?.events.length ?? 0} events)
              </button>
              {showLog ? (
                <ul className="mt-1.5 max-h-40 overflow-y-auto space-y-0.5 text-[10px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
                  {run?.events.map((ev, i) => (
                    <li key={i} className="truncate">
                      {ev.type}
                      {'claimId' in ev ? ` · ${(ev as { claimId: string }).claimId.slice(0, 10)}` : ''}
                      {'status' in ev ? ` · ${(ev as { status: string }).status}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
