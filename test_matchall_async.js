const BLOCK_RE = /a(b)c/g;
const src = 'abc abc abc';

async function test() {
  const out = [];
  for (const m of src.matchAll(BLOCK_RE)) {
    await new Promise(r => setTimeout(r, 10));
    out.push(m[0]);
  }
  console.log(out);
}
test();
