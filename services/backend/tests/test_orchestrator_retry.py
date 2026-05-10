from pathlib import Path
from uuid import uuid4

import pytest

from lale_backend.cache import Cache
from lale_backend.config import Settings
from lale_backend.lean_server import LeanCheckResult, LeanError
from lale_backend.orchestrator import Orchestrator
from lale_backend.protocol import Claim
from lale_backend.translator import TranslateResponse


class RetryTranslator:
    def __init__(self) -> None:
        self.retry_count = 0

    async def translate(self, _req):
        return TranslateResponse(
            lean_code="import Mathlib\n\ntheorem bad_claim : True := by\n  exact missing",
            imports=["Mathlib"],
            attempts=[],
            status="ok",
            cache_hit=False,
        )

    async def retranslate_with_lean_error(
        self,
        _req,
        prior_lean_code: str,
        lean_output: str,
        mathlib_hints: list[str] | None = None,
    ):
        assert "missing" in prior_lean_code
        assert "unknown identifier" in lean_output
        assert mathlib_hints == []
        self.retry_count += 1
        return TranslateResponse(
            lean_code="import Mathlib\n\ntheorem good_claim : True := by\n  trivial",
            imports=["Mathlib"],
            attempts=[],
            status="ok",
            cache_hit=False,
        )


class FakeLeanPool:
    def __init__(self) -> None:
        self.sources: list[str] = []

    async def check(self, source: str) -> LeanCheckResult:
        self.sources.append(source)
        if "bad_claim" in source:
            return LeanCheckResult(
                status="failed",
                lean_output="error: unknown identifier 'missing'",
                errors=[LeanError(message="unknown identifier 'missing'", severity="error")],
                elapsed_ms=1,
            )
        return LeanCheckResult(status="verified", lean_output="ok", errors=[], elapsed_ms=2)


def settings(tmp_path: Path) -> Settings:
    return Settings(
        anthropic_api_key="test-key",
        lean_project_dir=None,
        lean_version="test-lean",
        mathlib_version="test-mathlib",
        translator_model="test-model",
        diagnose_model="test-model",
        lean_pool_size=1,
        lean_timeout_seconds=1.0,
        cache_db_path=tmp_path / "cache.db",
        cache_max_bytes=1024 * 1024,
        semantic_review_enabled=False,
    )


@pytest.mark.asyncio
async def test_orchestrator_retries_translation_after_lean_failure(tmp_path: Path) -> None:
    s = settings(tmp_path)
    cache = Cache(s.cache_db_path, s.cache_max_bytes)
    translator = RetryTranslator()
    lean_pool = FakeLeanPool()
    orchestrator = Orchestrator(s, cache, translator, lean_pool)  # type: ignore[arg-type]
    request_id = uuid4()
    claim = Claim(
        id="c1",
        type="theorem",
        start_line=0,
        end_line=1,
        statement_latex="A trivial theorem.",
        hash_latex="h1",
        hash_normalized="h2",
    )

    events = [event async for event in orchestrator.run(request_id, "c1", [claim])]

    assert translator.retry_count == 1
    assert len(lean_pool.sources) == 2
    assert any(event.type == "claimVerified" and event.claim_id == "c1" for event in events)
    assert events[-1].type == "orchestratorFinished"
    assert events[-1].overall == "verified"
