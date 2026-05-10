"""Wire protocol — Pydantic v2 mirror of packages/shared/src/protocol.ts.

Conventions:
  - Wire format is camelCase. We define snake_case fields with `alias` so JSON in/out is camelCase.
  - `populate_by_name=True` and `model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)`
    let us write Python in snake_case while the wire stays camelCase.
  - Discriminated unions match TS `z.discriminatedUnion("type", [...])`.

When you change a model here, change packages/shared/src/protocol.ts to match. Run /lale-protocol-check
to confirm parity before shipping.
"""

from __future__ import annotations

from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class _Base(BaseModel):
    """All wire models inherit this — camelCase aliases, populate by name."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


# ---------- Primitives ----------

ClaimType = Literal[
    "definition", "theorem", "lemma", "corollary", "proposition",
    "proof", "remark", "example", "claim", "conjecture",
    "exercise", "problem", "question",
]
ClaimStatus = Literal["unverified", "translating", "verifying", "verified", "failed", "sorry"]
RootCauseCategory = Literal[
    "unknownIdentifier",
    "typeMismatch",
    "tacticFailed",
    "timeout",
    "malformedJson",
    "other",
]
MathlibWorthinessVerdict = Literal[
    "mathlib_candidate",
    "project_local",
    "duplicate_likely",
    "needs_generalization",
    "not_worth_submitting",
    "unsure",
    "skipped",
]


# ---------- Claim ----------


class Claim(_Base):
    id: str
    type: ClaimType
    number: str | None = None
    label: str | None = None
    start_line: int = Field(ge=0)
    end_line: int = Field(ge=0)
    statement_latex: str
    proof_latex: str | None = None
    hash_latex: str
    hash_normalized: str
    status: ClaimStatus = "unverified"
    llm_dependency_ids: list[str] = Field(default_factory=list)


# ---------- /verify_paper ----------


class VerifyPaperRequest(_Base):
    request_id: UUID
    target_claim_id: str
    claims: list[Claim]
    lean_version: str
    mathlib_version: str


# ---------- SSE events ----------


class _PlanLevel(_Base):
    level: int = Field(ge=0)
    claim_ids: list[str]


class SseOrchestratorStarted(_Base):
    type: Literal["orchestratorStarted"]
    request_id: UUID
    target_claim_id: str
    plan: list[_PlanLevel]


class SseClaimStatus(_Base):
    type: Literal["claimStatus"]
    request_id: UUID
    claim_id: str
    status: ClaimStatus
    detail: str | None = None


class SseClaimVerified(_Base):
    type: Literal["claimVerified"]
    request_id: UUID
    claim_id: str
    elapsed_ms: int = Field(ge=0)
    cache_hit: bool
    lean_code: str | None = None


class SseMathlibWorthiness(_Base):
    type: Literal["mathlibWorthiness"]
    request_id: UUID
    claim_id: str
    verdict: MathlibWorthinessVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str
    evidence: list[str] = Field(default_factory=list)
    suggested_location: str | None = None
    suggested_name: str | None = None
    review_notes: list[str] = Field(default_factory=list)


class SseClaimFailed(_Base):
    type: Literal["claimFailed"]
    request_id: UUID
    claim_id: str
    root_cause_category: RootCauseCategory
    deepest_failed_claim_id: str
    explanation: str
    lean_output: str | None = None
    lean_code: str | None = None


class SseOrchestratorFinished(_Base):
    type: Literal["orchestratorFinished"]
    request_id: UUID
    overall: Literal["verified", "failed", "partial"]


class SseClaimDependencies(_Base):
    type: Literal["claimDependencies"]
    request_id: UUID
    claim_id: str
    llm_dependency_ids: list[str]


SseEvent = Annotated[
    SseOrchestratorStarted
    | SseClaimStatus
    | SseClaimVerified
    | SseMathlibWorthiness
    | SseClaimFailed
    | SseOrchestratorFinished
    | SseClaimDependencies,
    Field(discriminator="type"),
]


# ---------- /status/{request_id} ----------


class StatusResponse(_Base):
    request_id: UUID
    state: Literal["running", "verified", "failed", "unknown"]
    events: list[SseEvent] = Field(default_factory=list)
