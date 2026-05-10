# lale — guide for Claude Code

lale is a Chrome extension that verifies math claims in Overleaf via Lean 4 + Claude autoformalization.

## Layout

- `packages/extension/` — MV3 extension. Vite + @crxjs + React 19 + Tailwind.
- `packages/shared/` — Zod protocol schemas. Source of truth for wire shapes (TS side).
- `services/backend/` — FastAPI + Anthropic + Lean 4 LSP pool + SQLite cache.
- `services/lean/` — Mathlib-bearing Lean project. The LSP pool's `lake env` source. One-time `lake update && lake exe cache get && lake build` to set up.

## Project subagents

- **protocol-sync** — audits Zod vs Pydantic for drift.
- **lean-translator** — categorized retry-loop prompt design (the four categories matter; do not collapse).
- **lean-pool** — LSP worker pool over `lake env lean --server`. Warmup, message lifecycle, recycling.
- **extension-mv3** — service-worker lifecycle, port reconnection, content-script hazards.
- **cache-keys** — keys must hash Lean (not LaTeX) for the verification cache.

## User-invocable skills

- `/lale-run` — start backend + extension dev side by side.
- `/lale-protocol-check` — drift audit.
- `/lale-translate-debug` — pick the next retry prompt for a failing translation.
- `/lale-cache-audit` — verify cache key composition.

## Conventions

- Wire format: camelCase. Zod uses camelCase keys; Pydantic uses snake_case fields with `alias` and `populate_by_name=True`.
- All cross-context messages (content↔background↔sidepanel↔backend) are typed via `shared/protocol.ts`.
- Lean verification always uses the real LSP pool (`lake env lean --server`); `LEAN_PROJECT_DIR` defaults to `services/lean`.

## Don't

- Don't add a generic LLM-retry prompt. Use the four categorized prompts.
- Don't key the verification cache on LaTeX. Key on Lean.
- Don't expose the Anthropic key to the content script. It lives only on the backend (and optionally `chrome.storage.sync` for a future BYO-key mode).
