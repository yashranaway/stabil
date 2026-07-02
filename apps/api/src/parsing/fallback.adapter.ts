import { Logger } from "@nestjs/common";
import type { ExtractedResume } from "@stabil/types";

import type { LlmAdapter } from "./llm-adapter";

/**
 * Tries `primary` first; on ANY failure (network error, upstream 429, bad JSON,
 * schema mismatch) falls back to `fallback` so a congested/misbehaving AI provider
 * never breaks the résumé-parsing feature outright. Callers can tell which path
 * actually ran via the returned `source` field.
 */
export class FallbackLlmAdapter implements LlmAdapter {
  private readonly logger = new Logger("FallbackLlmAdapter");

  constructor(
    private readonly primary: LlmAdapter,
    private readonly fallback: LlmAdapter,
  ) {}

  async extract(resumeText: string): Promise<ExtractedResume> {
    try {
      return await this.primary.extract(resumeText);
    } catch (err) {
      this.logger.warn(
        `primary AI adapter failed, using heuristic fallback: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.fallback.extract(resumeText);
    }
  }
}
