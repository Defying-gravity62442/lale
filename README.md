# lale

> Verify mathematical claims in Overleaf papers using Lean 4 + Claude autoformalization.

A Chrome extension + Python backend. The extension parses LaTeX claims (definition / theorem /
lemma / corollary / proposition) from your Overleaf paper, the backend autoformalizes each one
into Lean 4 with Claude, runs Lean against Mathlib4 via a persistent LSP worker pool, and
streams results back to a side panel with status dots in the editor gutter.

The wiring (parser, ports, FastAPI, SQLite cache, SSE) is real. The Lean LSP pool is real. The
Claude translator is real. Verification now includes a Lean feedback loop, local Mathlib
retrieval for repair prompts, strict trust checks, semantic review, and an advisory Mathlib
contribution review.

## Layout

```
lale/
  packages/
    extension/        # Chrome MV3 extension (Vite + @crxjs + React 19 + Tailwind 4)
    shared/           # Zod protocol — TS source of truth
  services/
    backend/          # FastAPI + Anthropic + Lean 4 LSP pool + SQLite
    lean/             # Mathlib-bearing Lean project — the pool's `lake env` source
  .claude/
    agents/           # protocol-sync, lean-translator, lean-pool, extension-mv3, cache-keys
    skills/           # /lale-run, /lale-protocol-check, /lale-translate-debug, /lale-cache-audit
    CLAUDE.md
```

## Quick start

### One-time: build Mathlib

```sh
cd services/lean
lake update
lake exe cache get   # ~5 min, downloads 2-3 GB of pre-built oleans
lake build           # builds Lale.Warmup against the cached oleans
```

This is needed once. The lale Lean pool runs `lake env lean --server` from this directory; it
does NOT write `.lean` files into this tree.

### Backend

```sh
cd services/backen
cp .env.example .env   # make sure to set CLAUDE_API_KEY
uv sync
uv run uvicorn lale_backend.api:app --port 8765 --reload
```

On startup you should see one `lean worker N: ready in Xs` log line per CPU after Mathlib has
been opened in each worker (~30s per worker the first time).

The backend exposes:

- `GET /health` — Lean/Mathlib/model status for the running backend
- `POST /verify_paper` — orchestrated end-to-end (SSE)
- `GET /status/{request_id}` — for service-worker resume on wakeup

The LSP pool spawns `lake env lean --server` workers against `services/lean` (one per CPU),
pre-imports Mathlib once per worker via `Lale/Warmup.lean`, and processes each verification
through `textDocument/didOpen` + `$/lean/fileProgress` + `textDocument/publishDiagnostics`. On
failures it also asks LSP `textDocument/hover` near failing diagnostics to capture useful
goal/type context for repair prompts. Per-check timeout is `LEAN_TIMEOUT_SECONDS` (default 30s);
on timeout the worker is killed and respawned.

Trust gates are strict by default:

- `STRICT_NO_SORRY=1` rejects `sorry`/`admit` before a claim can be marked verified.
- `STRICT_NO_AXIOMS=1` rejects `axiom`, `constant`, `opaque`, and `unsafe` declarations.
- `SEMANTIC_REVIEW_ENABLED=1` runs an LLM review that checks whether the verified Lean statement
  faithfully represents the original LaTeX claim. Semantic mismatches are treated as failures and
  feed back into the repair loop.

### Extension

Install JS dependencies once:

```sh
pnpm install
```

```sh
pnpm --filter @lale/extension build
```

### End-to-end test

There's a paste-fixture script in `services/backend/scripts/seed.sh` that hits `/verify_paper`
with a sample paper containing 3 claims (a definition, a lemma, and a theorem that depends on
both). Useful for testing without Overleaf:

```sh
bash services/backend/scripts/seed.sh
```

## Architecture

### Wire protocol

`packages/shared/src/protocol.ts` (Zod) and `services/backend/lale_backend/protocol.py` (Pydantic
v2) are the **single source of truth** for message shapes — HTTP requests, SSE events, and port messages.
The wire is camelCase; the Python side uses snake_case fields with aliases.

When you change one side, change the other. Run `/lale-protocol-check` (calls the protocol-sync
subagent) to confirm parity.

### Process model

```
┌────────────────────┐    chrome.runtime.sendMessage   ┌────────────────────┐
│ Overleaf tab       │ ──────────────────────────────► │ Service worker     │
│ content script     │ ◄────────────────────────────── │ (background)       │
│  • parser          │    setStatus messages           │  • port routing    │
│  • CM6 decorations │                                  │  • SSE consumer    │
└────────────────────┘                                  └─────────┬──────────┘
                                                                  │
                                                                  ▼
                                                        ┌────────────────────┐
                                                        │ Side panel         │
                                                        │  • Zustand store   │
                                                        │  • views           │
                                                        └────────────────────┘
                                                                  ▲
                                                                  │ chrome.runtime.connect (long-lived)
                                                                  │
                                                                  │ HTTP + SSE
                                                                  ▼
                                                        ┌────────────────────┐
                                                        │ FastAPI backend    │
                                                        │  • orchestrator    │
                                                        │  • translator      │
                                                        │  • lean_server     │
                                                        │  • cache (sqlite)  │
                                                        └────────────────────┘
```

The service worker can be killed at any time. It persists `inflight` request IDs in
`chrome.storage.local`, so on wakeup it polls `/status/{request_id}` for any in-progress
verifications and replays the events.

### Translator: categorized retry

The translator does **not** use a single generic retry prompt. Lean errors are categorized into
four buckets — unknown identifier, type mismatch, tactic failed, timeout — each with a distinct
re-prompt strategy. The orchestrator feeds Lean diagnostics, hover goal/type context, and local
Mathlib retrieval hits into those repair prompts. See `.claude/agents/lean-translator.md` for the
rules; do not collapse.

The first structurally valid translation is not immediately trusted. It must pass Lean, strict
policy checks, and semantic review before being written to the translation cache.

### Mathlib contribution advisor

After a claim is verified, the backend emits a `mathlibWorthiness` SSE event. This is advisory
only: it estimates whether the declaration is a Mathlib candidate, project-local, likely duplicate,
in need of generalization, not worth submitting, or unsure. The advisor uses the verified Lean
code, the original LaTeX, semantic-review context, and local Mathlib retrieval evidence. The side
panel displays the verdict, confidence, suggested name/location when available, and supporting
evidence.

This is intentionally **not** "one-click publish to Mathlib." It is a human-in-the-loop signal for
future export or draft-PR workflows.

### Cache

Two SQLite tables:

- **Translation cache** — keyed on `sha256(normalized_latex) + translator_version + model`. A
  byte-exact pre-filter on raw LaTeX gives free hits before normalization.
- **Verification cache** — keyed on **the Lean code**, not the LaTeX. This means two LaTeX
  rewrites that produce identical Lean reuse the (expensive) verification cache.

LRU eviction at 500MB. See `.claude/agents/cache-keys.md` for the audit rules.

### Orchestrator

For a target claim:

1. BFS the dependency graph (label refs in proofs).
2. Topologically order; group into levels.
3. Per claim: translation cache → translate if miss → strict policy precheck → verification cache
   → Lean check if miss.
4. If Lean or semantic review fails, retrieve local Mathlib declarations, include Lean goal/type
   context when available, and retry with the categorized repair prompt.
5. On success: cache the accepted translation, run the Mathlib contribution advisor, and emit both
   `claimVerified` and `mathlibWorthiness`.
6. **Per level: verify in parallel.** Sibling events interleave temporally on the SSE stream.
7. On failure: halt downstream, emit `claimFailed` annotated with `deepestFailedClaimId` so the
   UI surfaces the root cause, not the surface theorem.

## Project agents

These live in `.claude/agents/` and run via the `Agent` tool with `subagent_type: <name>`:

- **protocol-sync** — Zod ↔ Pydantic drift audit
- **lean-translator** — categorized retry prompt design + per-failure debugging
- **lean-pool** — LSP worker pool lifecycle, timeouts, and process recycling
- **extension-mv3** — service-worker lifecycle, port reconnection, content-script hazards
- **cache-keys** — cache key audit (catches the LaTeX-vs-Lean mistake)

## Project skills

Slash commands in `.claude/skills/`:

- `/lale-run` — start backend + extension dev side by side
- `/lale-protocol-check` — drift audit
- `/lale-translate-debug` — pick the next retry prompt for a failing translation
- `/lale-cache-audit` — verify cache key composition

## License

Hackathon project.
