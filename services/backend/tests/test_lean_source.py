from lale_backend.lean_server import _hover_text, compose_lean_source


def test_compose_lean_source_hoists_imports_and_keeps_dependencies_first() -> None:
    dep = """import Mathlib

theorem dep_claim : True := by
  trivial
"""
    target = """import Mathlib

theorem target_claim : True := by
  exact dep_claim
"""

    source = compose_lean_source(target, [dep])

    assert source.startswith("import Mathlib\n\n")
    assert source.count("import Mathlib") == 1
    assert source.index("theorem dep_claim") < source.index("theorem target_claim")
    body = source.split("\n\n", 1)[1]
    assert "import " not in body


def test_hover_text_extracts_markdown_value() -> None:
    text = _hover_text(
        {"result": {"contents": {"kind": "markdown", "value": "goals\nturnstile True"}}}
    )

    assert text == "goals\nturnstile True"
