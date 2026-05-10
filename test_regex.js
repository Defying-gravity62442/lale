const crypto = require('crypto');
const CLAIM_KINDS = ['definition', 'theorem', 'lemma', 'corollary', 'proposition'];
const KIND_RE = CLAIM_KINDS.join('|');
const BLOCK_RE = new RegExp(
  String.raw`\\begin\{(` + KIND_RE + String.raw`)\}([\s\S]*?)\\end\{\1\}`,
  'g',
);
const LABEL_RE = /\\label\{([^}]+)\}/;

function lineOfOffset(src, offset) {
  let line = 0;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

async function parseClaims(src) {
  const out = [];
  const indexByKind = {};
  const seenLabels = new Set();

  for (const m of src.matchAll(BLOCK_RE)) {
    const kind = m[1];
    const body = m[2] || '';
    if (m.index === undefined) continue;
    const matchStart = m.index;
    const matchEnd = matchStart + m[0].length;

    indexByKind[kind] = (indexByKind[kind] || 0) + 1;
    const labelMatch = body.match(LABEL_RE);
    let id;
    let labelWarning = false;
    if (labelMatch && labelMatch[1]) {
      const label = labelMatch[1];
      if (seenLabels.has(label)) {
        id = `${kind}:${indexByKind[kind]}`;
        labelWarning = true;
      } else {
        seenLabels.add(label);
        id = label;
      }
    } else {
      id = `${kind}:${indexByKind[kind]}`;
    }

    let proofText;
    const after = src.slice(matchEnd);
    const proofGap = after.match(/^\s*\\begin\{proof\}([\s\S]*?)\\end\{proof\}/);
    if (proofGap) {
      proofText = proofGap[1];
    }

    out.push({
      id,
      type: kind,
    });
  }
  return out;
}

const src = `
\\begin{lemma} 1 \\end{lemma}
\\begin{lemma} 2 \\end{lemma}
`;

parseClaims(src).then(console.log);
