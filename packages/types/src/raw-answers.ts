import { z } from "zod";

// Raw, human-friendly form answers. The rubric layer (@stabil/core) maps these to
// the normalized [0,1] fractions the scoring engine consumes. Validated on both the
// frontend (form) and backend (API) from this single schema.

const rating1to5 = z.number().int().min(1).max(5);

const commonAnswers = {
  /** Self-rated communication ability (1–5). */
  communicationSelfRating: rating1to5,
  /** Holds a verifiable communication cert (IELTS/TOEFL/etc.) — small bonus. */
  communicationCertified: z.boolean().default(false),
  /** Years lived at current location — a settledness signal. */
  yearsAtCurrentLocation: z.number().min(0).max(80),
  /** Count of documents the candidate has had verified (0 until Phase 3). */
  verifiedDocumentsCount: z.number().int().min(0).max(10).default(0),
};

export const fresherAnswersSchema = z.object({
  mode: z.literal("fresher"),
  /** Academic score as a percentage (0–100). */
  academicsPercentage: z.number().min(0).max(100),
  projectsCount: z.number().int().min(0).max(50),
  programmingLanguagesCount: z.number().int().min(0).max(20),
  aiFamiliarity: rating1to5,
  cloudExposure: rating1to5,
  certificationsCount: z.number().int().min(0).max(50),
  willingToRelocate: z.boolean(),
  flexibility: rating1to5,
  workMode: z.enum(["onsite", "hybrid", "remote"]),
  ...commonAnswers,
});

export const professionalAnswersSchema = z.object({
  mode: z.literal("professional"),
  totalExperienceYears: z.number().min(0).max(50),
  /** Average tenure per job, in months. */
  averageTenureMonths: z.number().min(0).max(600),
  spokenLanguagesCount: z.number().int().min(1).max(15),
  // Sensitive (employer-only in reports), but still collected + scored.
  age: z.number().int().min(16).max(90),
  maritalStatus: z.enum(["single", "married", "other"]),
  ...commonAnswers,
});

export const rawAnswersSchema = z.discriminatedUnion("mode", [
  fresherAnswersSchema,
  professionalAnswersSchema,
]);

export type FresherAnswers = z.infer<typeof fresherAnswersSchema>;
export type ProfessionalAnswers = z.infer<typeof professionalAnswersSchema>;
export type RawAnswers = z.infer<typeof rawAnswersSchema>;
