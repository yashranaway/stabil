import { describe, expect, it } from "vitest";

import type { ScoringConfig } from "./domain";
import { computeScore } from "./score";

// Small illustrative config whose applicable maxes sum to 1500 per mode.
const config: ScoringConfig = {
  scaleMax: 1500,
  parameters: [
    { key: "academics", label: "Academics", appliesTo: "fresher", block: "mode", max: 600, visibility: "all" },
    { key: "projects", label: "Projects", appliesTo: "fresher", block: "mode", max: 400, visibility: "all" },
    { key: "experience", label: "Total experience", appliesTo: "professional", block: "mode", max: 700, visibility: "all" },
    { key: "age", label: "Age", appliesTo: "professional", block: "mode", max: 300, visibility: "employer-only" },
    { key: "communication", label: "Communication", appliesTo: "both", block: "common", max: 300, visibility: "all" },
    { key: "verifiedId", label: "Verified ID", appliesTo: "both", block: "verification", max: 200, visibility: "all" },
  ],
};

describe("computeScore", () => {
  it("awards points as fraction × max and sums the total", () => {
    const result = computeScore(
      { mode: "professional", values: { experience: 1, age: 0.5, communication: 0.5, verifiedId: 1 } },
      config,
    );
    // 700 + 150 + 150 + 200 = 1200
    expect(result.total).toBe(1200);
    expect(result.maxTotal).toBe(1500);
    expect(result.tier).toBe("settled");
  });

  it("includes only parameters applicable to the selected mode", () => {
    const result = computeScore({ mode: "professional", values: {} }, config);
    expect(result.breakdown.map((p) => p.key).sort()).toEqual([
      "age",
      "communication",
      "experience",
      "verifiedId",
    ]);
  });

  it("groups awarded and max points by block", () => {
    const result = computeScore(
      { mode: "professional", values: { experience: 1, age: 0.5, communication: 0.5, verifiedId: 1 } },
      config,
    );
    expect(result.byBlock.mode).toEqual({ awarded: 850, max: 1000 });
    expect(result.byBlock.common).toEqual({ awarded: 150, max: 300 });
    expect(result.byBlock.verification).toEqual({ awarded: 200, max: 200 });
  });

  it("treats missing values as 0 and clamps values into [0, 1]", () => {
    const result = computeScore(
      { mode: "fresher", values: { academics: 2, projects: -1 } },
      config,
    );
    const academics = result.breakdown.find((p) => p.key === "academics");
    const projects = result.breakdown.find((p) => p.key === "projects");
    const communication = result.breakdown.find((p) => p.key === "communication");
    expect(academics?.awarded).toBe(600); // clamped to 1.0
    expect(projects?.awarded).toBe(0); // clamped to 0.0
    expect(communication?.awarded).toBe(0); // missing -> 0
  });
});
