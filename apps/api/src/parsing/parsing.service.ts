import { Inject, Injectable } from "@nestjs/common";
import type { ExtractedResume } from "@stabil/types";

import { LLM_ADAPTER, type LlmAdapter } from "./llm-adapter";

export interface ParseResult {
  extracted: ExtractedResume;
  /** Suggested form-answer prefills (keyed to raw-answer fields) for user confirmation. */
  suggestions: Record<string, number>;
}

@Injectable()
export class ParsingService {
  constructor(@Inject(LLM_ADAPTER) private readonly llm: LlmAdapter) {}

  async parseResume(resumeText: string): Promise<ParseResult> {
    const extracted = await this.llm.extract(resumeText);
    return { extracted, suggestions: this.toSuggestions(extracted) };
  }

  /** Map extracted signals to raw-answer field suggestions (human confirms before scoring). */
  private toSuggestions(e: ExtractedResume): Record<string, number> {
    const s: Record<string, number> = {};
    if (e.totalExperienceYears != null) s.totalExperienceYears = e.totalExperienceYears;
    if (e.averageTenureMonths != null) s.averageTenureMonths = e.averageTenureMonths;
    if (e.educationPercentage != null) s.academicsPercentage = e.educationPercentage;
    if (e.projectsCount != null) s.projectsCount = e.projectsCount;
    if (e.programmingLanguages.length > 0) s.programmingLanguagesCount = e.programmingLanguages.length;
    if (e.spokenLanguages.length > 0) s.spokenLanguagesCount = e.spokenLanguages.length;
    if (e.certificationsCount != null) s.certificationsCount = e.certificationsCount;
    return s;
  }
}
