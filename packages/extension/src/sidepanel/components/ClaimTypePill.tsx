import type { ClaimType } from '@lale/shared';

const SHORT: Record<ClaimType, string> = {
  theorem: 'THM',
  lemma: 'LEM',
  definition: 'DEF',
  corollary: 'COR',
  proposition: 'PROP',
  proof: 'PRF',
  remark: 'RMK',
  example: 'EX',
  claim: 'CLM',
  conjecture: 'CONJ',
  exercise: 'EXER',
  problem: 'PROB',
  question: 'QST',
};

export function ClaimTypePill({ type }: { type: ClaimType }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-secondary text-secondary-foreground"
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {SHORT[type]}
    </span>
  );
}
