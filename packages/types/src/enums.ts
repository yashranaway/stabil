// Re-export the engine's domain types so the whole app shares one source of truth,
// plus app-level enums the engine doesn't own.

export type {
  Audience,
  AudienceScoreResult,
  Block,
  BlockTotals,
  CandidateInput,
  Mode,
  ParameterDefinition,
  ParameterScore,
  ParameterValues,
  ScoreResult,
  ScoringConfig,
  Tier,
} from "@stabil/scoring";

export const ROLES = ["CANDIDATE", "EMPLOYER", "RECRUITER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export const PROFILE_CLAIM_STATUSES = ["UNCLAIMED", "CLAIMED"] as const;
export type ProfileClaimStatus = (typeof PROFILE_CLAIM_STATUSES)[number];

export const SHARE_STATUSES = ["ACTIVE", "REVOKED", "EXPIRED"] as const;
export type ShareStatus = (typeof SHARE_STATUSES)[number];
