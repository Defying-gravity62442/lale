import { useMemo } from 'react';
import { XCircle, ArrowLeft } from 'lucide-react';
import { useStore } from '../store';
import { Button } from '../components/Button';
import { ClaimTypePill } from '../components/ClaimTypePill';
import { CodeBlock } from '../components/CodeBlock';

const CATEGORY_LABEL: Record<string, string> = {
  unknownIdentifier: 'Unknown identifier',
  typeMismatch: 'Type mismatch',
  tacticFailed: 'Tactic failed',
  timeout: 'Lean timeout',
  malformedJson: 'Translator malformed JSON',
  other: 'Other Lean error',
};

export function FailureView() {
  const setView = useStore((s) => s.setView);
  const requestId = useStore((s) => s.activeRequestId);
  const byRequest = useStore((s) => s.byRequest);
  const claims = useStore((s) => s.claims);

  const run = requestId ? byRequest[requestId] : undefined;
  const target = claims.find((c) => c.id === run?.targetClaimId);

  const failure = useMemo(() => {
    return run?.events.find((e) => e.type === 'claimFailed');
  }, [run]);

  const deepest =
    failure && failure.type === 'claimFailed'
      ? claims.find((c) => c.id === failure.deepestFailedClaimId)
      : undefined;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card shrink-0 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setView('main')}>
          <ArrowLeft size={14} /> Back
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="flex flex-col items-center text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center mb-3"
            style={{ backgroundColor: 'var(--status-failed-bg)' }}
          >
            <XCircle size={28} style={{ color: 'var(--status-failed)' }} />
          </div>
          <h2 className="font-semibold text-lg mb-1">Verification failed</h2>
          {target ? (
            <div className="flex items-center gap-2">
              <ClaimTypePill type={target.type} />
              <code className="text-[11px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
                {target.label ?? target.id}
              </code>
            </div>
          ) : null}
        </div>

        {failure && failure.type === 'claimFailed' ? (
          <div className="space-y-3">
            <div className="rounded-md border border-border p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Root cause
              </div>
              <div className="text-sm font-medium mb-1">
                {CATEGORY_LABEL[failure.rootCauseCategory] ?? failure.rootCauseCategory}
              </div>
              {deepest && deepest.id !== failure.claimId ? (
                <p className="text-xs text-muted-foreground">
                  Surfaces in <code style={{ fontFamily: 'var(--font-mono)' }}>{target?.label ?? target?.id}</code>,
                  but originates in{' '}
                  <code style={{ fontFamily: 'var(--font-mono)' }}>{deepest.label ?? deepest.id}</code>.
                </p>
              ) : null}
              <p className="text-xs mt-2 text-foreground/90">{failure.explanation}</p>
            </div>
            {failure.leanOutput ? (
              <CodeBlock label="Lean output">{failure.leanOutput}</CodeBlock>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No failure details captured.</p>
        )}
      </div>
    </div>
  );
}
