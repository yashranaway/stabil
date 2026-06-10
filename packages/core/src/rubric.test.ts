import { computeScore, stabilConfig } from "@stabil/scoring";
import type { FresherAnswers, ProfessionalAnswers } from "@stabil/types";
import { describe, expect, it } from "vitest";

import { toFractions } from "./rubric";

const fresher: FresherAnswers = {
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
  communicationCertified: false,
  yearsAtCurrentLocation: 2,
  verifiedDocumentsCount: 0,
};

const professional: ProfessionalAnswers = {
  mode: "professional",
  totalExperienceYears: 5,
  averageTenureMonths: 24,
  spokenLanguagesCount: 2,
  age: 30,
  maritalStatus: "married",
  communicationSelfRating: 5,
  communicationCertified: true,
  yearsAtCurrentLocation: 4,
  verifiedDocumentsCount: 0,
};

describe("toFractions", () => {
  it("maps fresher answers to fractions in [0,1]", () => {
    const f = toFractions(fresher);
    expect(f.academics).toBeCloseTo(0.8);
    expect(f.projects).toBeCloseTo(0.5); // 3/6
    expect(f.programmingLanguages).toBeCloseTo(0.5); // 2/4
    expect(f.aiFamiliarity).toBeCloseTo(0.75); // (4-1)/4
    expect(f.relocation).toBe(1);
    expect(f.workMode).toBeCloseTo(0.66, 1);
    expect(f.communication).toBeCloseTo(0.75); // (4-1)/4, no cert
    expect(f.location).toBeCloseTo(0.4); // 2/5
    expect(f.verifiedDocuments).toBe(0);
    for (const v of Object.values(f)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("maps professional answers including sensitive fields", () => {
    const p = toFractions(professional);
    expect(p.totalExperience).toBeCloseTo(0.5); // 5/10
    expect(p.tenure).toBeCloseTo(0.666, 1); // 24/36
    expect(p.spokenLanguages).toBeCloseTo(0.666, 1); // 2/3
    expect(p.age).toBeCloseTo(0.5); // (30-20)/20
    expect(p.maritalStatus).toBe(1); // married
    expect(p.communication).toBe(1); // rating 5 (=1.0) + cert bonus, capped at 1
  });

  it("applies the communication cert bonus, capped at 1", () => {
    const withCert = toFractions({ ...fresher, communicationSelfRating: 4, communicationCertified: true });
    expect(withCert.communication).toBeCloseTo(0.9); // 0.75 + 0.15
  });

  it("produces engine-acceptable fractions; a maxed fresher scores 1500 / 'stable'", () => {
    const maxed: FresherAnswers = {
      mode: "fresher",
      academicsPercentage: 100,
      projectsCount: 50,
      programmingLanguagesCount: 20,
      aiFamiliarity: 5,
      cloudExposure: 5,
      certificationsCount: 50,
      willingToRelocate: true,
      flexibility: 5,
      workMode: "onsite",
      communicationSelfRating: 5,
      communicationCertified: true,
      yearsAtCurrentLocation: 80,
      verifiedDocumentsCount: 10,
    };
    const result = computeScore({ mode: "fresher", values: toFractions(maxed) }, stabilConfig);
    expect(result.total).toBe(1500);
    expect(result.tier).toBe("stable");
  });
});
