---
name: lale-run
description: Start the lale backend and the extension dev server side by side. Use when the user says "run lale", "start lale", "fire it up", or asks to demo the end-to-end flow. Confirms Lean is on PATH, checks that services/lean has been built, prints the side-panel install instructions for Chrome, and tails both logs.
---

# /lale-run — start lale end-to-end

## Pre-flight

Run these checks before starting anything (Bash tool, in parallel):

1. `lean --version` — required. If missing, tell the user to install via elan:
   `curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh`
2. `test -d services/lean/.lake/build/lib/Mathlib && echo BUILT || echo NOT_BUILT`
   - If `NOT_BUILT`: tell the user to run the one-time build:
     `cd services/lean && lake update && lake exe cache get && lake build`
     (~5 min with cache get; pulls 2-3 GB of pre-built oleans).
3. `test -f services/backend/.env || cp services/backend/.env.example services/backend/.env`
   — and remind the user to put their `ANTHROPIC_API_KEY` in.
4. `test -x "$(command -v uv)" || echo "missing uv"` — install with
   `curl -LsSf https://astral.sh/uv/install.sh | sh` if needed.

Do not start the backend if Lean isn't built; the worker pool will fail during warmup.

## Start

In parallel, both `run_in_background: true`:

1. **Backend**
   ```
   cd services/backend && uv run uvicorn lale_backend.api:app --port 8765 --reload
   ```
   Expected first lines: `Uvicorn running on http://127.0.0.1:8765`. With real Lean, watch for
   `lean worker N: ready in Xs` — there should be one line per CPU.

2. **Extension dev**
   ```
   pnpm --filter @lale/extension dev
   ```
   @crxjs writes a loadable extension to `packages/extension/dist`.

After both come up, tell the user:

> Chrome → `chrome://extensions` → enable Developer Mode → **Load unpacked** → select
> `packages/extension/dist`. Open Overleaf, then open the lale side panel.

## Common failures

- **Backend hangs on startup with no `worker ready` lines** — Mathlib isn't built.
  `cd services/lean && lake exe cache get && lake build`.
- **`lake env lean --server` exits immediately** — `services/lean/.lake` missing or
  `lean-toolchain` mismatched. `cd services/lean && lake update`.
- **Port 8765 in use** — `lsof -ti :8765 | xargs kill`.
- **CORS in side panel** — check the backend's CORS allowlist includes `chrome-extension://*`.
- **Verifications stuck at "verifying"** — check backend logs; a worker may have crashed and
  the pool is busy respawning. Wait a few seconds.
