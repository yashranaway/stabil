import { z } from "zod";

import type { Role } from "./enums";
import { rawAnswersSchema } from "./raw-answers";

// ---- Auth ----
export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120).optional(),
  role: z.enum(["CANDIDATE", "EMPLOYER", "RECRUITER"]).default("CANDIDATE"),
});
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export const refreshSchema = z.object({ refreshToken: z.string().min(1) });
export const googleAuthSchema = z.object({ idToken: z.string().min(10) });

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type GoogleAuthDto = z.infer<typeof googleAuthSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

// ---- Profiles ----
export const createProfileSchema = z.object({
  displayName: z.string().min(1).max(120),
  mode: z.enum(["fresher", "professional"]),
});
export const submitCandidateSchema = createProfileSchema.extend({
  candidateEmail: z.string().email(),
});
export type CreateProfileDto = z.infer<typeof createProfileSchema>;
export type SubmitCandidateDto = z.infer<typeof submitCandidateSchema>;

// ---- Scoring ----
export const scoreRequestSchema = z.object({
  answers: rawAnswersSchema,
});
export type ScoreRequest = z.infer<typeof scoreRequestSchema>;

// ---- Consent / sharing ----
export const createShareSchema = z.object({
  granteeEmail: z.string().email(),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
export type CreateShareDto = z.infer<typeof createShareSchema>;
