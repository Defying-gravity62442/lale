"""LaTeX normalization for translation cache pre-keys.

See .claude/agents/cache-keys.md — normalization rules are duplicated there as the canonical
description so subagents can audit. Keep this implementation in lockstep.
"""

from __future__ import annotations

import re

# Strip TeX % comments (but not \%)
_COMMENT = re.compile(r"(?<!\\)%[^\n]*")
# Whitespace runs to single space
_WS = re.compile(r"[ \t]+")
# Trim trailing whitespace per line
_TRAIL = re.compile(r"[ \t]+$", re.MULTILINE)
# $$ ... $$ → \[ ... \]
_DOLLAR_BLOCK = re.compile(r"\$\$(.+?)\$\$", re.DOTALL)
# \begin{equation} ... \end{equation} → \[ ... \]
_EQ_ENV = re.compile(r"\\begin\{equation\*?\}(.+?)\\end\{equation\*?\}", re.DOTALL)
# Strip \label{...}
_LABEL = re.compile(r"\\label\{[^}]*\}")


def normalize_latex(src: str) -> str:
    """Apply normalization rules in order. Output is a canonicalized representation that is
    semantically equivalent for the autoformalizer's purposes."""
    out = _COMMENT.sub("", src)
    out = _DOLLAR_BLOCK.sub(lambda m: r"\[" + m.group(1) + r"\]", out)
    out = _EQ_ENV.sub(lambda m: r"\[" + m.group(1) + r"\]", out)
    out = _LABEL.sub("", out)
    out = _WS.sub(" ", out)
    out = _TRAIL.sub("", out)
    out = "\n".join(line.strip() for line in out.splitlines() if line.strip())
    return out.strip()
