"""Orchestrator for verifying a target claim.

1. BFS the dependency graph from the target outward (reachable subgraph only).
2. Topologically order; group into levels.
3. Per claim: translation cache -> translate if miss -> cache.
4. Per level: verify in parallel; events from concurrent siblings INTERLEAVE temporally.
5. On failure: halt downstream; identify deepest-failed-claim so the UI can root-cause.

Concurrent verification of sibling claims is a hard requirement — sequential is a major perf
regression. Sibling events are merged via an asyncio.Queue so the SSE stream reflects the actual
timing of work happening on the backend.

For the vertical slice the dependency graph comes from \\ref/\\eqref labels in the proof.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import AsyncIterator, Iterable
from uuid import UUID

from .cache import Cache
from .config import Settings
from .lean_server import LeanPool, compose_lean_source
from .normalize import normalize_latex
from .protocol import (
    Claim,
    SseClaimDependencies,
    SseClaimFailed,
    SseClaimStatus,
    SseClaimVerified,
    SseMathlibWorthiness,
    SseEvent,
    SseOrchestratorFinished,
    SseOrchestratorStarted,
)
from .retrieval import MathlibRetriever, extract_query_terms
from .semantic_review import SemanticReviewer
from .translator import MAX_ATTEMPTS, TranslateRequest, Translator, categorize_lean_error
from .trust import policy_violations
from .worthiness import MathlibWorthinessReviewer
from .dependency_extractor import DependencyExtractor

log = logging.getLogger(__name__)


_LEVEL_DONE = object()  # sentinel pushed onto the queue when a claim's verify task finishes


@dataclass
class _Run:
    request_id: UUID
    target_id: str
    claims_by_id: dict[str, Claim]
    deps: dict[str, list[str]]
    levels: list[list[str]]
    lean_by_id: dict[str, str] = field(default_factory=dict)


_LABEL_REF = re.compile(r"\\(?:ref|eqref|cref|Cref)\{([^}]+)\}")


def extract_label_refs(claim: Claim) -> list[str]:
    """Cheap heuristic: pull \\ref/\\eqref labels out of statement+proof."""
    text = (claim.statement_latex or "") + "\n" + (claim.proof_latex or "")
    return list(set(_LABEL_REF.findall(text)))


def topo_levels(nodes: Iterable[str], deps: dict[str, list[str]]) -> list[list[str]]:
    """Group nodes into levels: level 0 has no deps among `nodes`; level k depends only on <k.

    Returns levels in dependency-first order so callers can verify level by level.
    """
    nodes_set = set(nodes)
    in_deg: dict[str, int] = {n: 0 for n in nodes_set}
    rev: dict[str, list[str]] = defaultdict(list)
    for n in nodes_set:
        for d in deps.get(n, []):
            if d in nodes_set:
                in_deg[n] += 1
                rev[d].append(n)
    level: list[str] = [n for n, deg in in_deg.items() if deg == 0]
    out: list[list[str]] = []
    while level:
        out.append(sorted(level))
        nxt: list[str] = []
        for n in level:
            for m in rev[n]:
                in_deg[m] -= 1
                if in_deg[m] == 0:
                    nxt.append(m)
        level = nxt
    if sum(len(lvl) for lvl in out) != len(nodes_set):
        leftover = nodes_set - {n for lvl in out for n in lvl}
        out.append(sorted(leftover))
    return out


class Orchestrator:
    def __init__(
        self,
        settings: Settings,
        cache: Cache,
        translator: Translator,
        lean_pool: LeanPool,
    ) -> None:
        self.settings = settings
        self.cache = cache
        self.translator = translator
        self.lean_pool = lean_pool
        self.retriever = MathlibRetriever(settings)
        self.semantic_reviewer = SemanticReviewer(settings)
        self.worthiness_reviewer = MathlibWorthinessReviewer(settings, self.retriever)
        self.dependency_extractor = DependencyExtractor(settings, cache)
        self._history: dict[UUID, list[SseEvent]] = {}
        self._states: dict[UUID, str] = {}

    def history(self, request_id: UUID) -> tuple[str, list[SseEvent]]:
        return self._states.get(request_id, "unknown"), list(self._history.get(request_id, []))

    async def run(
        self, request_id: UUID, target_claim_id: str, claims: list[Claim]
    ) -> AsyncIterator[SseEvent]:
        claims_by_id = {c.id: c for c in claims}
        by_label = {c.label: c.id for c in claims if c.label}
        
        deps: dict[str, list[str]] = {}
        reachable: set[str] = set()
        queue = deque([target_claim_id])
        dep_events: list[SseClaimDependencies] = []

        while queue:
            curr_id = queue.popleft()
            if curr_id in reachable:
                continue
            reachable.add(curr_id)

            curr_index = next((i for i, c in enumerate(claims) if c.id == curr_id), -1)
            if curr_index == -1:
                continue

            curr_claim = claims[curr_index]

            # 1. Heuristic dependencies from explicit \ref and \eqref
            heuristic_deps = extract_label_refs(curr_claim)
            heuristic_dep_ids = [by_label[r] for r in heuristic_deps if r in by_label and by_label[r] != curr_id]

            # 2. LLM dependencies
            llm_dep_ids = await self.dependency_extractor.extract_dependencies(curr_index, claims)
            dep_events.append(SseClaimDependencies(
                type="claimDependencies",
                request_id=request_id,
                claim_id=curr_id,
                llm_dependency_ids=llm_dep_ids,
            ))

            all_deps = list(set(heuristic_dep_ids + llm_dep_ids))

            # Filter to only claims that appear BEFORE this claim
            valid_deps = [d for d in all_deps if d in claims_by_id and claims.index(claims_by_id[d]) < curr_index]

            deps[curr_id] = valid_deps
            for d in valid_deps:
                if d not in reachable:
                    queue.append(d)
        
        levels = topo_levels(reachable, deps)
        run = _Run(
            request_id=request_id,
            target_id=target_claim_id,
            claims_by_id={c.id: c for c in claims},
            deps=deps,
            levels=levels,
        )
        self._history[request_id] = []
        self._states[request_id] = "running"

        async for ev in self._record(
            run,
            SseOrchestratorStarted(
                type="orchestratorStarted",
                request_id=request_id,
                target_claim_id=target_claim_id,
                plan=[
                    {"level": i, "claim_ids": ids}  # type: ignore[typeddict-item]
                    for i, ids in enumerate(levels)
                ],
            ),
        ):
            yield ev

        for dep_ev in dep_events:
            async for ev in self._record(run, dep_ev):
                yield ev

        for level_ids in levels:
            level_failed = False
            terminal_by_id: dict[str, SseEvent] = {}
            queue: asyncio.Queue[tuple[str, SseEvent] | object] = asyncio.Queue()

            tasks = [
                asyncio.create_task(self._verify_one(run, cid, queue)) for cid in level_ids
            ]
            done_count = 0
            while done_count < len(tasks):
                item = await queue.get()
                if item is _LEVEL_DONE:
                    done_count += 1
                    continue
                cid, ev = item  # type: ignore[misc]
                async for out in self._record(run, ev):
                    yield out
                if isinstance(ev, (SseClaimVerified, SseClaimFailed)):
                    terminal_by_id[cid] = ev
                if isinstance(ev, SseClaimFailed):
                    level_failed = True

            await asyncio.gather(*tasks, return_exceptions=True)

            if level_failed:
                failed_ids = [
                    cid
                    for cid in level_ids
                    if isinstance(terminal_by_id.get(cid), SseClaimFailed)
                ]
                deepest = failed_ids[0] if failed_ids else level_ids[0]
                # Re-emit the first failure with deepest_failed_claim_id annotated, so the UI can
                # surface the actual root cause instead of the surface theorem.
                first_fail = terminal_by_id[failed_ids[0]]
                if isinstance(first_fail, SseClaimFailed):
                    annotated = SseClaimFailed(
                        type="claimFailed",
                        request_id=first_fail.request_id,
                        claim_id=first_fail.claim_id,
                        root_cause_category=first_fail.root_cause_category,
                        deepest_failed_claim_id=deepest,
                        explanation=first_fail.explanation,
                        lean_output=first_fail.lean_output,
                    )
                    async for out in self._record(run, annotated):
                        yield out

                async for out in self._record(
                    run,
                    SseOrchestratorFinished(
                        type="orchestratorFinished",
                        request_id=request_id,
                        overall="failed",
                    ),
                ):
                    yield out
                self._states[request_id] = "failed"
                return

        async for out in self._record(
            run,
            SseOrchestratorFinished(
                type="orchestratorFinished", request_id=request_id, overall="verified"
            ),
        ):
            yield out
        self._states[request_id] = "verified"

    # ---------- Internals ----------

    async def _record(self, run: _Run, ev: SseEvent) -> AsyncIterator[SseEvent]:
        self._history[run.request_id].append(ev)
        yield ev

    async def _verify_one(
        self,
        run: _Run,
        claim_id: str,
        queue: "asyncio.Queue[tuple[str, SseEvent] | object]",
    ) -> None:
        """Drive a single claim through translate → verify, pushing events onto the queue.

        Always pushes _LEVEL_DONE last so the run loop can count completions."""
        try:
            if claim_id not in run.claims_by_id:
                raise KeyError(f"claim {claim_id!r} not in claims_by_id")
            claim = run.claims_by_id[claim_id]

            await queue.put(
                (
                    claim_id,
                    SseClaimStatus(
                        type="claimStatus",
                        request_id=run.request_id,
                        claim_id=claim_id,
                        status="translating",
                    ),
                )
            )

            translate_req = TranslateRequest(
                latex=claim.statement_latex,
                kind=claim.type,
                context_definitions_lean=[
                    run.lean_by_id[d] for d in run.deps.get(claim_id, []) if d in run.lean_by_id
                ],
            )
            tr = await self.translator.translate(translate_req)
            dep_codes = [
                run.lean_by_id[d] for d in run.deps.get(claim_id, []) if d in run.lean_by_id
            ]

            for attempt_no in range(MAX_ATTEMPTS):
                if tr.status != "ok":
                    await queue.put(
                        (
                            claim_id,
                            SseClaimFailed(
                                type="claimFailed",
                                request_id=run.request_id,
                                claim_id=claim_id,
                                root_cause_category="malformedJson",
                                deepest_failed_claim_id=claim_id,
                                explanation=(
                                    "Translator failed to produce valid Lean after retries."
                                ),
                                lean_output=None,
                            ),
                        )
                    )
                    return

                run.lean_by_id[claim_id] = tr.lean_code

                await queue.put(
                    (
                        claim_id,
                        SseClaimStatus(
                            type="claimStatus",
                            request_id=run.request_id,
                            claim_id=claim_id,
                            status="verifying",
                            detail=(
                                f"attempt {attempt_no + 1}/{MAX_ATTEMPTS}"
                                if attempt_no > 0
                                else None
                            ),
                        ),
                    )
                )

                violations = policy_violations(
                    tr.lean_code,
                    strict_no_sorry=False,  # Lean server detects sorry; post-Lean check at line 394 enforces it
                    strict_no_axioms=self.settings.strict_no_axioms,
                )
                if violations:
                    status = "failed"
                    elapsed_ms = 0
                    cache_hit = False
                    lean_output = "Strict Lean policy violation: " + "; ".join(violations)
                else:
                    cached = self.cache.get_verification(
                        lean_code=tr.lean_code,
                        dep_lean_codes=dep_codes,
                        lean_version=self.settings.lean_version,
                        mathlib_version=self.settings.mathlib_version,
                    )
                    if cached is not None:
                        lean_output = cached.lean_output
                        elapsed_ms = cached.elapsed_ms
                        cache_hit = True
                        status = cached.status
                    else:
                        check_source = compose_lean_source(tr.lean_code, dep_codes)
                        check = await self.lean_pool.check(check_source)
                        self.cache.put_verification(
                            lean_code=tr.lean_code,
                            dep_lean_codes=dep_codes,
                            lean_version=self.settings.lean_version,
                            mathlib_version=self.settings.mathlib_version,
                            status=check.status,
                            lean_output=check.lean_output,
                            errors_json=json.dumps(
                                [e.model_dump(by_alias=True) for e in check.errors]
                            ),
                            elapsed_ms=check.elapsed_ms,
                        )
                        lean_output = check.lean_output
                        elapsed_ms = check.elapsed_ms
                        cache_hit = False
                        status = check.status

                if status == "sorry" and self.settings.strict_no_sorry:
                    status = "failed"
                    # Preserve Lean's actual output for the retry categorizer; append the policy reason.
                    lean_output = (lean_output + "\nNote: proof accepted only with `sorry`; provide an actual proof.").strip()

                if status in ("verified", "sorry"):
                    await queue.put(
                        (
                            claim_id,
                            SseClaimStatus(
                                type="claimStatus",
                                request_id=run.request_id,
                                claim_id=claim_id,
                                status="verifying",
                                detail="semantic review",
                            ),
                        )
                    )
                    review = await self.semantic_reviewer.review(
                        latex=claim.statement_latex,
                        lean_code=tr.lean_code,
                        context_lean=dep_codes,
                    )
                    if review.verdict in ("faithful", "skipped"):
                        self.cache.put_translation(
                            raw_latex=translate_req.latex,
                            normalized_latex=normalize_latex(translate_req.latex),
                            model=self.settings.translator_model,
                            lean_code=tr.lean_code,
                            imports=tr.imports,
                            attempts_json=json.dumps(
                                [a.model_dump(by_alias=True) for a in tr.attempts]
                            ),
                        )
                        worthiness = await self.worthiness_reviewer.review(
                            latex=claim.statement_latex,
                            lean_code=tr.lean_code,
                            dependency_lean=dep_codes,
                            semantic_review=review.explanation,
                        )
                        await queue.put(
                            (
                                claim_id,
                                SseClaimVerified(
                                    type="claimVerified",
                                    request_id=run.request_id,
                                    claim_id=claim_id,
                                    elapsed_ms=elapsed_ms,
                                    cache_hit=cache_hit,
                                    lean_code=tr.lean_code,
                                ),
                            )
                        )
                        await queue.put(
                            (
                                claim_id,
                                SseMathlibWorthiness(
                                    type="mathlibWorthiness",
                                    request_id=run.request_id,
                                    claim_id=claim_id,
                                    verdict=worthiness.verdict,
                                    confidence=worthiness.confidence,
                                    reason=worthiness.reason,
                                    evidence=worthiness.evidence,
                                    suggested_location=worthiness.suggested_location,
                                    suggested_name=worthiness.suggested_name,
                                    review_notes=worthiness.review_notes,
                                ),
                            )
                        )
                        return
                    status = "failed"
                    lean_output = f"Semantic review {review.verdict}: {review.explanation}"

                if attempt_no < MAX_ATTEMPTS - 1:
                    await queue.put(
                        (
                            claim_id,
                            SseClaimStatus(
                                type="claimStatus",
                                request_id=run.request_id,
                                claim_id=claim_id,
                                status="translating",
                                detail="retrieving local Mathlib context",
                            ),
                        )
                    )
                    terms = extract_query_terms(
                        claim.statement_latex,
                        claim.proof_latex or "",
                        tr.lean_code,
                        lean_output,
                    )
                    mathlib_hints = [hit.format() for hit in self.retriever.search(terms)]
                    await queue.put(
                        (
                            claim_id,
                            SseClaimStatus(
                                type="claimStatus",
                                request_id=run.request_id,
                                claim_id=claim_id,
                                status="translating",
                                detail=f"retry after {categorize_lean_error(lean_output)}",
                            ),
                        )
                    )
                    tr = await self.translator.retranslate_with_lean_error(
                        translate_req,
                        prior_lean_code=tr.lean_code,
                        lean_output=lean_output,
                        mathlib_hints=mathlib_hints,
                    )
                    continue

                await queue.put(
                    (
                        claim_id,
                        SseClaimFailed(
                            type="claimFailed",
                            request_id=run.request_id,
                            claim_id=claim_id,
                            root_cause_category=categorize_lean_error(lean_output),
                            deepest_failed_claim_id=claim_id,
                            explanation=f"Lean verification failed: {status}",
                            lean_output=lean_output,
                            lean_code=tr.lean_code,
                        ),
                    )
                )
                return
        except Exception as exc:
            log.exception("_verify_one crashed for %s", claim_id)
            await queue.put(
                (
                    claim_id,
                    SseClaimFailed(
                        type="claimFailed",
                        request_id=run.request_id,
                        claim_id=claim_id,
                        root_cause_category="other",
                        deepest_failed_claim_id=claim_id,
                        explanation=f"Internal error: {exc}",
                        lean_output=None,
                        lean_code=None,
                    ),
                )
            )
        finally:
            await queue.put(_LEVEL_DONE)
