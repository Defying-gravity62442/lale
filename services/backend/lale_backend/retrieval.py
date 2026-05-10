"""Small local retrieval helpers for Lean repair prompts.

This is intentionally conservative: it does not try to understand Mathlib. It extracts useful
tokens from the LaTeX claim and Lean diagnostics, then scans local Lean sources for nearby
declaration lines. The result gives the translator concrete names and signatures to inspect
before guessing identifiers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .config import Settings

_DECL_RE = re.compile(
    r"^\s*(?:@[^\n]*\s+)*(?:theorem|lemma|def|abbrev|class|structure|inductive|instance)\s+(.+)$"
)
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_']+")
_LEAN_NAME_RE = re.compile(r"[A-Z][A-Za-z0-9_.']+|[a-z][A-Za-z0-9_.']+")

_STOPWORDS = {
    "and",
    "are",
    "assume",
    "begin",
    "claim",
    "corollary",
    "definition",
    "end",
    "eqref",
    "every",
    "exists",
    "for",
    "from",
    "have",
    "into",
    "label",
    "lemma",
    "let",
    "mathbb",
    "operatorname",
    "proof",
    "proposition",
    "ref",
    "show",
    "such",
    "that",
    "the",
    "then",
    "theorem",
    "this",
    "with",
}

_LATEX_HINTS = {
    "bounded": ["Bounded", "BddAbove", "BddBelow", "Metric.bounded"],
    "compact": ["IsCompact", "CompactSpace", "isCompact"],
    "continuous": ["Continuous", "ContinuousOn", "continuous"],
    "finite": ["Finite", "Fintype", "Set.Finite"],
    "group": ["Group", "Subgroup", "Monoid"],
    "injective": ["Function.Injective", "Injective"],
    "integer": ["Int", "Nat", "Rat"],
    "irrational": ["Irrational"],
    "linear": ["LinearMap", "LinearIndependent"],
    "matrix": ["Matrix"],
    "measurable": ["Measurable", "MeasurableSet"],
    "prime": ["Nat.Prime", "Prime"],
    "real": ["Real"],
    "sqrt": ["Real.sqrt", "sq_sqrt", "sqrt_sq"],
    "surjective": ["Function.Surjective", "Surjective"],
    "topological": ["TopologicalSpace"],
    "vector": ["Module", "Vector"],
}


@dataclass(frozen=True)
class RetrievalHit:
    path: str
    line: int
    text: str
    score: int

    def format(self) -> str:
        return f"{self.path}:{self.line}: {self.text}"


def extract_query_terms(*texts: str, max_terms: int = 16) -> list[str]:
    counts: dict[str, int] = {}
    for text in texts:
        for word in _WORD_RE.findall(text):
            lower = word.lower().strip("_'")
            if len(lower) < 4 or lower in _STOPWORDS:
                continue
            counts[lower] = counts.get(lower, 0) + 1
            for hint in _LATEX_HINTS.get(lower, []):
                counts[hint] = counts.get(hint, 0) + 3
        for name in _LEAN_NAME_RE.findall(text):
            if "." in name and len(name) >= 4:
                counts[name] = counts.get(name, 0) + 4
    return [
        term
        for term, _count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[
            :max_terms
        ]
    ]


class MathlibRetriever:
    def __init__(self, settings: Settings, max_files: int = 12000) -> None:
        self.settings = settings
        self.max_files = max_files

    def search(self, terms: list[str], max_hits: int = 12) -> list[RetrievalHit]:
        normalized = [term for term in terms if len(term) >= 3]
        if not normalized:
            return []
        hits: list[RetrievalHit] = []
        term_lowers = [term.lower() for term in normalized]
        for lean_file in self._lean_files():
            try:
                rel = self._relative_path(lean_file)
                for line_no, line in enumerate(lean_file.read_text(errors="ignore").splitlines(), 1):
                    if len(line) > 240 or not _DECL_RE.match(line):
                        continue
                    line_lower = line.lower()
                    score = sum(3 for term in term_lowers if term in line_lower)
                    score += sum(2 for term in normalized if term in line)
                    if score <= 0:
                        continue
                    hits.append(
                        RetrievalHit(
                            path=rel,
                            line=line_no,
                            text=line.strip(),
                            score=score,
                        )
                    )
            except OSError:
                continue
        hits.sort(key=lambda hit: (-hit.score, hit.path, hit.line))
        return hits[:max_hits]

    def _relative_path(self, path: Path) -> str:
        root = self.settings.lean_project_dir
        if root is not None:
            try:
                return str(path.relative_to(root))
            except ValueError:
                pass
        return str(path)

    @lru_cache(maxsize=1)
    def _lean_files(self) -> tuple[Path, ...]:
        project_dir = self.settings.lean_project_dir
        if project_dir is None:
            return ()
        roots = [
            project_dir / "Lale",
            project_dir / ".lake" / "packages" / "mathlib" / "Mathlib",
            project_dir / ".lake" / "packages" / "batteries" / "Batteries",
        ]
        files: list[Path] = []
        for root in roots:
            if not root.exists():
                continue
            for path in root.rglob("*.lean"):
                files.append(path)
                if len(files) >= self.max_files:
                    return tuple(files)
        return tuple(files)
