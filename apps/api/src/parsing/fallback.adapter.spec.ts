import { describe, expect, it, vi } from "vitest";

import type { LlmAdapter } from "./llm-adapter";
import { FallbackLlmAdapter } from "./fallback.adapter";

const aiResult = { fullName: null, totalExperienceYears: 5, averageTenureMonths: null, educationPercentage: null, projectsCount: null, programmingLanguages: [], spokenLanguages: [], certificationsCount: null, currentLocation: null, confidence: 0.9, source: "ai" as const };
const heuristicResult = { ...aiResult, confidence: 0.3, source: "heuristic" as const };

describe("FallbackLlmAdapter", () => {
  it("returns the primary adapter's result when it succeeds", async () => {
    const primary: LlmAdapter = { extract: vi.fn().mockResolvedValue(aiResult) };
    const fallback: LlmAdapter = { extract: vi.fn().mockResolvedValue(heuristicResult) };

    const adapter = new FallbackLlmAdapter(primary, fallback);
    const result = await adapter.extract("some resume text");

    expect(result.source).toBe("ai");
    expect(fallback.extract).not.toHaveBeenCalled();
  });

  it("falls back to the secondary adapter when the primary throws (e.g. upstream 429)", async () => {
    const primary: LlmAdapter = { extract: vi.fn().mockRejectedValue(new Error("rate-limited upstream")) };
    const fallback: LlmAdapter = { extract: vi.fn().mockResolvedValue(heuristicResult) };

    const adapter = new FallbackLlmAdapter(primary, fallback);
    const result = await adapter.extract("some resume text");

    expect(result.source).toBe("heuristic");
    expect(fallback.extract).toHaveBeenCalledWith("some resume text");
  });
});
