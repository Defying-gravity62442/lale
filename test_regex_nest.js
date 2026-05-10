const CLAIM_KINDS = ['definition', 'theorem', 'lemma', 'corollary', 'proposition'];
const KIND_RE = CLAIM_KINDS.join('|');
const BLOCK_RE = new RegExp(
  String.raw`\\begin\{(` + KIND_RE + String.raw`)\}([\s\S]*?)\\end\{\1\}`,
  'g',
);

const src = `
\begin{lemma}
Statement 1
\end{lemma}
\begin{proof}
Proof 1
\begin{lemma}
Statement 2
\end{lemma}
\end{proof}
`;
console.log([...src.matchAll(BLOCK_RE)].length);
