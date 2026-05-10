import { useMemo, useState } from 'react';
import { Settings as SettingsIcon, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useStore } from '../store';
import { ClaimRow } from '../components/ClaimRow';
import { Button } from '../components/Button';
import type { ClaimStatus } from '@lale/shared';

type Filter = 'all' | 'unverified' | 'verifying' | 'verified' | 'failed';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unverified', label: 'Unverified' },
  { id: 'verifying', label: 'Active' },
  { id: 'verified', label: 'Verified' },
  { id: 'failed', label: 'Failed' },
];

export function MainView() {
  const claims = useStore((s) => s.claims);
  const setView = useStore((s) => s.setView);
  const selectClaim = useStore((s) => s.selectClaim);
  const [filter, setFilter] = useState<Filter>('all');

  const counts = useMemo(() => {
    const out: Record<ClaimStatus, number> = {
      verified: 0, failed: 0, sorry: 0, verifying: 0, translating: 0, unverified: 0,
    };
    for (const c of claims) out[c.status]++;
    return out;
  }, [claims]);

  const filtered = useMemo(() => {
    if (filter === 'all') return claims;
    if (filter === 'verifying') return claims.filter((c) => c.status === 'verifying' || c.status === 'translating');
    return claims.filter((c) => c.status === filter);
  }, [claims, filter]);

  const filterCount = (f: Filter): number => {
    if (f === 'all') return claims.length;
    if (f === 'verifying') return counts.verifying + counts.translating;
    return counts[f as ClaimStatus] ?? 0;
  };

  if (claims.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        <Header onSettings={() => setView('settings')} />
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
          <div className="w-20 h-20 mb-6 opacity-30">
            <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
              <circle cx="60" cy="60" r="40" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" />
              <path d="M60 35 L60 85 M35 60 L85 60" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="font-semibold mb-4">No claims detected</h3>
          <div className="flex flex-col gap-3 max-w-[18rem] text-left">
            {[
              { n: 1, text: 'Open an Overleaf project with LaTeX math' },
              { n: 2, text: 'Use \\begin{theorem} (or lemma, definition…)' },
              { n: 3, text: 'Claims appear here automatically — click one to verify' },
            ].map(({ n, text }) => (
              <div key={n} className="flex items-start gap-3">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold"
                  style={{ backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }}
                >
                  {n}
                </span>
                <p className="text-xs text-muted-foreground">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header onSettings={() => setView('settings')} />

      {/* Compact stats row */}
      <div className="px-4 py-2 border-b border-border bg-card shrink-0 flex items-center gap-4 text-xs">
        <Stat icon={CheckCircle2} color="var(--status-verified)">
          {counts.verified}/{claims.length} verified
        </Stat>
        {counts.failed > 0 ? (
          <Stat icon={XCircle} color="var(--status-failed)">{counts.failed} failed</Stat>
        ) : null}
        {counts.sorry > 0 ? (
          <Stat icon={AlertCircle} color="var(--status-sorry)">{counts.sorry} sorry</Stat>
        ) : null}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 py-2 border-b border-border bg-card shrink-0 overflow-x-auto">
        {FILTERS.map((f) => {
          const count = filterCount(f.id);
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className="shrink-0 text-[10px] px-2.5 py-1 rounded-full font-medium transition-colors"
              style={{
                backgroundColor: active ? 'var(--primary)' : 'var(--muted)',
                color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              }}
            >
              {f.label}
              {f.id !== 'all' && count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-6">
            <p className="text-xs text-muted-foreground">
              No {filter === 'all' ? '' : filter + ' '}claims.
            </p>
          </div>
        ) : (
          filtered.map((c) => (
            <ClaimRow
              key={c.id}
              claim={c}
              onSelect={(claim) => {
                selectClaim(claim.id);
                setView('dependency');
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Header({ onSettings }: { onSettings: () => void }) {
  const connected = useStore((s) => s.connected);
  return (
    <div className="px-4 py-3 border-b border-border bg-card shrink-0">
      <div className="flex items-center justify-between mb-0.5">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">lale</h2>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: connected ? 'var(--status-verified)' : 'var(--status-unverified)' }}
            title={connected ? 'Connected' : 'Disconnected from background'}
          />
        </div>
        <Button size="sm" variant="ghost" onClick={onSettings} aria-label="Settings">
          <SettingsIcon size={14} />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Lean verification for Overleaf</p>
    </div>
  );
}

function Stat({
  icon: Icon,
  color,
  children,
}: {
  icon: typeof CheckCircle2;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={12} style={{ color }} />
      <span className="font-medium">{children}</span>
    </div>
  );
}
