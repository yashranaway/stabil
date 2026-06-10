import { ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "@stabil/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../prisma/prisma.service";
import { ConsentService } from "./consent.service";

type PrismaMock = {
  candidateProfile: { findFirst: ReturnType<typeof vi.fn> };
  shareGrant: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

function makePrisma(): PrismaMock {
  return {
    candidateProfile: { findFirst: vi.fn() },
    shareGrant: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
  };
}

const owner: AuthUser = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "owner@example.com",
  name: "Owner",
  role: "CANDIDATE",
};
const employer: AuthUser = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "Boss@Acme.com",
  name: "Boss",
  role: "EMPLOYER",
};
const PROFILE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("ConsentService", () => {
  let prisma: PrismaMock;
  let service: ConsentService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new ConsentService(prisma as unknown as PrismaService);
  });

  describe("createShare", () => {
    it("creates an ACTIVE grant with a lowercased email and a future expiry for the owner", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ id: PROFILE_ID, ownerUserId: owner.id });
      prisma.shareGrant.create.mockImplementation(({ data }) => Promise.resolve({ id: "g1", ...data }));

      const before = Date.now();
      const grant = await service.createShare(owner, {
        profileId: PROFILE_ID,
        granteeEmail: "Boss@Acme.com",
        expiresInDays: 30,
      });

      expect(grant.granteeEmail).toBe("boss@acme.com");
      expect(grant.status).toBe("ACTIVE");
      const expiry = (grant.expiresAt as Date).getTime();
      expect(expiry).toBeGreaterThan(before + 29 * 24 * 60 * 60 * 1000);
      expect(expiry).toBeLessThan(before + 31 * 24 * 60 * 60 * 1000);
    });

    it("rejects a non-owner with ForbiddenException", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ id: PROFILE_ID, ownerUserId: owner.id });
      await expect(
        service.createShare(employer, { profileId: PROFILE_ID, granteeEmail: "x@y.com", expiresInDays: 30 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.shareGrant.create).not.toHaveBeenCalled();
    });

    it("404s when the profile does not exist", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue(null);
      await expect(
        service.createShare(owner, { profileId: PROFILE_ID, granteeEmail: "x@y.com", expiresInDays: 30 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("revoke", () => {
    it("sets status REVOKED and revokedAt for the owner", async () => {
      prisma.shareGrant.findUnique.mockResolvedValue({
        id: "g1",
        profile: { ownerUserId: owner.id },
      });
      prisma.shareGrant.update.mockResolvedValue({});

      await service.revoke(owner, "g1");

      expect(prisma.shareGrant.update).toHaveBeenCalledWith({
        where: { id: "g1" },
        data: expect.objectContaining({ status: "REVOKED", revokedAt: expect.any(Date) }),
      });
    });

    it("rejects revoke by a non-owner", async () => {
      prisma.shareGrant.findUnique.mockResolvedValue({
        id: "g1",
        profile: { ownerUserId: owner.id },
      });
      await expect(service.revoke(employer, "g1")).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.shareGrant.update).not.toHaveBeenCalled();
    });

    it("404s for an unknown grant", async () => {
      prisma.shareGrant.findUnique.mockResolvedValue(null);
      await expect(service.revoke(owner, "missing")).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("listGrantedToMe", () => {
    it("scopes to ACTIVE, unexpired grants addressed to the (lowercased) user email", async () => {
      prisma.shareGrant.findMany.mockResolvedValue([]);
      await service.listGrantedToMe(employer);

      const where = prisma.shareGrant.findMany.mock.calls[0][0].where;
      expect(where.granteeEmail).toBe("boss@acme.com");
      expect(where.status).toBe("ACTIVE");
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
    });
  });

  describe("hasAccess", () => {
    it("returns candidate audience for the profile owner", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ ownerUserId: owner.id });
      const decision = await service.hasAccess(owner.id, owner.email, PROFILE_ID);
      expect(decision).toEqual({ allowed: true, audience: "candidate" });
      expect(prisma.shareGrant.findFirst).not.toHaveBeenCalled();
    });

    it("denies when no profile exists", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue(null);
      const decision = await service.hasAccess(employer.id, employer.email, PROFILE_ID);
      expect(decision.allowed).toBe(false);
    });

    it("grants employer audience to an EMPLOYER with a live grant", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ ownerUserId: owner.id });
      prisma.shareGrant.findFirst.mockResolvedValue({ id: "g1" });
      prisma.user.findUnique.mockResolvedValue({ role: "EMPLOYER" });

      const decision = await service.hasAccess(employer.id, employer.email, PROFILE_ID);
      expect(decision).toEqual({ allowed: true, audience: "employer" });
      const where = prisma.shareGrant.findFirst.mock.calls[0][0].where;
      expect(where.granteeEmail).toBe("boss@acme.com");
      expect(where.status).toBe("ACTIVE");
      expect(where.expiresAt.gt).toBeInstanceOf(Date);
    });

    it("grants recruiter audience to a RECRUITER with a live grant", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ ownerUserId: owner.id });
      prisma.shareGrant.findFirst.mockResolvedValue({ id: "g1" });
      prisma.user.findUnique.mockResolvedValue({ role: "RECRUITER" });

      const decision = await service.hasAccess("33333333-3333-3333-3333-333333333333", "rec@firm.com", PROFILE_ID);
      expect(decision).toEqual({ allowed: true, audience: "recruiter" });
    });

    it("denies a non-owner without a live grant", async () => {
      prisma.candidateProfile.findFirst.mockResolvedValue({ ownerUserId: owner.id });
      prisma.shareGrant.findFirst.mockResolvedValue(null);

      const decision = await service.hasAccess(employer.id, employer.email, PROFILE_ID);
      expect(decision.allowed).toBe(false);
    });
  });
});
