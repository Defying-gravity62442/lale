import type { ClaimStatus } from '@lale/shared';
import { CheckCircle2, XCircle, AlertCircle, Loader2, Circle } from 'lucide-react';

const META: Record<ClaimStatus, { label: string; fg: string; bg: string; Icon: typeof Circle }> = {
  verified: { label: 'Verified', fg: 'var(--status-verified)', bg: 'var(--status-verified-bg)', Icon: CheckCircle2 },
  failed: { label: 'Failed', fg: 'var(--status-failed)', bg: 'var(--status-failed-bg)', Icon: XCircle },
  sorry: { label: 'Sorry', fg: 'var(--status-sorry)', bg: 'var(--status-sorry-bg)', Icon: AlertCircle },
  verifying: { label: 'Verifying', fg: 'var(--status-verifying)', bg: 'var(--status-verifying-bg)', Icon: Loader2 },
  translating: { label: 'Translating', fg: 'var(--status-translating)', bg: 'var(--status-translating-bg)', Icon: Loader2 },
  unverified: { label: 'Unverified', fg: 'var(--status-unverified)', bg: 'var(--status-unverified-bg)', Icon: Circle },
};

export function StatusBadge({ status }: { status: ClaimStatus }) {
  const m = META[status];
  const spinning = status === 'verifying' || status === 'translating';
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
      style={{ color: m.fg, backgroundColor: m.bg }}
    >
      <m.Icon size={11} className={spinning ? 'animate-spin' : ''} />
      {m.label}
    </span>
  );
}
