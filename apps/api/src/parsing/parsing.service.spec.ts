import { describe, expect, it } from "vitest";

import { ParsingService } from "./parsing.service";
import { StubLlmAdapter } from "./stub.adapter";

describe("ParsingService (stub adapter)", () => {
  const svc = new ParsingService(new StubLlmAdapter());

  it("extracts signals from resume text and maps them to answer suggestions", async () => {
    const out = await svc.parseResume(
      "Senior engineer with 8 years experience in TypeScript and Python. Led 3 projects. AWS certified.",
    );
    expect(out.extracted.totalExperienceYears).toBe(8);
    expect(out.extracted.programmingLanguages).toContain("typescript");
    expect(out.extracted.programmingLanguages).toContain("python");
    expect(out.suggestions.totalExperienceYears).toBe(8);
    expect(out.suggestions.programmingLanguagesCount).toBeGreaterThanOrEqual(2);
  });

  it("returns empty suggestions for an uninformative resume", async () => {
    const out = await svc.parseResume("A short bio with no useful structured signals here.");
    expect(out.suggestions.totalExperienceYears).toBeUndefined();
  });
});
