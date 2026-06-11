import { describe, expect, it, vi } from "vitest";

import { ReportsService } from "./reports.service";

// A stored ScoreRun whose breakdown includes employer-only items.
const run = {
  total: 1105,
  maxTotal: 1500,
  tier: "settled",
  byBlock: {},
  breakdown: [
    { key: "totalExperience", label: "Total experience", block: "mode", visibility: "all", awarded: 280, max: 350 },
    { key: "age", label: "Age", block: "mode", visibility: "employer-only", awarded: 150, max: 150 },
    { key: "maritalStatus", label: "Marital status", block: "mode", visibility: "employer-only", awarded: 150, max: 150 },
    { key: "verifiedDocuments", label: "Verified documents", block: "verification", visibility: "all", awarded: 0, max: 150 },
  ],
  createdAt: new Date(),
};

function makeService(audience: "candidate" | "employer") {
  const prisma = {
    candidateProfile: { findFirst: vi.fn().mockResolvedValue({ id: "p1", displayName: "Jo", mode: "professional" }) },
    scoreRun: { findFirst: vi.fn().mockResolvedValue(run) },
  };
  const consent = { hasAccess: vi.fn().mockResolvedValue({ allowed: true, audience }) };
  return new ReportsService(prisma as never, consent as never, {} as never, {} as never);
}

describe("ReportsService.getReport", () => {
  it("hides age & marital status from the candidate view but keeps the total", async () => {
    const report = await makeService("candidate").getReport(
      { id: "u1", email: "jo@x.com", name: null, role: "CANDIDATE" },
      "p1",
    );
    const keys = report.breakdown.map((b) => b.key);
    expect(keys).not.toContain("age");
    expect(keys).not.toContain("maritalStatus");
    expect(report.total).toBe(1105);
    expect(report.hiddenParameterCount).toBe(2);
    expect(report.suggestions.some((s) => s.includes("Verify"))).toBe(true);
  });

  it("shows age & marital status to the employer view with the same total", async () => {
    const report = await makeService("employer").getReport(
      { id: "u2", email: "hr@co.com", name: null, role: "EMPLOYER" },
      "p1",
    );
    const keys = report.breakdown.map((b) => b.key);
    expect(keys).toContain("age");
    expect(keys).toContain("maritalStatus");
    expect(report.total).toBe(1105);
  });

  it("denies access when there is no consent", async () => {
    const prisma = { candidateProfile: { findFirst: vi.fn() }, scoreRun: { findFirst: vi.fn() } };
    const consent = { hasAccess: vi.fn().mockResolvedValue({ allowed: false, audience: "candidate" }) };
    const svc = new ReportsService(prisma as never, consent as never, {} as never, {} as never);
    await expect(
      svc.getReport({ id: "u3", email: "no@x.com", name: null, role: "EMPLOYER" }, "p1"),
    ).rejects.toThrow();
  });
});
