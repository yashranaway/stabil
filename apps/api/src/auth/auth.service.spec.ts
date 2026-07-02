import { ConflictException, UnauthorizedException } from "@nestjs/common";
import type { JwtService } from "@nestjs/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "./auth.service";

// Mock argon2 so tests are fast and deterministic (no real KDF work).
vi.mock("argon2", () => ({
  argon2id: 2,
  hash: vi.fn(async (plain: string) => `hashed:${plain}`),
  verify: vi.fn(async (hash: string, plain: string) => hash === `hashed:${plain}`),
}));

import * as argon2 from "argon2";

function makePrismaMock() {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
}

function makeJwtMock(): Pick<JwtService, "sign"> {
  return { sign: vi.fn(() => "signed.access.token") } as unknown as JwtService;
}

describe("AuthService", () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let jwt: ReturnType<typeof makeJwtMock>;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrismaMock();
    jwt = makeJwtMock();
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
    );
  });

  describe("register", () => {
    it("hashes the password with argon2 and stores the hash (never the plaintext)", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        name: "Asha",
        role: "CANDIDATE",
        passwordHash: "hashed:super-secret",
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.register({
        email: "a@b.com",
        password: "super-secret",
        name: "Asha",
        role: "CANDIDATE",
      });

      expect(argon2.hash).toHaveBeenCalledWith("super-secret", expect.any(Object));
      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.passwordHash).toBe("hashed:super-secret");
      expect(createArg.data.passwordHash).not.toBe("super-secret");
      expect(result.user).toEqual({
        id: "u1",
        email: "a@b.com",
        name: "Asha",
        role: "CANDIDATE",
      });
      expect(result.tokens.accessToken).toBe("signed.access.token");
      expect(typeof result.tokens.refreshToken).toBe("string");
    });

    it("rejects a duplicate email with ConflictException", async () => {
      prisma.user.findUnique.mockResolvedValue({ id: "existing" });

      await expect(
        service.register({ email: "dup@b.com", password: "super-secret", role: "CANDIDATE" }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe("login", () => {
    it("rejects a bad password with UnauthorizedException", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        name: null,
        role: "CANDIDATE",
        passwordHash: "hashed:correct-password",
      });

      await expect(
        service.login({ email: "a@b.com", password: "wrong-password" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("returns user + tokens on a correct password", async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        name: null,
        role: "CANDIDATE",
        passwordHash: "hashed:correct-password",
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login({ email: "a@b.com", password: "correct-password" });

      expect(result.user.id).toBe("u1");
      expect(result.tokens.accessToken).toBe("signed.access.token");
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("loginWithGoogle", () => {
    it("fails closed with UnauthorizedException when GOOGLE_CLIENT_ID is not configured", async () => {
      // No GOOGLE_CLIENT_ID in the test env, so the service must refuse rather
      // than silently accept an unverifiable credential.
      await expect(service.loginWithGoogle("some.id.token")).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("refresh", () => {
    it("revokes the whole family when a revoked token is replayed (reuse detection)", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt1",
        userId: "u1",
        family: "fam1",
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
      });

      await expect(service.refresh({ refreshToken: "raw" })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { family: "fam1", revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it("rotates a valid token: revokes the old one and issues a new pair in the same family", async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: "rt1",
        userId: "u1",
        family: "fam1",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        email: "a@b.com",
        name: null,
        role: "CANDIDATE",
        passwordHash: "hashed:x",
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const tokens = await service.refresh({ refreshToken: "raw" });

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: "rt1" },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create.mock.calls[0][0].data.family).toBe("fam1");
      expect(tokens.accessToken).toBe("signed.access.token");
    });
  });
});
