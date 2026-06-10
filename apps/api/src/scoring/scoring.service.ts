import { Injectable } from "@nestjs/common";
import { toFractions } from "@stabil/core";
import {
  type Audience,
  type AudienceScoreResult,
  computeScore,
  filterForAudience,
  stabilConfig,
} from "@stabil/scoring";
import type { RawAnswers } from "@stabil/types";

@Injectable()
export class ScoringService {
  /** Raw answers -> rubric fractions -> deterministic score -> audience-filtered view. */
  score(answers: RawAnswers, audience: Audience = "candidate"): AudienceScoreResult {
    const values = toFractions(answers);
    const result = computeScore({ mode: answers.mode, values }, stabilConfig);
    return filterForAudience(result, audience);
  }
}
