import { extractedResumeSchema, type ExtractedResume } from "@stabil/types";

import type { LlmAdapter } from "./llm-adapter";

const KNOWN_LANGS = [
  "javascript",
  "typescript",
  "python",
  "java",
  "go",
  "rust",
  "c++",
  "c#",
  "ruby",
  "php",
  "kotlin",
  "swift",
];

/**
 * Deterministic, key-free extraction via simple heuristics. Used in dev/CI and as a
 * fallback when OPENROUTER_API_KEY is unset, so the pipeline is always testable.
 */
export class StubLlmAdapter implements LlmAdapter {
  async extract(resumeText: string): Promise<ExtractedResume> {
    const lower = resumeText.toLowerCase();
    const langs = KNOWN_LANGS.filter((l) => lower.includes(l));
    const years = resumeText.match(/(\d+)\+?\s*years?/i);
    const projects = resumeText.match(/projects?/gi)?.length ?? 0;
    const certs = resumeText.match(/cert(?:ified|ification)/gi)?.length ?? 0;

    return extractedResumeSchema.parse({
      fullName: null,
      totalExperienceYears: years ? Number(years[1]) : null,
      averageTenureMonths: null,
      educationPercentage: null,
      projectsCount: projects || null,
      programmingLanguages: langs,
      spokenLanguages: [],
      certificationsCount: certs || null,
      currentLocation: null,
      confidence: 0.3,
    });
  }
}
