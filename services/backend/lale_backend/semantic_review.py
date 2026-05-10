"""Semantic faithfulness review for LaTeX -> Lean translations."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

from anthropic import AsyncAnthropic

from .config import Settings

SemanticVerdict = Literal["faithful", "questionable", "mismatch", "skipped"]

SYSTEM_PROMPT = """You review mathematical autoformalizations.

Compare the original LaTeX claim to the Lean 4 statement. Decide whether the Lean statement is
faithful to the LaTeX meaning. Ignore proof style unless it changes the statement. Be strict
about missing hypotheses, wrong domains, reversed implications, weakened/strengthened claims,
and translating a theorem into `True`.

Return JSON only:
{"verdict":"faithful|questionable|mismatch","explanation":"short concrete reason"}
"""


@dataclass(frozen=True)
class SemanticReview:
    verdict: SemanticVerdict
    explanation: str


class SemanticReviewer:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._client: AsyncAnthropic | None = None

    @property
    def client(self) -> AsyncAnthropic:
        if self._client is None:
            if not self.settings.anthropic_api_key:
                raise RuntimeError("ANTHROPIC_API_KEY missing from environment.")
            self._client = AsyncAnthropic(api_key=self.settings.anthropic_api_key)
        return self._client

    async def review(
        self,
        *,
        latex: str,
        lean_code: str,
        context_lean: list[str],
    ) -> SemanticReview:
        if not self.settings.semantic_review_enabled:
            return SemanticReview("skipped", "Semantic review disabled.")
        if not self.settings.anthropic_api_key:
            return SemanticReview("questionable", "Semantic review unavailable: ANTHROPIC_API_KEY missing.")
        heuristic = _obvious_mismatch(latex, lean_code)
        if heuristic is not None:
            return heuristic

        prompt = "\n\n".join(
            [
                "Original LaTeX claim:",
                latex.strip(),
                "Lean context already in scope:",
                "\n\n".join(context_lean) if context_lean else "(none)",
                "Candidate Lean code:",
                lean_code.strip(),
            ]
        )
        msg = await self.client.messages.create(
            model=self.settings.diagnose_model,
            max_tokens=512,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(
            block.text for block in msg.content if getattr(block, "type", None) == "text"
        ).strip()
        return _parse_review(raw)


def _parse_review(raw: str) -> SemanticReview:
    trimmed = raw.strip()
    if trimmed.startswith("```"):
        trimmed = re.sub(r"^```(?:json)?\n?", "", trimmed)
        trimmed = re.sub(r"\n?```$", "", trimmed)
    try:
        obj = json.loads(trimmed)
    except json.JSONDecodeError:
        return SemanticReview("questionable", "Semantic reviewer returned malformed JSON.")
    verdict = obj.get("verdict")
    if verdict not in ("faithful", "questionable", "mismatch"):
        return SemanticReview("questionable", "Semantic reviewer returned an unknown verdict.")
    explanation = obj.get("explanation")
    return SemanticReview(verdict, str(explanation or "No explanation provided."))


def _obvious_mismatch(latex: str, lean_code: str) -> SemanticReview | None:
    statementish = re.sub(r"--.*", "", lean_code)
    if re.search(r":\s*True\s*:=", statementish) and "true" not in latex.lower():
        return SemanticReview(
            "mismatch",
            "Lean statement proves `True`, which does not encode the LaTeX claim.",
        )
    return None
