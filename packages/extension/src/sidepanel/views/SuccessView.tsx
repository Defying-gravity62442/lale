import { CheckCircle2, ArrowLeft, GitPullRequestArrow } from 'lucide-react';
import { useStore } from '../store';
import { Button } from '../components/Button';
import { ClaimTypePill } from '../components/ClaimTypePill';

const VERDICT_LABEL: Record<string, string> = {
  mathlib_candidate: 'Candidate',
  project_local: 'Project local',
  duplicate_likely: 'Likely duplicate',
  needs_generalization: 'Needs generalization',
  not_worth_submitting: 'Not worth submitting',
  unsure: 'Unsure',
  skipped: 'Skipped',
};

export function SuccessView() {
  const setView = useStore((s) => s.setView);
  const requestId = useStore((s) => s.activeRequestId);
  const byRequest = useStore((s) => s.byRequest);
  const claims = useStore((s) => s.claims);

  const run = requestId ? byRequest[requestId] : undefined;
  const target = claims.find((c) => c.id === run?.targetClaimId);
  const verifiedCount = run?.events.filter((e) => e.type === 'claimVerified').length ?? 0;
  const cacheHits = run?.events.filter((e) => e.type === 'claimVerified' && e.cacheHit).length ?? 0;
  const totalElapsedMs = run?.events.reduce(
    (acc, ev) => (ev.type === 'claimVerified' ? acc + ev.elapsedMs : acc),
    0,
  ) ?? 0;
  const worthiness = [...(run?.events ?? [])]
    .reverse()
    .find((e) => e.type === 'mathlibWorthiness' && e.claimId === run?.targetClaimId);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card shrink-0 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setView('main')}>
          <ArrowLeft size={14} /> Back
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="flex flex-col items-center text-center mb-6">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
            style={{ backgroundColor: 'var(--status-verified-bg)' }}
          >
            <CheckCircle2 size={28} style={{ color: 'var(--status-verified)' }} />
          </div>
          <h2 className="font-semibold text-lg mb-1">Verified</h2>
          {target ? (
            <div className="flex items-center gap-2 mb-1">
              <ClaimTypePill type={target.type} />
              <code className="text-[11px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
                {target.label ?? target.id}
              </code>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground max-w-xs">
            Lean accepted the autoformalized statement and all its dependencies.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-border p-2">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Claims</dt>
            <dd className="text-sm font-semibold">{verifiedCount}</dd>
          </div>
          <div className="rounded-md border border-border p-2">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Cache</dt>
            <dd className="text-sm font-semibold">{cacheHits}/{verifiedCount}</dd>
          </div>
          <div className="rounded-md border border-border p-2">
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Elapsed</dt>
            <dd className="text-sm font-semibold">{(totalElapsedMs / 1000).toFixed(2)}s</dd>
          </div>
        </dl>

        {worthiness && worthiness.type === 'mathlibWorthiness' ? (
          <div className="mt-4 rounded-md border border-border p-3">
            <div className="flex items-start gap-2 mb-2">
              <GitPullRequestArrow size={14} className="mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold">Mathlib contribution</h3>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {VERDICT_LABEL[worthiness.verdict] ?? worthiness.verdict}
                  </span>
                </div>
                <p className="text-xs text-foreground/90">{worthiness.reason}</p>
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Confidence</dt>
                <dd className="font-semibold">{Math.round(worthiness.confidence * 100)}%</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</dt>
                <dd className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                  {worthiness.suggestedName ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Location</dt>
                <dd className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                  {worthiness.suggestedLocation ?? '—'}
                </dd>
              </div>
            </dl>
            {worthiness.evidence.length > 0 ? (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Evidence
                </div>
                <ul className="space-y-1">
                  {worthiness.evidence.slice(0, 3).map((item, idx) => (
                    <li
                      key={`${idx}-${item}`}
                      className="text-[11px] text-muted-foreground truncate"
                      style={{ fontFamily: 'var(--font-mono)' }}
                      title={item}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {worthiness.reviewNotes.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {worthiness.reviewNotes.slice(0, 3).map((note, idx) => (
                  <li key={`${idx}-${note}`}>{note}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
