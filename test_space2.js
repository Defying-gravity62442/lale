const CLAIM_KINDS = ['definition', 'theorem', 'lemma', 'corollary', 'proposition'];
const KIND_RE = CLAIM_KINDS.join('|');
const BLOCK_RE = new RegExp(
  String.raw`\\begin\s*\{\s*(` + KIND_RE + String.raw`)\s*\}([\s\S]*?)\\end\s*\{\s*\1\s*\}`,
  'g',
);

const src = `
\\begin{lemma}
Statement 1
\\end {lemma}

\\begin{lemma}
Statement 2
\\end{lemma}
`;

console.log([...src.matchAll(BLOCK_RE)].length);
