import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useStore } from '../store';
import { Button } from '../components/Button';
import { ClaimTypePill } from '../components/ClaimTypePill';
import { StatusBadge } from '../components/StatusBadge';
import { LatexPreview } from '../components/LatexPreview';
import { DependencyGraph } from '../components/DependencyGraph';

const LABEL_REF = /\\(?:ref|eqref|cref|Cref)\{([^}]+)\}/g;

export function DependencyView() {
  const claims = useStore((s) => s.claims);
  const selectedId = useStore((s) => s.selectedClaimId);
  const setView = useStore((s) => s.setView);
  const selectClaim = useStore((s) => s.selectClaim);
  const startVerify = useStore((s) => s.startVerify);

  const target = claims.find((c) => c.id === selectedId);

  const deps = useMemo(() => {
    if (!target) return [];
    const ids = new Set<string>();
    const text = (target.statementLatex ?? '') + '\n' + (target.proofLatex ?? '');
    const byLabel = new Map(claims.filter((c) => c.label).map((c) => [c.label!, c]));
    for (const m of text.matchAll(LABEL_REF)) {
      if (m[1]) {
        const c = byLabel.get(m[1]);
        if (c && c.id !== target.id) ids.add(c.id);
      }
    }
    for (const depId of target.llmDependencyIds ?? []) {
      if (depId !== target.id) ids.add(depId);
    }
    return [...ids].map((id) => claims.find((c) => c.id === id)).filter(Boolean) as typeof claims;
  }, [claims, target]);

  function handleNodeSelect(id: string) {
    selectClaim(id);
    // stays in DependencyView, graph re-renders for new target
  }

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
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Button size="sm" variant="ghost" onClick={() => setView('main')}>
            <ArrowLeft size={14} /> Back
          </Button>
        </div>
        <div className="flex items-center gap-2 mb-2">
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
        <div className="px-4 py-3 space-y-4">
          {/* Dependency graph — only shown when there are explicit refs */}
          {deps.length > 0 ? (
            <div>
              <div className="lale-section-label mb-2">Dependency graph</div>
              <DependencyGraph
                targetId={target.id}
                claims={claims}
                onSelect={handleNodeSelect}
              />
              <p className="text-[10px] text-muted-foreground mt-1.5">
                Click a node to inspect that claim. Arrows show dependency direction (prerequisite → this claim).
              </p>
            </div>
          ) : null}

          {/* Explicit references list */}
          <div>
            <div className="lale-section-label">
              Explicit references ({deps.length})
            </div>
            {deps.length === 0 ? (
              <p className="text-xs text-muted-foreground mb-3">
                No \ref commands found in this claim's statement or proof.
              </p>
            ) : (
              <ul className="space-y-1.5 mb-3">
                {deps.map((d) => (
                  <li key={d.id}>
                    <button
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-muted/50 hover:bg-accent transition-colors text-left"
                      onClick={() => handleNodeSelect(d.id)}
                    >
                      <ClaimTypePill type={d.type} />
                      <code className="text-[11px] text-muted-foreground truncate flex-1" style={{ fontFamily: 'var(--font-mono)' }}>
                        {d.label ?? d.id}
                      </code>
                      <StatusBadge status={d.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div
              className="rounded-md p-2.5 text-xs"
              style={{ backgroundColor: 'var(--status-verifying-bg)', color: 'var(--status-verifying)' }}
            >
              <strong>AI dependency extraction:</strong> Dependencies inferred by the LLM appear above alongside explicit \ref commands after verification starts.
            </div>
          </div>
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
          Verify claim
        </Button>
      </div>
    </div>
  );
}
