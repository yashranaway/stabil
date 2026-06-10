import type { ParameterValues } from "@stabil/scoring";
import type { FresherAnswers, ProfessionalAnswers, RawAnswers } from "@stabil/types";

// The rubric maps raw human answers to normalized [0,1] fractions per parameter.
// These curves are PLACEHOLDERS pending calibration (SCOPE §13). The scoring engine
// stays pure: it only ever sees the fractions produced here.

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
/** 1–5 self-rating → [0,1]. */
const fromRating = (r: number): number => clamp01((r - 1) / 4);
/** value/full, clamped — a saturating curve where `full` maps to 1.0. */
const saturate = (value: number, full: number): number => clamp01(value / full);

const WORK_MODE_FRACTION: Record<FresherAnswers["workMode"], number> = {
  onsite: 1,
  hybrid: 0.66,
  remote: 0.33,
};

const MARITAL_FRACTION: Record<ProfessionalAnswers["maritalStatus"], number> = {
  married: 1,
  other: 0.5,
  single: 0.4,
};

/** Self-rating plus a small bonus for a verifiable communication cert, capped at 1. */
function communication(rating: number, certified: boolean): number {
  return clamp01(fromRating(rating) + (certified ? 0.15 : 0));
}

function commonFractions(a: RawAnswers): Record<string, number> {
  return {
    communication: communication(a.communicationSelfRating, a.communicationCertified),
    location: saturate(a.yearsAtCurrentLocation, 5),
    verifiedDocuments: saturate(a.verifiedDocumentsCount, 3),
  };
}

/** Map validated raw answers to the parameter fractions the engine consumes. */
export function toFractions(answers: RawAnswers): ParameterValues {
  if (answers.mode === "fresher") {
    return {
      academics: saturate(answers.academicsPercentage, 100),
      projects: saturate(answers.projectsCount, 6),
      programmingLanguages: saturate(answers.programmingLanguagesCount, 4),
      aiFamiliarity: fromRating(answers.aiFamiliarity),
      cloud: fromRating(answers.cloudExposure),
      courseCerts: saturate(answers.certificationsCount, 3),
      relocation: answers.willingToRelocate ? 1 : 0,
      flexibility: fromRating(answers.flexibility),
      workMode: WORK_MODE_FRACTION[answers.workMode],
      ...commonFractions(answers),
    };
  }

  return {
    totalExperience: saturate(answers.totalExperienceYears, 10),
    tenure: saturate(answers.averageTenureMonths, 36),
    spokenLanguages: saturate(answers.spokenLanguagesCount, 3),
    age: clamp01((answers.age - 20) / 20),
    maritalStatus: MARITAL_FRACTION[answers.maritalStatus],
    ...commonFractions(answers),
  };
}
