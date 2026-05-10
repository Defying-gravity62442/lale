import { useMemo } from 'react';
import { Settings as SettingsIcon, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useStore } from '../store';
import { ClaimRow } from '../components/ClaimRow';
import { Button } from '../components/Button';

export function MainView() {
  const claims = useStore((s) => s.claims);
  const setView = useStore((s) => s.setView);
  const selectClaim = useStore((s) => s.selectClaim);

  const counts = useMemo(() => {
    const out = { verified: 0, failed: 0, sorry: 0, total: claims.length };
    for (const c of claims) {
      if (c.status === 'verified') out.verified++;
      else if (c.status === 'failed') out.failed++;
      else if (c.status === 'sorry') out.sorry++;
    }
    return out;
  }, [claims]);

  if (claims.length === 0) {
    return (
      <div className="flex-1 flex flex-col">
        <Header onSettings={() => setView('settings')} />
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
          <div className="w-24 h-24 mb-5 opacity-40">
            <svg viewBox="0 0 120 120" fill="none" className="w-full h-full">
              <circle cx="60" cy="60" r="40" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
              <path d="M60 35 L60 85 M35 60 L85 60" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h3 className="font-semibold mb-2">No claims detected</h3>
          <p className="text-xs text-muted-foreground max-w-[18rem]">
            Open an Overleaf project and use{' '}
            <code className="px-1 py-0.5 bg-muted rounded text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
              \begin{'{theorem}'}
            </code>{' '}
            blocks. Make sure the lale content script has loaded.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <Header onSettings={() => setView('settings')} />

      <div className="px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-4 text-xs mb-3">
          <Stat icon={CheckCircle2} color="var(--status-verified)">
            {counts.verified}/{counts.total} verified
          </Stat>
          <Stat icon={XCircle} color="var(--status-failed)">{counts.failed} failed</Stat>
          <Stat icon={AlertCircle} color="var(--status-sorry)">{counts.sorry} sorry</Stat>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {claims.map((c) => (
          <ClaimRow
            key={c.id}
            claim={c}
            onSelect={(claim) => {
              selectClaim(claim.id);
              setView('dependency');
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Header({ onSettings }: { onSettings: () => void }) {
  const connected = useStore((s) => s.connected);
  return (
    <div className="px-4 py-3 border-b border-border bg-card shrink-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">lale</h2>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: connected ? 'var(--status-verified)' : 'var(--status-unverified)' }}
            title={connected ? 'Connected to background' : 'Disconnected'}
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

function Stat({ icon: Icon, color, children }: { icon: typeof CheckCircle2; color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={13} style={{ color }} />
      <span className="font-medium">{children}</span>
    </div>
  );
}
