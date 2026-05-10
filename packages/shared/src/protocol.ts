import { z } from 'zod';

// ---------- Primitives ----------

export const ClaimType = z.enum([
  'definition',
  'theorem',
  'lemma',
  'corollary',
  'proposition',
  'proof',
  'remark',
  'example',
  'claim',
  'conjecture',
  'exercise',
  'problem',
  'question',
]);
export type ClaimType = z.infer<typeof ClaimType>;

export const ClaimStatus = z.enum([
  'unverified',
  'translating',
  'verifying',
  'verified',
  'failed',
  'sorry',
]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

export const RootCauseCategory = z.enum([
  'unknownIdentifier',
  'typeMismatch',
  'tacticFailed',
  'timeout',
  'malformedJson',
  'other',
]);
export type RootCauseCategory = z.infer<typeof RootCauseCategory>;

export const MathlibWorthinessVerdict = z.enum([
  'mathlib_candidate',
  'project_local',
  'duplicate_likely',
  'needs_generalization',
  'not_worth_submitting',
  'unsure',
  'skipped',
]);
export type MathlibWorthinessVerdict = z.infer<typeof MathlibWorthinessVerdict>;

// ---------- Claim ----------

export const Claim = z.object({
  id: z.string(),
  type: ClaimType,
  number: z.string().optional(),
  label: z.string().optional(),
  startLine: z.number().int().nonnegative(),
  endLine: z.number().int().nonnegative(),
  statementLatex: z.string(),
  proofLatex: z.string().optional(),
  hashLatex: z.string(),
  hashNormalized: z.string(),
  status: ClaimStatus.default('unverified'),
  llmDependencyIds: z.array(z.string()).default([]),
});
export type Claim = z.infer<typeof Claim>;

// ---------- /verify_paper (orchestrated) ----------

export const VerifyPaperRequest = z.object({
  requestId: z.string().uuid(),
  targetClaimId: z.string(),
  claims: z.array(Claim),
  leanVersion: z.string(),
  mathlibVersion: z.string(),
});
export type VerifyPaperRequest = z.infer<typeof VerifyPaperRequest>;

// ---------- SSE events ----------

export const SseEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('orchestratorStarted'),
    requestId: z.string().uuid(),
    targetClaimId: z.string(),
    plan: z.array(
      z.object({ level: z.number().int().nonnegative(), claimIds: z.array(z.string()) }),
    ),
  }),
  z.object({
    type: z.literal('claimStatus'),
    requestId: z.string().uuid(),
    claimId: z.string(),
    status: ClaimStatus,
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal('claimVerified'),
    requestId: z.string().uuid(),
    claimId: z.string(),
    elapsedMs: z.number().int().nonnegative(),
    cacheHit: z.boolean(),
    leanCode: z.string().optional(),
  }),
  z.object({
    type: z.literal('mathlibWorthiness'),
    requestId: z.string().uuid(),
    claimId: z.string(),
    verdict: MathlibWorthinessVerdict,
    confidence: z.number().min(0).max(1),
    reason: z.string(),
    evidence: z.array(z.string()).default([]),
    suggestedLocation: z.string().optional(),
    suggestedName: z.string().optional(),
    reviewNotes: z.array(z.string()).default([]),
  }),
  z.object({
    type: z.literal('claimFailed'),
    requestId: z.string().uuid(),
    claimId: z.string(),
    rootCauseCategory: RootCauseCategory,
    deepestFailedClaimId: z.string(),
    explanation: z.string(),
    leanOutput: z.string().optional(),
    leanCode: z.string().optional(),
  }),
  z.object({
    type: z.literal('orchestratorFinished'),
    requestId: z.string().uuid(),
    overall: z.enum(['verified', 'failed', 'partial']),
  }),
  z.object({
    type: z.literal('claimDependencies'),
    requestId: z.string().uuid(),
    claimId: z.string(),
    llmDependencyIds: z.array(z.string()),
  }),
]);
export type SseEvent = z.infer<typeof SseEvent>;

// ---------- /status/{request_id} ----------

export const StatusResponse = z.object({
  requestId: z.string().uuid(),
  state: z.enum(['running', 'verified', 'failed', 'unknown']),
  events: z.array(SseEvent).default([]),
});
export type StatusResponse = z.infer<typeof StatusResponse>;

// ---------- Port RPC envelope (sidepanel <-> background) ----------

export const PortRequest = z.discriminatedUnion('type', [
  z.object({ type: z.literal('listClaims') }),
  z.object({ type: z.literal('verifyClaim'), claimId: z.string() }),
  z.object({ type: z.literal('cancelVerification'), requestId: z.string().uuid() }),
  z.object({ type: z.literal('getSettings') }),
  z.object({
    type: z.literal('setSettings'),
    settings: z.object({
      backendUrl: z.string().url(),
    }),
  }),
]);
export type PortRequest = z.infer<typeof PortRequest>;

export const PortMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claimsSnapshot'), claims: z.array(Claim) }),
  z.object({ type: z.literal('sse'), event: SseEvent }),
  z.object({
    type: z.literal('settings'),
    settings: z.object({
      backendUrl: z.string().url(),
    }),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type PortMessage = z.infer<typeof PortMessage>;

export const PORT_NAME = 'lale-panel';

// ---------- Content <-> background ----------

export const ContentMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('claimsSnapshot'), claims: z.array(Claim) }),
  z.object({ type: z.literal('setStatus'), claimId: z.string(), status: ClaimStatus }),
]);
export type ContentMessage = z.infer<typeof ContentMessage>;
