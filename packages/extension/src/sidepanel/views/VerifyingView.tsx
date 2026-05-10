import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { useStore } from '../store';
import { ClaimTypePill } from '../components/ClaimTypePill';
import { StatusBadge } from '../components/StatusBadge';

export function VerifyingView() {
  const requestId = useStore((s) => s.activeRequestId);
  const byRequest = useStore((s) => s.byRequest);
  const claims = useStore((s) => s.claims);

  const run = requestId ? byRequest[requestId] : undefined;
  const target = claims.find((c) => c.id === run?.targetClaimId);

  const perClaim = useMemo(() => {
    const out = new Map<string, { status: string; lastDetail?: string; cacheHit?: boolean }>();
    if (!run) return out;
    for (const ev of run.events) {
      if (ev.type === 'claimStatus') {
        out.set(ev.claimId, { status: ev.status, lastDetail: ev.detail });
      } else if (ev.type === 'claimVerified') {
        out.set(ev.claimId, { status: 'verified', cacheHit: ev.cacheHit });
      } else if (ev.type === 'claimFailed') {
        out.set(ev.claimId, { status: 'failed' });
      }
    }
    return out;
  }, [run]);

  const plan = useMemo(() => {
    if (!run) return [];
    const start = run.events.find((e) => e.type === 'orchestratorStarted');
    if (start && start.type === 'orchestratorStarted') return start.plan;
    return [];
  }, [run]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Loader2 size={14} className="animate-spin" style={{ color: 'var(--status-verifying)' }} />
          <h2 className="font-semibold">Verifying</h2>
        </div>
        {target ? (
          <div className="flex items-center gap-2">
            <ClaimTypePill type={target.type} />
            <code className="text-[11px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
              {target.label ?? target.id}
            </code>
          </div>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {plan.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">Building verification plan...</div>
        ) : (
          <div className="px-4 py-3 space-y-3">
            {plan.map((level) => (
              <div key={level.level}>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Level {level.level}
                </div>
                <ul className="space-y-1.5">
                  {level.claimIds.map((cid) => {
                    const cl = claims.find((c) => c.id === cid);
                    const st = perClaim.get(cid)?.status ?? 'unverified';
                    return (
                      <li
                        key={cid}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border"
                      >
                        {cl ? <ClaimTypePill type={cl.type} /> : null}
                        <code className="text-[11px] truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                          {cl?.label ?? cid}
                        </code>
                        <StatusBadge status={st as never} />
                        {perClaim.get(cid)?.cacheHit ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">cache</span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
