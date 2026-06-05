import { describe, expect, it } from "vitest";

import type { Mode } from "./domain";
import { stabilConfig } from "./config";
import { computeScore } from "./score";

const modes: readonly Mode[] = ["fresher", "professional"];

describe("stabilConfig", () => {
  it("uses the 1500-point scale", () => {
    expect(stabilConfig.scaleMax).toBe(1500);
  });

  it("has unique parameter keys", () => {
    const keys = stabilConfig.parameters.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(modes)("applicable parameter maxes sum to the full scale for '%s'", (mode) => {
    const sum = stabilConfig.parameters
      .filter((p) => p.appliesTo === mode || p.appliesTo === "both")
      .reduce((acc, p) => acc + p.max, 0);
    expect(sum).toBe(stabilConfig.scaleMax);
  });

  it.each(modes)("a perfect candidate scores the maximum and is 'stable' (%s)", (mode) => {
    const values = Object.fromEntries(stabilConfig.parameters.map((p) => [p.key, 1]));
    const result = computeScore({ mode, values }, stabilConfig);
    expect(result.total).toBe(1500);
    expect(result.tier).toBe("stable");
  });

  it("keeps age and marital status employer-only", () => {
    const sensitive = stabilConfig.parameters.filter((p) =>
      ["age", "maritalStatus"].includes(p.key),
    );
    expect(sensitive).toHaveLength(2);
    expect(sensitive.every((p) => p.visibility === "employer-only")).toBe(true);
  });
});
