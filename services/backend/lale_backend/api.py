"""FastAPI app — routes for health, verify_paper, and status."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from .cache import Cache
from .config import Settings, get_settings
from .lean_server import LeanPool, get_pool
from .orchestrator import Orchestrator
from .protocol import (
    StatusResponse,
    VerifyPaperRequest,
)
from .translator import Translator


def _build_state(settings: Settings) -> dict[str, object]:
    cache = Cache(settings.cache_db_path, settings.cache_max_bytes)
    pool: LeanPool = get_pool()
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is required; no translator stub is available.")
    translator = Translator(settings, cache)
    orchestrator = Orchestrator(settings, cache, translator, pool)
    return {
        "settings": settings,
        "pool": pool,
        "orchestrator": orchestrator,
    }


@asynccontextmanager
async def _lifespan(app: FastAPI):
    settings = get_settings()
    state = _build_state(settings)
    app.state.lale = state
    pool: LeanPool = state["pool"]  # type: ignore[assignment]
    await pool.start()
    try:
        yield
    finally:
        await pool.stop()


app = FastAPI(title="lale backend", lifespan=_lifespan)

# Chrome extensions sit at chrome-extension://<id>; allow them broadly in dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Health ----------


@app.get("/health")
async def health() -> dict[str, object]:
    settings: Settings = app.state.lale["settings"]
    return {
        "ok": True,
        "leanVersion": settings.lean_version,
        "mathlibVersion": settings.mathlib_version,
        "translatorModel": settings.translator_model,
    }


# ---------- /verify_paper — orchestrated, SSE ----------


@app.post("/verify_paper")
async def verify_paper(req: VerifyPaperRequest):
    orch: Orchestrator = app.state.lale["orchestrator"]

    async def event_stream():
        async for ev in orch.run(req.request_id, req.target_claim_id, list(req.claims)):
            payload = ev.model_dump(by_alias=True, mode="json")
            yield {"event": payload["type"], "data": json.dumps(payload)}

    return EventSourceResponse(event_stream())


# ---------- /status/{request_id} ----------


@app.get("/status/{request_id}", response_model=StatusResponse, response_model_by_alias=True)
async def status(request_id: UUID) -> StatusResponse:
    orch: Orchestrator = app.state.lale["orchestrator"]
    state, events = orch.history(request_id)
    if state == "unknown":
        raise HTTPException(404, "request_id not seen by this worker")
    return StatusResponse(request_id=request_id, state=state, events=events)  # type: ignore[arg-type]
