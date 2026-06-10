import { z } from "zod";

// Structured fields an LLM extracts from a resume. Everything is optional/nullable
// because resumes vary; the rubric/forms treat missing fields as "not provided".
export const extractedResumeSchema = z.object({
  fullName: z.string().nullable().default(null),
  totalExperienceYears: z.number().min(0).max(60).nullable().default(null),
  averageTenureMonths: z.number().min(0).max(600).nullable().default(null),
  educationPercentage: z.number().min(0).max(100).nullable().default(null),
  projectsCount: z.number().int().min(0).max(100).nullable().default(null),
  programmingLanguages: z.array(z.string()).default([]),
  spokenLanguages: z.array(z.string()).default([]),
  certificationsCount: z.number().int().min(0).max(100).nullable().default(null),
  currentLocation: z.string().nullable().default(null),
  /** Model's self-reported confidence in the extraction, 0–1. */
  confidence: z.number().min(0).max(1).default(0.5),
});

export type ExtractedResume = z.infer<typeof extractedResumeSchema>;
