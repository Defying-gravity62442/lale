from lale_backend.worthiness import _heuristic_review, _parse_review


def test_worthiness_parse_review_valid_json() -> None:
    review = _parse_review(
        """
        {
          "verdict": "needs_generalization",
          "confidence": 0.72,
          "reason": "The statement is useful but too specialized.",
          "evidence": ["Mathlib/Foo.lean:12 theorem foo : True"],
          "suggested_location": "Mathlib/Foo.lean",
          "suggested_name": "foo_general",
          "review_notes": ["Generalize from Nat to Semiring."]
        }
        """
    )

    assert review.verdict == "needs_generalization"
    assert review.confidence == 0.72
    assert review.suggested_location == "Mathlib/Foo.lean"
    assert review.suggested_name == "foo_general"
    assert review.evidence == ["Mathlib/Foo.lean:12 theorem foo : True"]


def test_worthiness_heuristic_rejects_true_theorem() -> None:
    review = _heuristic_review(
        "Every real number equals itself.",
        "theorem generated : True := by trivial",
        [],
    )

    assert review is not None
    assert review.verdict == "not_worth_submitting"
