import type { ExtractedResume } from "@stabil/types";

/** Provider-agnostic resume extraction. Default impl = OpenRouter; swappable (e.g. self-hosted). */
export interface LlmAdapter {
  extract(resumeText: string): Promise<ExtractedResume>;
}

export const LLM_ADAPTER = Symbol("LLM_ADAPTER");
