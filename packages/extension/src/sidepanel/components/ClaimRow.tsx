import type { Claim } from '@lale/shared';
import { ChevronRight } from 'lucide-react';
import { ClaimTypePill } from './ClaimTypePill';
import { StatusBadge } from './StatusBadge';
import { LatexPreview } from './LatexPreview';

interface Props {
  claim: Claim;
  onSelect: (claim: Claim) => void;
  highlighted?: boolean;
}

export function ClaimRow({ claim, onSelect, highlighted }: Props) {
  return (
    <button
      onClick={() => onSelect(claim)}
      className={`w-full px-3 py-2.5 border-b border-border text-left flex items-center gap-2 hover:bg-accent transition-colors ${
        highlighted ? 'bg-accent' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <ClaimTypePill type={claim.type} />
          {claim.number ? (
            <span
              className="text-[10px] text-muted-foreground"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {claim.number}
            </span>
          ) : null}
          <StatusBadge status={claim.status} />
          {claim.label ? (
            <code
              className="text-[10px] text-muted-foreground truncate"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {claim.label}
            </code>
          ) : null}
        </div>
        <div className="text-xs text-foreground/90 line-clamp-2">
          <LatexPreview latex={claim.statementLatex} />
        </div>
      </div>
      <ChevronRight size={14} className="text-muted-foreground shrink-0" />
    </button>
  );
}
