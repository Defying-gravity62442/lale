"""LLM-based dependency extraction for LaTeX claims."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass

from anthropic import AsyncAnthropic

from .cache import Cache
from .config import Settings
from .protocol import Claim

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert mathematician building a logical dependency graph for a LaTeX document.

Given a series of preceding claims (Definitions, Theorems, Lemmas, etc.) and a TARGET claim, determine which of the preceding claims the TARGET claim mathematically depends on. 
A claim depends on another if it explicitly references it, uses concepts defined in it, or logically builds upon its result.

Output ONLY a JSON array of the string IDs of the preceding claims that the TARGET claim depends on.
For example: ["claim_1", "claim_3"]
If it depends on nothing, output: []
Do not output any prose, explanations, or markdown fences. Just the raw JSON array.
"""


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class DependencyExtractor:
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

    async def extract_dependencies(self, target_index: int, claims: list[Claim]) -> list[str]:
        target = claims[target_index]
        prev_claims = claims[:target_index]

        target_hash = target.hash_normalized
        prev_hash = _sha256("".join(c.hash_normalized for c in prev_claims))
        model = self.settings.dependency_model

        cached = self.cache.get_dependency(target_hash, prev_hash, model)
        if cached is not None:
            return cached

        if not self.settings.anthropic_api_key:
            return []

        # Build prompt
        parts = []
        if prev_claims:
            parts.append("Here are the preceding claims in the document:")
            for c in prev_claims:
                claim_type = c.type.capitalize()
                label_part = f" (Label: {c.label})" if c.label else ""
                parts.append(f"<claim id=\"{c.id}\">\nType: {claim_type}{label_part}\nStatement:\n{c.statement_latex}\n</claim>")
        else:
            parts.append("There are no preceding claims in the document.")

        prefix_text = "\n\n".join(parts)

        target_claim_type = target.type.capitalize()
        target_label_part = f" (Label: {target.label})" if target.label else ""
        target_text = f"Here is the TARGET claim:\n<claim id=\"{target.id}\">\nType: {target_claim_type}{target_label_part}\nStatement:\n{target.statement_latex}\n</claim>\n\nWhich of the preceding claims does the TARGET claim depend on? Output ONLY a JSON array of string IDs."

        msg = await self.client.messages.create(
            model=model,
            max_tokens=1024,
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},  # Not fully supported for system prompt in all API versions but good practice
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prefix_text,
                            "cache_control": {"type": "ephemeral"}
                        },
                        {
                            "type": "text",
                            "text": target_text
                        }
                    ]
                }
            ],
        )

        raw = "".join(
            block.text for block in msg.content if getattr(block, "type", None) == "text"
        ).strip()

        log.info(
            "DependencyExtractor for target %s (index %d). Preceding claims: %d. LLM output: %r",
            target.id, target_index, len(prev_claims), raw
        )

        # Parse JSON
        trimmed = raw.strip()
        if trimmed.startswith("```"):
            trimmed = re.sub(r"^```(?:json)?\n?", "", trimmed)
            trimmed = re.sub(r"\n?```$", "", trimmed)
            
        try:
            deps = json.loads(trimmed)
            if not isinstance(deps, list):
                deps = []
            else:
                deps = [str(d) for d in deps]
        except json.JSONDecodeError:
            log.warning("Failed to parse dependency extractor output as JSON: %s", raw)
            deps = []

        # Only keep valid preceding claim IDs
        valid_prev_ids = {c.id for c in prev_claims}
        valid_deps = [d for d in deps if d in valid_prev_ids]

        self.cache.put_dependency(target_hash, prev_hash, model, valid_deps)
        return valid_deps
