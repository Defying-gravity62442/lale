import { useMemo } from 'react';
import type { Claim, ClaimType } from '@lale/shared';

const LABEL_REF = /\\(?:ref|eqref|cref|Cref|autoref)\{([^}]+)\}/g;

const COL_WIDTH = 116;
const ROW_HEIGHT = 44;
const NODE_W = 100;
const NODE_H = 32;
const MAX_HEIGHT = 220;

const TYPE_SHORT: Record<ClaimType, string> = {
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
};

const STATUS_COLOR: Record<string, string> = {
  verified: 'var(--status-verified)',
  failed: 'var(--status-failed)',
  sorry: 'var(--status-sorry)',
  verifying: 'var(--status-verifying)',
  translating: 'var(--status-translating)',
  unverified: 'var(--status-unverified)',
};

function parseRefs(claim: Claim, byLabel: Map<string, string>): string[] {
  const text = (claim.statementLatex ?? '') + '\n' + (claim.proofLatex ?? '');
  const ids = new Set<string>();
  for (const m of text.matchAll(LABEL_REF)) {
    if (m[1]) {
      const depId = byLabel.get(m[1]);
      if (depId && depId !== claim.id) ids.add(depId);
    }
  }
  return [...ids];
}

interface NodeLayout {
  id: string;
  claim: Claim | undefined;
  col: number;
  row: number;
  x: number;
  y: number;
}

interface Props {
  targetId: string;
  claims: Claim[];
  onSelect: (id: string) => void;
}

export function DependencyGraph({ targetId, claims, onSelect }: Props) {
  const byLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of claims) {
      if (c.label) m.set(c.label, c.id);
    }
    return m;
  }, [claims]);

  const refsOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of claims) m.set(c.id, parseRefs(c, byLabel));
    return m;
  }, [claims, byLabel]);

  // BFS from target: depth 0 = target, depth 1 = direct deps, etc.
  const { depthMap, edges } = useMemo(() => {
    const depthMap = new Map<string, number>();
    const edges: Array<[string, string]> = []; // [dep, dependent]
    depthMap.set(targetId, 0);
    const queue = [targetId];
    while (queue.length > 0) {
      const cid = queue.shift()!;
      for (const dep of refsOf.get(cid) ?? []) {
        if (!depthMap.has(dep)) {
          depthMap.set(dep, depthMap.get(cid)! + 1);
          queue.push(dep);
        }
        if (!edges.some(([a, b]) => a === dep && b === cid)) {
          edges.push([dep, cid]);
        }
      }
    }
    return { depthMap, edges };
  }, [targetId, refsOf]);

  if (depthMap.size <= 1) return null;

  const maxDepth = Math.max(...depthMap.values());

  // col = maxDepth - depth: target (depth=0) → col maxDepth (rightmost), deepest dep → col 0 (leftmost)
  const byCol = new Map<number, string[]>();
  for (const [id, depth] of depthMap) {
    const col = maxDepth - depth;
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col)!.push(id);
  }

  const nodes: NodeLayout[] = [];
  for (const [col, ids] of byCol) {
    ids.forEach((id, row) => {
      nodes.push({
        id,
        claim: claims.find((c) => c.id === id),
        col,
        row,
        x: col * COL_WIDTH + 8,
        y: row * ROW_HEIGHT + 8,
      });
    });
  }

  const posOf = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));

  const numCols = maxDepth + 1;
  const maxRows = Math.max(...[...byCol.values()].map((v) => v.length));
  const svgW = numCols * COL_WIDTH + 16;
  const svgH = Math.min(maxRows * ROW_HEIGHT + 16, MAX_HEIGHT);

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-muted/20">
      <svg
        width={svgW}
        height={svgH}
        className="block"
        style={{ minWidth: svgW }}
      >
        <defs>
          <marker id="lale-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--border)" />
          </marker>
        </defs>

        {/* Edges: dep → dependent (left to right) */}
        {edges.map(([depId, depOnId], i) => {
          const from = posOf.get(depId);
          const to = posOf.get(depOnId);
          if (!from || !to) return null;
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth="1.5"
              markerEnd="url(#lale-arrow)"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const isTarget = n.id === targetId;
          const status = n.claim?.status ?? 'unverified';
          const dotColor = STATUS_COLOR[status] ?? 'var(--status-unverified)';
          const typeShort = n.claim ? (TYPE_SHORT[n.claim.type] ?? '?') : '?';
          const rawLabel = n.claim?.label ?? n.id;
          const label = rawLabel.length > 13 ? rawLabel.slice(0, 12) + '…' : rawLabel;

          return (
            <g
              key={n.id}
              transform={`translate(${n.x}, ${n.y})`}
              onClick={() => !isTarget && onSelect(n.id)}
              style={{ cursor: isTarget ? 'default' : 'pointer' }}
              role={isTarget ? undefined : 'button'}
              aria-label={isTarget ? undefined : `Navigate to ${rawLabel}`}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={isTarget ? 'var(--primary)' : 'var(--card)'}
                stroke={isTarget ? 'var(--primary)' : 'var(--border)'}
                strokeWidth={isTarget ? 0 : 1}
              />
              {/* Status dot */}
              <circle cx={NODE_W - 9} cy={9} r={3.5} fill={dotColor} />
              {/* Type abbreviation */}
              <text
                x={8}
                y={13}
                fontSize={8}
                fontFamily="var(--font-mono)"
                fontWeight="600"
                fill={isTarget ? 'rgba(255,255,255,0.6)' : 'var(--muted-foreground)'}
              >
                {typeShort}
              </text>
              {/* Label */}
              <text
                x={8}
                y={25}
                fontSize={9.5}
                fontFamily="var(--font-mono)"
                fill={isTarget ? 'var(--primary-foreground)' : 'var(--foreground)'}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
