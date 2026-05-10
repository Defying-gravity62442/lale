"""LaTeX -> Lean 4 translator with a categorized retry loop.

The four categories — unknown identifier, type mismatch, tactic failed, timeout — each get a
distinct re-prompt. This is materially better than a single generic retry; do not collapse them.
See .claude/agents/lean-translator.md for the rules and rationale.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Literal

from anthropic import AsyncAnthropic
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from .cache import Cache
from .config import Settings
from .normalize import normalize_latex
from .protocol import ClaimType, RootCauseCategory

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3

SYSTEM_PROMPT = """You are an expert mathematical autoformalizer. You translate LaTeX statements
of mathematical claims (definitions, theorems, lemmas, corollaries, propositions) into Lean 4
syntax using Mathlib4.

Rules:
- Use Lean 4, not Lean 3.
- Always import Mathlib.
- Output JSON ONLY, with this exact shape:
  {"lean_code": "<full lean source>", "imports": ["Mathlib"], "notes": "<one short sentence>"}
- The lean_code MUST type-check on its own when prepended by `import Mathlib\\n`.
- Prefer `theorem`/`lemma`/`def` over `example`. Use `by` blocks for proofs.
- For axioms or unprovable claims, use `sorry` rather than guessing — but flag in `notes`.
"""

CATEGORY_INSTRUCTIONS: dict[RootCauseCategory, str] = {
    "unknownIdentifier": (
        "Your previous attempt referenced an identifier that doesn't exist in Mathlib4. "
        "Rename it to the correct Mathlib name, or add an explicit `open` to bring the right "
        "namespace into scope. Do NOT redo the whole translation — make a surgical rename."
    ),
    "typeMismatch": (
        "Your previous statement has a type mismatch. The STATEMENT is wrong (the proof is "
        "secondary). Re-translate the LaTeX statement from scratch with attention to types: "
        "implicit args, universes, and the type of every quantifier. Keep the proof as `sorry` "
        "if needed; we will retry the proof separately."
    ),
    "tacticFailed": (
        "Your previous statement is plausible, but the tactic block failed. KEEP THE STATEMENT "
        "EXACTLY AS YOU HAD IT. Revise only the tactic block. Consider alternatives: "
        "algebraic -> ring/field_simp/linear_combination; ordering -> linarith/nlinarith/polyrith; "
        "logical -> tauto/decide. Show your reasoning in `notes`."
    ),
    "timeout": (
        "Your previous attempt timed out. Decompose: introduce intermediate `have :=` steps that "
        "break the proof into smaller pieces. Do NOT just crank `set_option maxHeartbeats` — that "
        "masks the problem rather than solving it."
    ),
    "malformedJson": (
        "Your previous response was not valid JSON of the required shape. Return JSON only, "
        "matching the schema in the system prompt exactly. No prose before or after."
    ),
    "other": (
        "Your previous attempt failed; please revise the translation, paying close attention to "
        "the Lean error output."
    ),
}


# ---------- Error categorization ----------

_PATTERNS: list[tuple[RootCauseCategory, re.Pattern[str]]] = [
    ("unknownIdentifier", re.compile(r"unknown (identifier|constant)|unresolved name", re.I)),
    ("typeMismatch", re.compile(r"type mismatch|failed to unify|expected .* got", re.I)),
    (
        "tacticFailed",
        re.compile(
            r"tactic '[^']+' failed|simp made no progress|linarith failed|apply failed", re.I
        ),
    ),
    ("timeout", re.compile(r"deterministic timeout|max(imum)? heartbeats|timed? out", re.I)),
]


def categorize_lean_error(lean_output: str) -> RootCauseCategory:
    for cat, pat in _PATTERNS:
        if pat.search(lean_output):
            return cat
    return "other"


# ---------- Translator ----------


@dataclass
class _Attempt:
    prompt: str
    response: str
    error_category: RootCauseCategory | None


class _Base(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class TranslateRequest(_Base):
    latex: str
    kind: ClaimType
    context_definitions_lean: list[str] = Field(default_factory=list)


class TranslateAttempt(_Base):
    prompt: str
    response: str
    error_category: RootCauseCategory | None = None


class TranslateResponse(_Base):
    lean_code: str
    imports: list[str] = Field(default_factory=lambda: ["Mathlib"])
    attempts: list[TranslateAttempt]
    status: Literal["ok", "failedTranslation"]
    cache_hit: bool


class Translator:
    def __init__(self, settings: Settings, cache: Cache) -> None:
        self.settings = settings
        self.cache = cache
        self._client: AsyncAnthropic | None = None

    @property
    def client(self) -> AsyncAnthropic:
        if self._client is None:
            if not self.settings.anthropic_api_key:
                raise RuntimeError("ANTHROPIC_API_KEY missing from environment.")
            self._client = AsyncAnthropic(api_key=self.settings.anthropic_api_key)
        return self._client

    async def translate(self, req: TranslateRequest) -> TranslateResponse:
        normalized = normalize_latex(req.latex)
        # Cache lookup (raw + normalized).
        hit = self.cache.get_translation(req.latex, normalized, self.settings.translator_model)
        if hit is not None:
            return TranslateResponse(
                lean_code=hit.lean_code,
                imports=hit.imports,
                attempts=[],
                status="ok",
                cache_hit=True,
            )

        attempts: list[_Attempt] = []
        prior_lean_attempt: str | None = None
        prior_error_category: RootCauseCategory | None = None
        prior_error_text: str | None = None

        for _attempt_no in range(MAX_ATTEMPTS):
            user_prompt = self._build_user_prompt(
                req=req,
                prior_lean_attempt=prior_lean_attempt,
                prior_error_category=prior_error_category,
                prior_error_text=prior_error_text,
            )
            raw = await self._call_claude(user_prompt)
            lean_code, imports, _notes, json_ok = self._parse_response(raw)
            attempts.append(
                _Attempt(
                    prompt=user_prompt,
                    response=raw,
                    error_category=None if json_ok else "malformedJson",
                )
            )
            if not json_ok:
                prior_lean_attempt = raw
                prior_error_category = "malformedJson"
                prior_error_text = "Response was not valid JSON of the required shape."
                continue
            # Translation succeeded structurally. The orchestrator stores the translation after
            # Lean accepts it, so bad first drafts do not poison the translation cache.
            return TranslateResponse(
                lean_code=lean_code,
                imports=imports,
                attempts=[
                    TranslateAttempt(
                        prompt=a.prompt, response=a.response, error_category=a.error_category
                    )
                    for a in attempts
                ],
                status="ok",
                cache_hit=False,
            )

        return TranslateResponse(
            lean_code="",
            imports=["Mathlib"],
            attempts=[
                TranslateAttempt(
                    prompt=a.prompt, response=a.response, error_category=a.error_category
                )
                for a in attempts
            ],
            status="failedTranslation",
            cache_hit=False,
        )

    async def retranslate_with_lean_error(
        self,
        req: TranslateRequest,
        prior_lean_code: str,
        lean_output: str,
        mathlib_hints: list[str] | None = None,
    ) -> TranslateResponse:
        """Called by the orchestrator when verification fails. Categorize, then re-prompt."""
        category = categorize_lean_error(lean_output)
        prompt = self._build_user_prompt(
            req=req,
            prior_lean_attempt=prior_lean_code,
            prior_error_category=category,
            prior_error_text=lean_output,
            mathlib_hints=mathlib_hints,
        )
        raw = await self._call_claude(prompt)
        lean_code, imports, _notes, json_ok = self._parse_response(raw)
        attempt = TranslateAttempt(
            prompt=prompt,
            response=raw,
            error_category=category if json_ok else "malformedJson",
        )
        if not json_ok:
            return TranslateResponse(
                lean_code="",
                imports=["Mathlib"],
                attempts=[attempt],
                status="failedTranslation",
                cache_hit=False,
            )
        return TranslateResponse(
            lean_code=lean_code,
            imports=imports,
            attempts=[attempt],
            status="ok",
            cache_hit=False,
        )

    # ---------- Internals ----------

    def _build_user_prompt(
        self,
        req: TranslateRequest,
        prior_lean_attempt: str | None,
        prior_error_category: RootCauseCategory | None,
        prior_error_text: str | None,
        mathlib_hints: list[str] | None = None,
    ) -> str:
        parts: list[str] = []
        parts.append(f"Kind: {req.kind}")
        if req.context_definitions_lean:
            parts.append("Context (Lean definitions already in scope):")
            parts.append("\n".join(req.context_definitions_lean))
        parts.append("LaTeX:")
        parts.append(req.latex.strip())

        if prior_lean_attempt is not None and prior_error_category is not None:
            parts.append("\nPrevious attempt:")
            parts.append(prior_lean_attempt.strip())
            parts.append(f"\nLean output (category: {prior_error_category}):")
            parts.append((prior_error_text or "").strip())
            parts.append("\nInstructions for this retry:")
            parts.append(CATEGORY_INSTRUCTIONS[prior_error_category])
            if mathlib_hints:
                parts.append("\nRelevant local Mathlib declarations found by retrieval:")
                parts.append("\n".join(f"- {hint}" for hint in mathlib_hints[:12]))
                parts.append(
                    "\nUse these names when they fit the LaTeX semantics. Do not invent a "
                    "nearby-looking identifier if none of the retrieved declarations applies."
                )

        return "\n\n".join(parts)

    async def _call_claude(self, user_prompt: str) -> str:
        msg = await self.client.messages.create(
            model=self.settings.translator_model,
            max_tokens=2048,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": user_prompt}],
        )
        # Accept either text blocks or a single string.
        chunks: list[str] = []
        for block in msg.content:
            if getattr(block, "type", None) == "text":
                chunks.append(block.text)
        return "".join(chunks).strip()

    @staticmethod
    def _parse_response(raw: str) -> tuple[str, list[str], str, bool]:
        # Be lenient: strip code fences if the model wrapped them despite instructions.
        trimmed = raw.strip()
        if trimmed.startswith("```"):
            trimmed = re.sub(r"^```(?:json)?\n?", "", trimmed)
            trimmed = re.sub(r"\n?```$", "", trimmed)
        try:
            obj = json.loads(trimmed)
        except json.JSONDecodeError:
            return "", ["Mathlib"], "", False
        lean_code = obj.get("lean_code")
        imports = obj.get("imports", ["Mathlib"])
        notes = obj.get("notes", "")
        if not isinstance(lean_code, str) or not isinstance(imports, list):
            return "", ["Mathlib"], "", False
        return lean_code, [str(i) for i in imports], str(notes), True
