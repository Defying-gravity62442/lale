from pathlib import Path

from lale_backend.config import Settings
from lale_backend.retrieval import MathlibRetriever, extract_query_terms


def settings(tmp_path: Path) -> Settings:
    return Settings(
        anthropic_api_key=None,
        lean_project_dir=tmp_path,
        lean_version="test-lean",
        mathlib_version="test-mathlib",
        translator_model="test-model",
        diagnose_model="test-model",
        lean_pool_size=1,
        lean_timeout_seconds=1.0,
        cache_db_path=tmp_path / "cache.db",
        cache_max_bytes=1024 * 1024,
    )


def test_extract_query_terms_adds_domain_hints() -> None:
    terms = extract_query_terms("Every continuous function on a compact set is bounded.")

    assert "Continuous" in terms
    assert "IsCompact" in terms
    assert "Bounded" in terms


def test_mathlib_retriever_returns_matching_declarations(tmp_path: Path) -> None:
    lean_file = tmp_path / ".lake" / "packages" / "mathlib" / "Mathlib" / "Topology.lean"
    lean_file.parent.mkdir(parents=True)
    lean_file.write_text(
        "import Mathlib\n\n"
        "theorem continuousOn_of_continuous : True := by trivial\n"
        "def unrelated_name : True := True\n"
    )

    retriever = MathlibRetriever(settings(tmp_path))
    hits = retriever.search(["Continuous"], max_hits=4)

    assert hits
    assert "continuousOn_of_continuous" in hits[0].text
