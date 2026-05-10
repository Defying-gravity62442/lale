"""Trust policy checks for accepted Lean snippets."""

from __future__ import annotations

import re

_SORRY_RE = re.compile(r"(?<![A-Za-z0-9_'])\b(sorry|admit)\b")
_AXIOM_RE = re.compile(r"^\s*(axiom|constant|opaque)\s+(.+)$", re.MULTILINE)
_UNSAFE_RE = re.compile(r"^\s*unsafe\s+", re.MULTILINE)


def policy_violations(
    lean_code: str,
    *,
    strict_no_sorry: bool,
    strict_no_axioms: bool,
) -> list[str]:
    violations: list[str] = []
    if strict_no_sorry and _SORRY_RE.search(lean_code):
        violations.append("proof contains `sorry`/`admit`")
    if strict_no_axioms:
        axiom_match = _AXIOM_RE.search(lean_code)
        if axiom_match:
            violations.append(f"introduces `{axiom_match.group(1)}` declaration")
        if _UNSAFE_RE.search(lean_code):
            violations.append("uses `unsafe` declaration")
    return violations
