import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type {
  AuthUser,
  LoginDto,
  RefreshDto,
  RegisterDto,
  TokenPair,
} from "@stabil/types";
import * as argon2 from "argon2";
import { OAuth2Client } from "google-auth-library";

import { PrismaService } from "../prisma/prisma.service";

/** argon2id parameters (see docs/architecture/05-security-privacy.md §7.1). */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};

/** Refresh tokens live 30 days; access tokens 15 minutes (signOptions). */
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: AuthUser["role"];
  passwordHash: string | null;
  deletedAt?: Date | null;
}

@Injectable()
export class AuthService {
  private readonly googleClient = process.env.GOOGLE_CLIENT_ID
    ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
    : null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ---- Public flows ----

  async register(dto: RegisterDto): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException("Email already registered.");
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const created = (await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name ?? null,
        role: dto.role,
        passwordHash,
      },
    })) as UserRecord;

    const user = this.toAuthUser(created);
    const tokens = await this.issueTokens(user, randomUUID());
    return { user, tokens };
  }

  async login(dto: LoginDto): Promise<{ user: AuthUser; tokens: TokenPair }> {
    const record = (await this.prisma.user.findUnique({
      where: { email: dto.email },
    })) as UserRecord | null;

    // Generic error for unknown email, wrong password, or deleted account (no enumeration).
    if (!record || !record.passwordHash || record.deletedAt) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const valid = await argon2.verify(record.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const user = this.toAuthUser(record);
    const tokens = await this.issueTokens(user, randomUUID());
    return { user, tokens };
  }

  /**
   * Verify a Google ID token (from Google Identity Services on the frontend),
   * then find-or-create the user by email and issue our own token pair.
   * Google-provisioned accounts have no passwordHash, so password login stays
   * blocked for them (they always sign in via Google).
   */
  async loginWithGoogle(idToken: string): Promise<{ user: AuthUser; tokens: TokenPair }> {
    if (!this.googleClient) {
      throw new UnauthorizedException("Google sign-in is not configured.");
    }

    let email: string | undefined;
    let name: string | null = null;
    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.email || !payload.email_verified) {
        throw new Error("unverified email");
      }
      email = payload.email;
      name = payload.name ?? null;
    } catch {
      throw new UnauthorizedException("Invalid Google credential.");
    }

    let record = (await this.prisma.user.findUnique({ where: { email } })) as UserRecord | null;
    if (!record) {
      record = (await this.prisma.user.create({
        data: { email, name, role: "CANDIDATE" },
      })) as UserRecord;
    } else if (record.deletedAt) {
      throw new UnauthorizedException("Invalid credentials.");
    }

    const user = this.toAuthUser(record);
    const tokens = await this.issueTokens(user, randomUUID());
    return { user, tokens };
  }

  async refresh(dto: RefreshDto): Promise<TokenPair> {
    const tokenHash = this.hashRefreshToken(dto.refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException("Invalid refresh token.");
    }

    // Reuse detection: a token already revoked is being replayed → kill the family.
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { family: stored.family, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException("Refresh token reuse detected.");
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("Refresh token expired.");
    }

    // Rotate: revoke the presented token, issue a new pair in the same family.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const record = (await this.prisma.user.findUnique({
      where: { id: stored.userId },
    })) as UserRecord | null;
    if (!record || record.deletedAt) {
      throw new UnauthorizedException("Invalid refresh token.");
    }

    return this.issueTokens(this.toAuthUser(record), stored.family);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = this.hashRefreshToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ---- Helpers ----

  /** Sign an access JWT and mint+persist a rotating refresh token. */
  async issueTokens(user: AuthUser, family: string): Promise<TokenPair> {
    const accessToken = this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    });

    const refreshToken = randomBytes(32).toString("hex");
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashRefreshToken(refreshToken),
        family,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });

    return { accessToken, refreshToken };
  }

  /** SHA-256 of the raw refresh token — only the hash is ever persisted. */
  private hashRefreshToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
  }

  private toAuthUser(record: UserRecord): AuthUser {
    return {
      id: record.id,
      email: record.email,
      name: record.name,
      role: record.role,
    };
  }
}
