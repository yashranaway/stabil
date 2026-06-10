import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthUser, ProfessionalAnswers } from "@stabil/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProfilesService } from "./profiles.service";

// Minimal in-memory mock of the slice of PrismaService the service uses.
function makePrismaMock() {
  return {
    candidateProfile: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    formSubmission: {
      create: vi.fn(),
    },
    scoreRun: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  };
}

type PrismaMock = ReturnType<typeof makePrismaMock>;

const owner: AuthUser = { id: "user-owner", email: "owner@example.com", name: "Owner", role: "CANDIDATE" };
const other: AuthUser = { id: "user-other", email: "other@example.com", name: "Other", role: "CANDIDATE" };
const employer: AuthUser = { id: "user-emp", email: "emp@example.com", name: "Emp", role: "EMPLOYER" };

const professionalAnswers: ProfessionalAnswers = {
  mode: "professional",
  totalExperienceYears: 6,
  averageTenureMonths: 30,
  spokenLanguagesCount: 2,
  age: 30,
  maritalStatus: "married",
  communicationSelfRating: 4,
  communicationCertified: false,
  yearsAtCurrentLocation: 4,
  verifiedDocumentsCount: 1,
};

describe("ProfilesService", () => {
  let prisma: PrismaMock;
  let service: ProfilesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    // Cast: the mock only implements the methods the service touches.
    service = new ProfilesService(prisma as never);
  });

  describe("createProfile", () => {
    it("creates a CLAIMED profile owned and submitted by the caller", async () => {
      prisma.candidateProfile.create.mockResolvedValue({ id: "p1" });

      await service.createProfile(owner, { displayName: "Riya", mode: "fresher" });

      expect(prisma.candidateProfile.create).toHaveBeenCalledWith({
        data: {
          displayName: "Riya",
          mode: "fresher",
          ownerUserId: owner.id,
          submittedByUserId: owner.id,
          claimStatus: "CLAIMED",
        },
      });
    });
  });

  describe("submitCandidate", () => {
    it("creates an UNCLAIMED profile with submitter + candidateEmail, no owner", async () => {
      prisma.candidateProfile.create.mockResolvedValue({ id: "p2" });

      await service.submitCandidate(employer, {
        displayName: "Arjun",
        mode: "professional",
        candidateEmail: "arjun@example.com",
      });

      expect(prisma.candidateProfile.create).toHaveBeenCalledWith({
        data: {
          displayName: "Arjun",
          mode: "professional",
          candidateEmail: "arjun@example.com",
          submittedByUserId: employer.id,
          claimStatus: "UNCLAIMED",
        },
      });
    });
  });

  describe("listMine", () => {
    it("scopes to the owner and flattens the latest score run into a summary", async () => {
      prisma.candidateProfile.findMany.mockResolvedValue([
        { id: "p1", scoreRuns: [{ total: 900, tier: "somewhat-stable" }] },
        { id: "p2", scoreRuns: [] },
      ]);

      const result = await service.listMine(owner);

      expect(prisma.candidateProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ownerUserId: owner.id, deletedAt: null },
          orderBy: { createdAt: "desc" },
        }),
      );
      expect(result[0].latestScoreRun).toEqual({ total: 900, tier: "somewhat-stable" });
      expect(result[1].latestScoreRun).toBeNull();
      expect((result[0] as Record<string, unknown>).scoreRuns).toBeUndefined();
    });
  });

  describe("getOne", () => {
    it("returns the profile + latest score run for the owner", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({
        id: "p1",
        ownerUserId: owner.id,
        submittedByUserId: owner.id,
        scoreRuns: [{ id: "r1" }],
      });

      const result = await service.getOne(owner, "p1");

      expect(result.latestScoreRun).toEqual({ id: "r1" });
      expect((result as Record<string, unknown>).scoreRuns).toBeUndefined();
    });

    it("returns the profile for the submitter", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({
        id: "p1",
        ownerUserId: null,
        submittedByUserId: employer.id,
        scoreRuns: [],
      });

      const result = await service.getOne(employer, "p1");
      expect(result.latestScoreRun).toBeNull();
    });

    it("throws NotFound when the profile is missing/soft-deleted", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue(null);
      await expect(service.getOne(owner, "missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws Forbidden (IDOR) when the caller is neither owner nor submitter", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({
        id: "p1",
        ownerUserId: owner.id,
        submittedByUserId: owner.id,
        scoreRuns: [],
      });
      await expect(service.getOne(other, "p1")).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("claim", () => {
    it("claims an unclaimed profile whose candidateEmail matches the caller", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({
        id: "p1",
        claimStatus: "UNCLAIMED",
        candidateEmail: owner.email,
      });
      prisma.candidateProfile.update.mockResolvedValue({ id: "p1", claimStatus: "CLAIMED" });

      await service.claim(owner, "p1");

      expect(prisma.candidateProfile.update).toHaveBeenCalledWith({
        where: { id: "p1" },
        data: { ownerUserId: owner.id, claimStatus: "CLAIMED" },
      });
    });

    it("throws NotFound when the profile does not exist", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue(null);
      await expect(service.claim(owner, "missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("throws Conflict when the profile is already claimed", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({
        id: "p1",
        claimStatus: "CLAIMED",
        candidateEmail: owner.email,
      });
      await expect(service.claim(owner, "p1")).rejects.toBeInstanceOf(ConflictException);
    });

    it("throws Forbidden when the candidateEmail does not match the caller", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({
        id: "p1",
        claimStatus: "UNCLAIMED",
        candidateEmail: "someone-else@example.com",
      });
      await expect(service.claim(owner, "p1")).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe("score", () => {
    beforeEach(() => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ id: "p1", ownerUserId: owner.id });
      prisma.formSubmission.create.mockResolvedValue({ id: "sub1" });
      prisma.scoreRun.create.mockResolvedValue({ id: "run1" });
    });

    it("persists a submission + immutable ScoreRun and returns the candidate view", async () => {
      const result = await service.score(owner, "p1", professionalAnswers);

      // Submission stored with mode + raw answers.
      expect(prisma.formSubmission.create).toHaveBeenCalledWith({
        data: { profileId: "p1", mode: "professional", answers: professionalAnswers },
      });

      // ScoreRun captures the full breakdown + byBlock + config version.
      const runArg = prisma.scoreRun.create.mock.calls[0][0].data;
      expect(runArg.profileId).toBe("p1");
      expect(runArg.submissionId).toBe("sub1");
      expect(runArg.configVersion).toBe("stabil-v0.1");
      expect(typeof runArg.total).toBe("number");
      expect(typeof runArg.maxTotal).toBe("number");
      expect(runArg.byBlock).toBeDefined();
      expect(Array.isArray(runArg.breakdown)).toBe(true);

      // Returned result is candidate-filtered: employer-only items suppressed.
      expect(result.audience).toBe("candidate");
      expect(result.hiddenParameterCount).toBeGreaterThan(0);
      expect(result.breakdown.every((p) => p.visibility === "all")).toBe(true);
      // The score itself still counts the suppressed factors.
      expect(result.total).toBe(runArg.total);
    });

    it("is owner-only: throws Forbidden for a non-owner", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ id: "p1", ownerUserId: owner.id });
      await expect(service.score(other, "p1", professionalAnswers)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.formSubmission.create).not.toHaveBeenCalled();
      expect(prisma.scoreRun.create).not.toHaveBeenCalled();
    });

    it("throws NotFound when the profile is missing", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue(null);
      await expect(service.score(owner, "missing", professionalAnswers)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("listScoreRuns", () => {
    it("is owner-only and returns runs newest-first with summary fields", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ id: "p1", ownerUserId: owner.id });
      prisma.scoreRun.findMany.mockResolvedValue([{ id: "r2" }, { id: "r1" }]);

      await service.listScoreRuns(owner, "p1");

      expect(prisma.scoreRun.findMany).toHaveBeenCalledWith({
        where: { profileId: "p1" },
        orderBy: { createdAt: "desc" },
        select: { id: true, total: true, tier: true, createdAt: true },
      });
    });

    it("throws Forbidden for a non-owner", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ id: "p1", ownerUserId: owner.id });
      await expect(service.listScoreRuns(other, "p1")).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
