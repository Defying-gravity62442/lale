import { useMemo } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useStore } from '../store';
import { Button } from '../components/Button';
import { ClaimTypePill } from '../components/ClaimTypePill';
import { StatusBadge } from '../components/StatusBadge';
import { LatexPreview } from '../components/LatexPreview';

const LABEL_REF = /\\(?:ref|eqref|cref|Cref)\{([^}]+)\}/g;

export function DependencyView() {
  const claims = useStore((s) => s.claims);
  const selectedId = useStore((s) => s.selectedClaimId);
  const setView = useStore((s) => s.setView);
  const startVerify = useStore((s) => s.startVerify);

  const target = claims.find((c) => c.id === selectedId);
  const deps = useMemo(() => {
    if (!target) return [];
    const text = (target.statementLatex ?? '') + '\n' + (target.proofLatex ?? '');
    const refs = new Set<string>();
    for (const m of text.matchAll(LABEL_REF)) {
      if (m[1]) refs.add(m[1]);
    }
    const byLabel = new Map(claims.filter((c) => c.label).map((c) => [c.label!, c]));
    const out = [];
    for (const r of refs) {
      const c = byLabel.get(r);
      if (c && c.id !== target.id) out.push(c);
    }
    return out;
  }, [claims, target]);

  if (!target) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="px-4 py-3 border-b border-border bg-card shrink-0">
          <Button size="sm" variant="ghost" onClick={() => setView('main')}>
            <ArrowLeft size={14} /> Back
          </Button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-2">
          <p className="text-sm text-muted-foreground">Claim not found in current document.</p>
          <Button variant="secondary" onClick={() => setView('main')}>View all claims</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Button size="sm" variant="ghost" onClick={() => setView('main')}>
            <ArrowLeft size={14} /> Back
          </Button>
        </div>
        <div className="flex items-start gap-2 mb-2">
          <ClaimTypePill type={target.type} />
          {target.label ? (
            <code className="text-[11px] text-muted-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
              {target.label}
            </code>
          ) : null}
          <StatusBadge status={target.status} />
        </div>
        <div className="text-sm leading-snug">
          <LatexPreview latex={target.statementLatex} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Dependencies ({deps.length})
          </div>
          {deps.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No referenced claims. lale will verify this claim directly.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {deps.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border"
                >
                  <ClaimTypePill type={d.type} />
                  <code className="text-[11px] text-muted-foreground truncate" style={{ fontFamily: 'var(--font-mono)' }}>
                    {d.label ?? d.id}
                  </code>
                  <StatusBadge status={d.status} />
                  <ChevronRight size={12} className="ml-auto text-muted-foreground" />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-border bg-card shrink-0 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => setView('main')}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => startVerify(target.id)}
          disabled={target.status === 'verifying' || target.status === 'translating'}
        >
          Verify {deps.length > 0 ? `with ${deps.length} dep${deps.length === 1 ? '' : 's'}` : 'claim'}
        </Button>
      </div>
    </div>
  );
}
