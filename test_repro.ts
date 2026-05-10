import { parseClaims } from './packages/extension/src/content/parser';

const src1 = `
\\begin{lemma}
foo
\\end{lemma}

\\begin{lemma}
bar
\\end{lemma}
`;

parseClaims(src1).then(c => console.log("src1 claims:", c.length));
