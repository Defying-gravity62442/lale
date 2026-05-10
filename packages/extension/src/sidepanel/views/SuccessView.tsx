import { useState } from 'react';
import { CheckCircle2, ArrowLeft, GitPullRequestArrow, Copy, Check } from 'lucide-react';
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

const VERDICT_DESC: Record<string, string> = {
  mathlib_candidate: 'This result appears novel and general enough to contribute to the Mathlib library.',
  project_local: 'This result is specific to your project and is not a good Mathlib candidate.',
  duplicate_likely: 'A similar result likely already exists in Mathlib.',
  needs_generalization: 'The result is promising but should be generalized before contributing.',
  not_worth_submitting: 'The result is too specialized or trivial for Mathlib.',
  unsure: 'Insufficient information to assess Mathlib worthiness.',
  skipped: 'Mathlib assessment was not performed.',
};

export function SuccessView() {
  const setView = useStore((s) => s.setView);
  const requestId = useStore((s) => s.activeRequestId);
  const byRequest = useStore((s) => s.byRequest);
  const claims = useStore((s) => s.claims);

  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [nameCopied, setNameCopied] = useState(false);

  const run = requestId ? byRequest[requestId] : undefined;
  const target = claims.find((c) => c.id === run?.targetClaimId);
  const verifiedCount = run?.events.filter((e) => e.type === 'claimVerified').length ?? 0;
  const cacheHits = run?.events.filter((e) => e.type === 'claimVerified' && e.cacheHit).length ?? 0;
  const totalElapsedMs =
    run?.events.reduce((acc, ev) => (ev.type === 'claimVerified' ? acc + ev.elapsedMs : acc), 0) ?? 0;
  const worthiness = [...(run?.events ?? [])]
    .reverse()
    .find((e) => e.type === 'mathlibWorthiness' && e.claimId === run?.targetClaimId);

  function copyName(name: string) {
    void navigator.clipboard.writeText(name).then(() => {
      setNameCopied(true);
      setTimeout(() => setNameCopied(false), 1500);
    });
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card shrink-0 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setView('main')}>
          <ArrowLeft size={14} /> Back
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
            style={{ backgroundColor: 'var(--status-verified-bg)' }}
          >
            <CheckCircle2 size={24} style={{ color: 'var(--status-verified)' }} />
          </div>
          <h2 className="font-semibold text-base mb-1">Verified</h2>
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

        {/* Stats */}
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-border p-2">
            <dt className="lale-section-label mb-0.5">Claims</dt>
            <dd className="text-sm font-semibold">{verifiedCount}</dd>
          </div>
          <div className="rounded-md border border-border p-2">
            <dt className="lale-section-label mb-0.5">Cached</dt>
            <dd className="text-sm font-semibold" title={`${cacheHits} of ${verifiedCount} loaded from cache`}>
              {cacheHits}/{verifiedCount}
            </dd>
          </div>
          <div className="rounded-md border border-border p-2">
            <dt className="lale-section-label mb-0.5">Elapsed</dt>
            <dd className="text-sm font-semibold">{(totalElapsedMs / 1000).toFixed(1)}s</dd>
          </div>
        </dl>

        {/* Mathlib worthiness */}
        {worthiness && worthiness.type === 'mathlibWorthiness' ? (
          <div className="rounded-md border border-border p-3 space-y-3">
            <div className="flex items-start gap-2">
              <GitPullRequestArrow size={14} className="mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="text-sm font-semibold">Mathlib contribution</h3>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ backgroundColor: 'var(--secondary)', color: 'var(--secondary-foreground)' }}
                    title={VERDICT_DESC[worthiness.verdict] ?? ''}
                  >
                    {VERDICT_LABEL[worthiness.verdict] ?? worthiness.verdict}
                    <span className="ml-1 opacity-50">?</span>
                  </span>
                </div>
                <p className="text-xs text-foreground/90">{worthiness.reason}</p>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt className="lale-section-label">Confidence</dt>
                <dd className="font-semibold">{Math.round(worthiness.confidence * 100)}%</dd>
              </div>
              <div className="col-span-2">
                <dt className="lale-section-label">Suggested name</dt>
                <dd className="flex items-center gap-1 min-w-0">
                  <span className="truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                    {worthiness.suggestedName ?? '—'}
                  </span>
                  {worthiness.suggestedName ? (
                    <button
                      onClick={() => copyName(worthiness.suggestedName!)}
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      title="Copy name"
                    >
                      {nameCopied ? <Check size={10} /> : <Copy size={10} />}
                    </button>
                  ) : null}
                </dd>
              </div>
            </dl>

            {worthiness.suggestedLocation ? (
              <div>
                <dt className="lale-section-label">Suggested location</dt>
                <dd className="text-xs truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                  {worthiness.suggestedLocation}
                </dd>
              </div>
            ) : null}

            {worthiness.evidence.length > 0 ? (
              <div>
                <div className="lale-section-label">Evidence</div>
                <ul className="space-y-1">
                  {(showAllEvidence ? worthiness.evidence : worthiness.evidence.slice(0, 3)).map((item, idx) => (
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
                {worthiness.evidence.length > 3 ? (
                  <button
                    onClick={() => setShowAllEvidence((v) => !v)}
                    className="text-[10px] text-muted-foreground hover:text-foreground mt-1 transition-colors"
                  >
                    {showAllEvidence ? 'Show less' : `+${worthiness.evidence.length - 3} more`}
                  </button>
                ) : null}
              </div>
            ) : null}

            {worthiness.reviewNotes.length > 0 ? (
              <div>
                <div className="lale-section-label">Review notes</div>
                <ul className="space-y-1">
                  {(showAllNotes ? worthiness.reviewNotes : worthiness.reviewNotes.slice(0, 3)).map((note, idx) => (
                    <li key={`${idx}-${note}`} className="text-xs text-muted-foreground">{note}</li>
                  ))}
                </ul>
                {worthiness.reviewNotes.length > 3 ? (
                  <button
                    onClick={() => setShowAllNotes((v) => !v)}
                    className="text-[10px] text-muted-foreground hover:text-foreground mt-1 transition-colors"
                  >
                    {showAllNotes ? 'Show less' : `+${worthiness.reviewNotes.length - 3} more`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
