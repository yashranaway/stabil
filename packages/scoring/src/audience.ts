/** Render a score result for a specific audience (SCOPE.md §6.3). */

import type { Audience, AudienceScoreResult, ScoreResult } from "./domain";

/**
 * Candidates never see employer-only line-items, but the suppressed factors
 * still count toward the total — only the breakdown is filtered, not the score.
 */
export function filterForAudience(result: ScoreResult, audience: Audience): AudienceScoreResult {
  if (audience !== "candidate") {
    return { ...result, audience, hiddenParameterCount: 0 };
  }

  const visible = result.breakdown.filter((param) => param.visibility === "all");
  return {
    ...result,
    audience,
    breakdown: visible,
    hiddenParameterCount: result.breakdown.length - visible.length,
  };
}
