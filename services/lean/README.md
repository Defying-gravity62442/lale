# services/lean — Mathlib environment for the lale Lean pool

This is a minimal Lean 4 project whose only purpose is to provide a working `lake env` with
Mathlib pre-built. The lale backend's Lean LSP pool launches `lake env lean --server` from this
directory, so `LEAN_PATH` resolves Mathlib for every claim verification.

The pool does NOT write `.lean` files into this tree. Each verification opens a synthetic
`textDocument/didOpen` URI; Lean processes the source from memory.

The backend also reads the local `.lake/packages/mathlib/Mathlib` checkout for lightweight
declaration retrieval. Those hits are used in translation repair prompts and in the Mathlib
contribution advisor, so keep this project built against the Mathlib version you want lale to
target.

## One-time setup

```sh
cd services/lean

# Pull Mathlib + a matching Lean toolchain.
lake update

# Download Mathlib's pre-built oleans from the CDN (~5 min, 2-3 GB).
# Without this, `lake build` will compile Mathlib from source — hours.
lake exe cache get

# Build Mathlib + the Lale.Warmup module.
lake build
```

After `lake build` finishes, `lake env lean --server` from this directory will accept
`textDocument/didOpen` requests with `import Mathlib` and they'll resolve immediately.
When verification fails, lale may also query `textDocument/hover` near diagnostics to capture
goal/type context before closing the synthetic document.

## What the warmup is for

`Lale/Warmup.lean` is `import Mathlib` plus a trivial theorem. The lale pool opens this file
once per worker on spawn so the heavy `import Mathlib` happens exactly once per worker, not
per verification.

## Verifying the toolchain

```sh
lake env lean --version  # should match lean-toolchain
```

If the version disagrees, `lake update` likely changed `lean-toolchain` — re-run `elan` or
`curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh` to pick up the new pinned toolchain.
