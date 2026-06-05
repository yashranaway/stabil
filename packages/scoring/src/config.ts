/**
 * Default Stabil scoring config. Parameters come from SCOPE.md §4.
 *
 * Weights here are PLACEHOLDERS (calibration is a §13 design-time item). The only
 * invariant enforced by tests is that applicable maxes sum to the 1500 scale per mode:
 *   shared (common + verification) = 400, each mode-specific block = 1100.
 */

import type { ParameterDefinition, ScoringConfig } from "./domain";

const COMMON: readonly ParameterDefinition[] = [
  { key: "communication", label: "Communication", appliesTo: "both", block: "common", max: 150, visibility: "all" },
  { key: "location", label: "Location", appliesTo: "both", block: "common", max: 100, visibility: "all" },
  { key: "verifiedDocuments", label: "Verified documents", appliesTo: "both", block: "verification", max: 150, visibility: "all" },
];

const FRESHER: readonly ParameterDefinition[] = [
  { key: "academics", label: "Academics", appliesTo: "fresher", block: "mode", max: 250, visibility: "all" },
  { key: "projects", label: "Projects", appliesTo: "fresher", block: "mode", max: 250, visibility: "all" },
  { key: "programmingLanguages", label: "Programming languages", appliesTo: "fresher", block: "mode", max: 150, visibility: "all" },
  { key: "aiFamiliarity", label: "AI familiarity", appliesTo: "fresher", block: "mode", max: 100, visibility: "all" },
  { key: "cloud", label: "Cloud exposure", appliesTo: "fresher", block: "mode", max: 100, visibility: "all" },
  { key: "courseCerts", label: "Courses & certifications", appliesTo: "fresher", block: "mode", max: 100, visibility: "all" },
  { key: "relocation", label: "Relocation willingness", appliesTo: "fresher", block: "mode", max: 60, visibility: "all" },
  { key: "flexibility", label: "Flexibility", appliesTo: "fresher", block: "mode", max: 50, visibility: "all" },
  { key: "workMode", label: "Work-mode preference", appliesTo: "fresher", block: "mode", max: 40, visibility: "all" },
];

const PROFESSIONAL: readonly ParameterDefinition[] = [
  { key: "totalExperience", label: "Total experience", appliesTo: "professional", block: "mode", max: 350, visibility: "all" },
  { key: "tenure", label: "Tenure", appliesTo: "professional", block: "mode", max: 300, visibility: "all" },
  { key: "spokenLanguages", label: "Spoken languages", appliesTo: "professional", block: "mode", max: 150, visibility: "all" },
  { key: "age", label: "Age", appliesTo: "professional", block: "mode", max: 150, visibility: "employer-only" },
  { key: "maritalStatus", label: "Marital status", appliesTo: "professional", block: "mode", max: 150, visibility: "employer-only" },
];

export const stabilConfig: ScoringConfig = {
  scaleMax: 1500,
  parameters: [...FRESHER, ...PROFESSIONAL, ...COMMON],
};
