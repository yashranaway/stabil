/** Deterministic, fixed-weight score aggregation. See SCOPE.md §4. */

import type {
  BlockTotals,
  CandidateInput,
  Mode,
  ParameterDefinition,
  ParameterScore,
  ScoreResult,
  ScoringConfig,
} from "./domain";
import { mapTier } from "./tier";

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

function appliesToMode(def: ParameterDefinition, mode: Mode): boolean {
  return def.appliesTo === mode || def.appliesTo === "both";
}

function emptyBlockTotals(): BlockTotals {
  return {
    mode: { awarded: 0, max: 0 },
    common: { awarded: 0, max: 0 },
    verification: { awarded: 0, max: 0 },
  };
}

/** Score a candidate against a config: per-parameter awards, block subtotals, total, and tier. */
export function computeScore(input: CandidateInput, config: ScoringConfig): ScoreResult {
  const breakdown: ParameterScore[] = config.parameters
    .filter((def) => appliesToMode(def, input.mode))
    .map((def) => ({
      key: def.key,
      label: def.label,
      block: def.block,
      visibility: def.visibility,
      awarded: Math.round(clamp01(input.values[def.key] ?? 0) * def.max),
      max: def.max,
    }));

  const byBlock = emptyBlockTotals();
  let total = 0;
  let maxTotal = 0;
  for (const param of breakdown) {
    byBlock[param.block].awarded += param.awarded;
    byBlock[param.block].max += param.max;
    total += param.awarded;
    maxTotal += param.max;
  }

  return { mode: input.mode, total, maxTotal, tier: mapTier(total), breakdown, byBlock };
}
