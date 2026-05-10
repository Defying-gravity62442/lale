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
  malformedJson: 'Translator error',
  other: 'Lean error',
};

const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  unknownIdentifier: [
    'Check the identifier spelling — Lean is case-sensitive.',
    'Confirm the relevant Mathlib import is present (e.g. `import Mathlib.Algebra.Ring.Basic`).',
    'Try `#check YourIdentifier` in Lean to verify it exists in scope.',
    'Check if a namespace prefix is required (e.g. `Nat.succ` instead of `succ`).',
  ],
  typeMismatch: [
    'Add an explicit type annotation to the problematic expression.',
    'Check whether a coercion is missing (e.g. `(n : ℤ)` to lift a natural number).',
    'Use `show T` before the term to clarify the expected type.',
    'Confirm the theorem statement matches the intended types.',
  ],
  tacticFailed: [
    'Try `simp?` to discover which simp lemmas close the goal.',
    'Try `exact?` or `apply?` to find a matching theorem.',
    'Break the proof into smaller `have` steps to isolate the failing goal.',
    'Check the Lean 4 tactic reference for alternative tactics.',
  ],
  timeout: [
    'Break the theorem into smaller helper lemmas.',
    'Add `set_option maxHeartbeats 800000` before the theorem.',
    'Simplify the proof strategy — avoid large `simp` calls on complex goals.',
  ],
  malformedJson: [
    'The translation produced invalid output — try re-running verification.',
    'This is usually a transient LLM issue; a second attempt often succeeds.',
  ],
  other: [
    'Inspect the full Lean output below for details.',
    'Try re-running verification to rule out transient issues.',
  ],
};

function highlightLeanOutput(text: string): React.ReactNode {
  return text.split('\n').map((line, i) => {
    let color: string | undefined;
    if (/:\s*error:/.test(line) || line.startsWith('error:')) color = 'var(--status-failed)';
    else if (/:\s*warning:/.test(line) || line.startsWith('warning:')) color = 'var(--status-sorry)';
    else if (/:\s*info:/.test(line) || line.startsWith('info:')) color = 'var(--status-verifying)';
    return (
      <span key={i} className="block" style={color ? { color } : undefined}>
        {line || ' '}
      </span>
    );
  });
}

export function FailureView() {
  const setView = useStore((s) => s.setView);
  const selectClaim = useStore((s) => s.selectClaim);
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

  const category = failure && failure.type === 'claimFailed' ? failure.rootCauseCategory : null;
  const suggestions: string[] = category
    ? (CATEGORY_SUGGESTIONS[category] ?? CATEGORY_SUGGESTIONS['other'] ?? [])
    : [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card shrink-0 flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setView('main')}>
          <ArrowLeft size={14} /> Back
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
            style={{ backgroundColor: 'var(--status-failed-bg)' }}
          >
            <XCircle size={24} style={{ color: 'var(--status-failed)' }} />
          </div>
          <h2 className="font-semibold text-base mb-1">Verification failed</h2>
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
          <>
            {/* Root cause */}
            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="lale-section-label">Root cause</div>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--status-failed-bg)', color: 'var(--status-failed)' }}
                >
                  {CATEGORY_LABEL[failure.rootCauseCategory] ?? failure.rootCauseCategory}
                </span>
                {deepest && deepest.id !== target?.id ? (
                  <button
                    className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full border border-border hover:bg-accent transition-colors"
                    style={{ fontFamily: 'var(--font-mono)' }}
                    onClick={() => {
                      selectClaim(deepest.id);
                      setView('dependency');
                    }}
                    title="Navigate to originating claim"
                  >
                    <ClaimTypePill type={deepest.type} />
                    {deepest.label ?? deepest.id}
                    <span className="text-muted-foreground">→</span>
                  </button>
                ) : null}
              </div>
              <p className="text-xs text-foreground/90">{failure.explanation}</p>
            </div>

            {/* Suggestions */}
            {suggestions.length > 0 ? (
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="lale-section-label">Suggestions</div>
                <ul className="space-y-1.5">
                  {suggestions.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Lean output */}
            {failure.leanOutput ? (
              <CodeBlock label="Lean output" copyText={failure.leanOutput}>
                {highlightLeanOutput(failure.leanOutput)}
              </CodeBlock>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No failure details captured.</p>
        )}
      </div>
    </div>
  );
}
