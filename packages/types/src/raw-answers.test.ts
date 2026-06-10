import { describe, expect, it } from "vitest";

import { fresherAnswersSchema, professionalAnswersSchema, rawAnswersSchema } from "./raw-answers";

describe("rawAnswersSchema", () => {
  it("parses valid fresher answers and applies defaults", () => {
    const parsed = rawAnswersSchema.parse({
      mode: "fresher",
      academicsPercentage: 80,
      projectsCount: 3,
      programmingLanguagesCount: 2,
      aiFamiliarity: 4,
      cloudExposure: 3,
      certificationsCount: 1,
      willingToRelocate: true,
      flexibility: 5,
      workMode: "hybrid",
      communicationSelfRating: 4,
      yearsAtCurrentLocation: 2,
    });
    expect(parsed.mode).toBe("fresher");
    expect(parsed.verifiedDocumentsCount).toBe(0); // default
    if (parsed.mode === "fresher") {
      expect(parsed.communicationCertified).toBe(false); // default
    }
  });

  it("parses valid professional answers including sensitive fields", () => {
    const parsed = professionalAnswersSchema.parse({
      mode: "professional",
      totalExperienceYears: 5,
      averageTenureMonths: 24,
      spokenLanguagesCount: 2,
      age: 30,
      maritalStatus: "married",
      communicationSelfRating: 5,
      yearsAtCurrentLocation: 4,
    });
    expect(parsed.age).toBe(30);
    expect(parsed.maritalStatus).toBe("married");
  });

  it("rejects an out-of-range rating", () => {
    expect(() =>
      fresherAnswersSchema.parse({
        mode: "fresher",
        academicsPercentage: 80,
        projectsCount: 1,
        programmingLanguagesCount: 1,
        aiFamiliarity: 9, // invalid (>5)
        cloudExposure: 3,
        certificationsCount: 0,
        willingToRelocate: false,
        flexibility: 3,
        workMode: "remote",
        communicationSelfRating: 3,
        yearsAtCurrentLocation: 1,
      }),
    ).toThrow();
  });

  it("discriminates on mode", () => {
    expect(() => rawAnswersSchema.parse({ mode: "invalid" })).toThrow();
  });
});
