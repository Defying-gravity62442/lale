"""Advisory Mathlib contribution review."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Literal

from anthropic import AsyncAnthropic

from .config import Settings
from .retrieval import MathlibRetriever, extract_query_terms

MathlibWorthinessVerdict = Literal[
    "mathlib_candidate",
    "project_local",
    "duplicate_likely",
    "needs_generalization",
    "not_worth_submitting",
    "unsure",
    "skipped",
]

SYSTEM_PROMPT = """You advise whether a verified Lean 4 declaration is worth preparing as a
Mathlib contribution.

This is advisory only. Be conservative. Use the retrieved local Mathlib evidence; cite evidence
strings when they support duplicate/style/location judgments. Do not claim Mathlib will accept
the theorem.

Return JSON only:
{
  "verdict": "mathlib_candidate|project_local|duplicate_likely|needs_generalization|not_worth_submitting|unsure",
  "confidence": 0.0,
  "reason": "short concrete reason",
  "evidence": ["retrieved declaration strings"],
  "suggested_location": "Mathlib/..." | null,
  "suggested_name": "name" | null,
  "review_notes": ["short notes"]
}
"""


@dataclass(frozen=True)
class MathlibWorthinessReview:
    verdict: MathlibWorthinessVerdict
    confidence: float
    reason: str
    evidence: list[str] = field(default_factory=list)
    suggested_location: str | None = None
    suggested_name: str | None = None
    review_notes: list[str] = field(default_factory=list)


class MathlibWorthinessReviewer:
    def __init__(self, settings: Settings, retriever: MathlibRetriever) -> None:
        self.settings = settings
        self.retriever = retriever
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
        dependency_lean: list[str],
        semantic_review: str,
    ) -> MathlibWorthinessReview:
        terms = extract_query_terms(latex, lean_code, semantic_review)
        hits = [hit.format() for hit in self.retriever.search(terms, max_hits=12)]
        heuristic = _heuristic_review(latex, lean_code, hits)
        if heuristic is not None:
            return heuristic
        if not self.settings.anthropic_api_key:
            return MathlibWorthinessReview(
                verdict="skipped",
                confidence=0.0,
                reason="Mathlib worthiness review unavailable: ANTHROPIC_API_KEY missing.",
                evidence=hits[:5],
            )

        prompt = "\n\n".join(
            [
                "Original LaTeX claim:",
                latex.strip(),
                "Verified Lean code:",
                lean_code.strip(),
                "Dependency Lean code:",
                "\n\n".join(dependency_lean) if dependency_lean else "(none)",
                "Semantic review:",
                semantic_review or "(none)",
                "Retrieved local Mathlib evidence:",
                "\n".join(f"- {hit}" for hit in hits) if hits else "(none)",
            ]
        )
        msg = await self.client.messages.create(
            model=self.settings.diagnose_model,
            max_tokens=900,
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
        parsed = _parse_review(raw)
        if not parsed.evidence:
            return MathlibWorthinessReview(
                verdict=parsed.verdict,
                confidence=parsed.confidence,
                reason=parsed.reason,
                evidence=hits[:5],
                suggested_location=parsed.suggested_location,
                suggested_name=parsed.suggested_name,
                review_notes=parsed.review_notes,
            )
        return parsed


def _parse_review(raw: str) -> MathlibWorthinessReview:
    trimmed = raw.strip()
    if trimmed.startswith("```"):
        trimmed = re.sub(r"^```(?:json)?\n?", "", trimmed)
        trimmed = re.sub(r"\n?```$", "", trimmed)
    try:
        obj = json.loads(trimmed)
    except json.JSONDecodeError:
        return MathlibWorthinessReview(
            verdict="unsure",
            confidence=0.0,
            reason="Worthiness reviewer returned malformed JSON.",
        )

    verdict = obj.get("verdict")
    if verdict not in (
        "mathlib_candidate",
        "project_local",
        "duplicate_likely",
        "needs_generalization",
        "not_worth_submitting",
        "unsure",
    ):
        verdict = "unsure"
    confidence = obj.get("confidence", 0.0)
    try:
        confidence_float = min(1.0, max(0.0, float(confidence)))
    except (TypeError, ValueError):
        confidence_float = 0.0
    evidence = obj.get("evidence")
    notes = obj.get("review_notes")
    return MathlibWorthinessReview(
        verdict=verdict,
        confidence=confidence_float,
        reason=str(obj.get("reason") or "No reason provided."),
        evidence=[str(item) for item in evidence] if isinstance(evidence, list) else [],
        suggested_location=(
            str(obj["suggested_location"]) if obj.get("suggested_location") else None
        ),
        suggested_name=str(obj["suggested_name"]) if obj.get("suggested_name") else None,
        review_notes=[str(item) for item in notes] if isinstance(notes, list) else [],
    )


def _heuristic_review(
    latex: str,
    lean_code: str,
    hits: list[str],
) -> MathlibWorthinessReview | None:
    if re.search(r":\s*True\s*:=", lean_code):
        return MathlibWorthinessReview(
            verdict="not_worth_submitting",
            confidence=0.95,
            reason="The Lean statement proves `True`, so it is not a meaningful Mathlib contribution.",
            evidence=hits[:3],
        )
    if re.search(r"\b(lale|paper|claim|lemma_\d+|theorem_\d+)\b", lean_code, re.I):
        return MathlibWorthinessReview(
            verdict="project_local",
            confidence=0.65,
            reason="The declaration appears project-local or auto-generated and would need naming and context cleanup.",
            evidence=hits[:3],
        )
    if not hits:
        return MathlibWorthinessReview(
            verdict="unsure",
            confidence=0.3,
            reason="No nearby local Mathlib declarations were retrieved, so placement and duplicate risk are unclear.",
            evidence=[],
        )
    if len(latex.strip()) < 80 and hits:
        return MathlibWorthinessReview(
            verdict="duplicate_likely",
            confidence=0.45,
            reason="The claim is short and nearby Mathlib declarations were retrieved; it may already exist or be a minor variant.",
            evidence=hits[:5],
        )
    return None
