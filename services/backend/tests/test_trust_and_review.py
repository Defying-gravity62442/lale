from lale_backend.semantic_review import _parse_review, _obvious_mismatch
from lale_backend.trust import policy_violations


def test_policy_violations_rejects_sorry_and_axioms() -> None:
    code = "axiom fake : False\n\ntheorem t : True := by\n  sorry\n"

    violations = policy_violations(code, strict_no_sorry=True, strict_no_axioms=True)

    assert "proof contains `sorry`/`admit`" in violations
    assert "introduces `axiom` declaration" in violations


def test_policy_violations_can_allow_sorry() -> None:
    code = "theorem t : True := by\n  sorry\n"

    assert policy_violations(code, strict_no_sorry=False, strict_no_axioms=True) == []


def test_obvious_mismatch_flags_true_theorem() -> None:
    review = _obvious_mismatch("For every real x, x = x.", "theorem t : True := by trivial")

    assert review is not None
    assert review.verdict == "mismatch"


def test_parse_review_handles_valid_json() -> None:
    review = _parse_review('{"verdict":"faithful","explanation":"same quantifiers"}')

    assert review.verdict == "faithful"
    assert review.explanation == "same quantifiers"
