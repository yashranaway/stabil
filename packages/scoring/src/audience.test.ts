import { describe, expect, it } from "vitest";

import type { ScoreResult } from "./domain";
import { filterForAudience } from "./audience";

const result: ScoreResult = {
  mode: "professional",
  total: 1200,
  maxTotal: 1500,
  tier: "settled",
  byBlock: {
    mode: { awarded: 850, max: 1000 },
    common: { awarded: 150, max: 300 },
    verification: { awarded: 200, max: 200 },
  },
  breakdown: [
    { key: "experience", label: "Total experience", block: "mode", visibility: "all", awarded: 700, max: 700 },
    { key: "age", label: "Age", block: "mode", visibility: "employer-only", awarded: 150, max: 300 },
    { key: "communication", label: "Communication", block: "common", visibility: "all", awarded: 150, max: 300 },
    { key: "verifiedId", label: "Verified ID", block: "verification", visibility: "all", awarded: 200, max: 200 },
  ],
};

describe("filterForAudience", () => {
  it("hides employer-only line items from the candidate view but keeps the total", () => {
    const view = filterForAudience(result, "candidate");
    expect(view.total).toBe(1200);
    expect(view.tier).toBe("settled");
    expect(view.breakdown.map((p) => p.key)).not.toContain("age");
    expect(view.hiddenParameterCount).toBe(1);
  });

  it("shows the full breakdown to employers", () => {
    const view = filterForAudience(result, "employer");
    expect(view.breakdown.map((p) => p.key)).toContain("age");
    expect(view.hiddenParameterCount).toBe(0);
  });

  it("shows the full breakdown to recruiters", () => {
    const view = filterForAudience(result, "recruiter");
    expect(view.breakdown).toHaveLength(4);
    expect(view.hiddenParameterCount).toBe(0);
  });
});
