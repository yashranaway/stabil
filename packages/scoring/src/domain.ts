/** Core domain types for the Stabil scoring engine. See SCOPE.md §4. */

import type { Tier } from "./tier";

export type Mode = "fresher" | "professional";

/** Score is composed from three blocks (SCOPE.md §4.1). */
export type Block = "mode" | "common" | "verification";

/** Whether a parameter's line-item is shown to candidates (SCOPE.md §6.3). */
export type Visibility = "all" | "employer-only";

export type Audience = "candidate" | "employer" | "recruiter";

export interface ParameterDefinition {
  readonly key: string;
  readonly label: string;
  /** Which mode this parameter applies to; "both" = common to every mode. */
  readonly appliesTo: Mode | "both";
  readonly block: Block;
  /** Maximum points this parameter can contribute. */
  readonly max: number;
  readonly visibility: Visibility;
}

export interface ScoringConfig {
  /** The full-scale maximum (1500 for Stabil). */
  readonly scaleMax: number;
  readonly parameters: readonly ParameterDefinition[];
}

/** Normalized per-parameter performance, each in [0, 1]. Missing keys score 0. */
export type ParameterValues = Readonly<Record<string, number>>;

export interface CandidateInput {
  readonly mode: Mode;
  readonly values: ParameterValues;
}

export interface ParameterScore {
  readonly key: string;
  readonly label: string;
  readonly block: Block;
  readonly visibility: Visibility;
  readonly awarded: number;
  readonly max: number;
}

export type BlockTotals = Record<Block, { awarded: number; max: number }>;

export interface ScoreResult {
  readonly mode: Mode;
  readonly total: number;
  readonly maxTotal: number;
  readonly tier: Tier;
  readonly breakdown: readonly ParameterScore[];
  readonly byBlock: BlockTotals;
}

/** A score result rendered for a specific audience (SCOPE.md §6.3). */
export interface AudienceScoreResult extends ScoreResult {
  readonly audience: Audience;
  /** How many line-items were suppressed for this audience (candidate view). */
  readonly hiddenParameterCount: number;
}
