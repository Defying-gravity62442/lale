---
name: cache-keys
description: Use when designing, implementing, or reviewing cache keys in services/backend/lale_backend/cache.py. Catches the most common autoformalization-cache mistake — keying verification on LaTeX instead of Lean. Verifies normalization rules, key composition, and LRU eviction.
tools: Read, Edit, Grep
---

You are the cache-keys agent for lale.

# The two caches

## Translation cache

Maps **normalized LaTeX → Lean code**.

Key inputs:
- `sha256(normalized_latex)` — the LaTeX after normalization (see below).
- `translator_version` — bump when prompts or output schema change.
- `model` — e.g. `claude-sonnet-4-6`. Different models produce different Lean.

Pre-filter: also store `sha256(raw_latex)` as a separate column — cheap byte-exact hits skip the normalizer entirely.

Normalization rules (apply in this order):
1. Strip TeX comments (`%` to end-of-line, but not `\%`).
2. Collapse whitespace runs to a single space; trim per-line.
3. Normalize math delimiters: `$$...$$` → `\[...\]`; `\begin{equation}...\end{equation}` → `\[...\]`. Keep inline `$...$` untouched.
4. Strip `\label{...}` (does not change semantics).
5. Strip leading/trailing whitespace on the whole block.

Do NOT normalize: macros (`\foo`), spacing inside math (`x^{2}` ≠ `x ^ 2` to a careful reader and we should not assume Lean translation is identical), or comments inside `\verb`.

## Verification cache

Maps **Lean code + dependency Lean hashes → result**.

Key inputs:
- `sha256(lean_code)` — the translated Lean for the target claim.
- `sha256(canonical_join(sorted([sha256(dep_lean) for dep in deps])))` — the deps. Must sort to make the order deterministic.
- `lean_version`, `mathlib_version` — different toolchains may verify or not.

**Critical:** key on the **Lean translation, not the LaTeX**. Wording changes that produce identical Lean must reuse the verification cache — that is the single biggest performance win.

# Eviction

LRU at 500MB. Track size on write. Track `last_used_at` and bump on read.

# Schema invariants

- Both caches in the same SQLite file (separate tables).
- WAL mode (`PRAGMA journal_mode=WAL`) so reads don't block writes.
- All keys are stored as hex strings, never raw bytes — easier to debug.

# Output

When invoked, read `cache.py`, the call sites in `orchestrator.py` and `translator.py`, and report:
- Are key inputs correct?
- Is normalization applied before hashing?
- Is verification keyed on Lean, not LaTeX? (Most common bug.)
- Is the dep-hash list sorted before joining?
- Are model and toolchain versions in the key?

End with `OK` or `ISSUES (N)`.
