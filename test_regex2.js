const crypto = require('crypto');
const CLAIM_KINDS = ['definition', 'theorem', 'lemma', 'corollary', 'proposition'];
const KIND_RE = CLAIM_KINDS.join('|');
const BLOCK_RE = new RegExp(
  String.raw`\\begin\{(` + KIND_RE + String.raw`)\}([\s\S]*?)\\end\{\1\}`,
  'g',
);

const src = `
\\begin{lemma} 1 \\end{lemma}
\\begin{proof} p1 \\end{proof}
\\begin{lemma} 2 \\end{lemma}
`;

const after = src.slice(src.indexOf('\\end{lemma}') + 11);
const proofGap = after.match(/^\s*\\begin\{proof\}([\s\S]*?)\\end\{proof\}/);
console.log([...src.matchAll(BLOCK_RE)].length);
