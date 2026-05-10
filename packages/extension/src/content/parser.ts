/**
 * LaTeX claim parser.
 *
 * Walks the source for `\begin{<kind>}…\end{<kind>}` blocks for our claim kinds, plus an optional
 * adjacent `\begin{proof}…\end{proof}`. Produces stable IDs (`label` if present, else
 * `<kind>:<index>`).
 */

import type { Claim, ClaimType } from '@lale/shared';

const CLAIM_KINDS: ClaimType[] = [
  'definition',
  'theorem',
  'lemma',
  'corollary',
  'proposition',
  'proof',
  'remark',
  'example',
  'claim',
  'conjecture',
];

// Aliases and starred variants → canonical ClaimType.
const KIND_ALIASES: Record<string, ClaimType> = {
  // theorem-like abbreviations
  thm: 'theorem',
  lem: 'lemma',
  prop: 'proposition',
  cor: 'corollary',
  defn: 'definition',
  // proof
  pf: 'proof',
  // remark
  rem: 'remark',
  rmk: 'remark',
  // example
  ex: 'example',
  // conjecture
  conj: 'conjecture',
  // starred variants
  'theorem*': 'theorem',
  'lemma*': 'lemma',
  'proposition*': 'proposition',
  'corollary*': 'corollary',
  'definition*': 'definition',
  'proof*': 'proof',
  'remark*': 'remark',
  'example*': 'example',
  'claim*': 'claim',
  'conjecture*': 'conjecture',
};

// All environment names to match (escape * for the regex alternation).
const ALL_KINDS = [...CLAIM_KINDS, ...Object.keys(KIND_ALIASES)];
const KIND_RE = ALL_KINDS.map((k) => k.replace('*', '\\*')).join('|');
const BLOCK_RE = new RegExp(
  String.raw`\\begin\{(` + KIND_RE + String.raw`)\}([\s\S]*?)\\end\{\1\}`,
  'g',
);
const LABEL_RE = /\\label\{([^}]+)\}/;

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Mirror of services/backend/lale_backend/normalize.py — keep in lockstep.
function normalizeLatex(src: string): string {
  let out = src.replace(/(?<!\\)%[^\n]*/g, '');
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner) => `\\[${inner}\\]`);
  out = out.replace(
    /\\begin\{equation\*?\}([\s\S]+?)\\end\{equation\*?\}/g,
    (_m, inner) => `\\[${inner}\\]`,
  );
  out = out.replace(/\\label\{[^}]*\}/g, '');
  out = out.replace(/[ \t]+/g, ' ');
  out = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join('\n');
  return out.trim();
}

function lineOfOffset(src: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

export async function parseClaims(src: string): Promise<Claim[]> {
  const out: Claim[] = [];
  const indexByKind: Record<string, number> = {};
  const seenLabels = new Set<string>();
  // Track absolute start positions of proof blocks already attached to a theorem-like claim,
  // so we don't also emit them as standalone proof claims.
  const attachedProofStarts = new Set<number>();

  for (const m of src.matchAll(BLOCK_RE)) {
    const rawKind = m[1] ?? '';
    const kind: ClaimType = KIND_ALIASES[rawKind] ?? (rawKind as ClaimType);
    const body = m[2] ?? '';
    if (m.index === undefined) continue;
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;

    // Skip proof blocks that were already consumed as proofLatex of a preceding claim.
    if (kind === 'proof' && attachedProofStarts.has(matchStart)) continue;

    indexByKind[kind] = (indexByKind[kind] ?? 0) + 1;
    const labelMatch = body.match(LABEL_RE);
    let id: string;
    let labelWarning = false;
    if (labelMatch && labelMatch[1]) {
      const label = labelMatch[1];
      if (seenLabels.has(label)) {
        // Duplicate label — fall back to type:index, warn.
        id = `${kind}:${indexByKind[kind]}`;
        labelWarning = true;
      } else {
        seenLabels.add(label);
        id = label;
      }
    } else {
      id = `${kind}:${indexByKind[kind]}`;
    }

    // Find a proof immediately following (allowing whitespace only).
    // Only attach proofs to non-proof claim types to avoid nesting.
    let proofText: string | undefined;
    const after = src.slice(matchEnd);
    const proofGap = kind !== 'proof'
      ? after.match(/^\s*\\begin\{proof\}([\s\S]*?)\\end\{proof\}/)
      : null;
    if (proofGap) {
      proofText = proofGap[1];
      // Record where this proof starts in the source so we skip it as a standalone claim.
      const proofAbsStart = matchEnd + after.indexOf('\\begin{proof}');
      attachedProofStarts.add(proofAbsStart);
    }

    const statementLatex = body.trim();
    const proofLatex = proofText?.trim();
    const combined = statementLatex + (proofLatex ? `\n\n${proofLatex}` : '');
    const normalized = normalizeLatex(combined);

    const startLine = lineOfOffset(src, matchStart);
    const endLine = lineOfOffset(src, matchEnd);

    out.push({
      id,
      type: kind,
      label: labelMatch?.[1],
      startLine,
      endLine,
      statementLatex,
      proofLatex,
      hashLatex: await sha256Hex(combined),
      hashNormalized: await sha256Hex(normalized),
      status: 'unverified',
    });

    if (labelWarning) {
      // eslint-disable-next-line no-console
      console.warn('[lale] duplicate label', labelMatch?.[1], '— using fallback id', id);
    }
  }
  return out;
}
