import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Audience, AuthUser } from "@stabil/types";

import { PrismaService } from "../prisma/prisma.service";

/** Result of an access check: whether the principal may read a profile, and as which audience. */
export interface AccessDecision {
  allowed: boolean;
  audience: Audience;
}

interface CreateShareInput {
  profileId: string;
  granteeEmail: string;
  expiresInDays: number;
}

/**
 * Owns the ShareGrant lifecycle and is the single access-enforcement point for
 * report reads (SCOPE §6.2; docs/architecture/05-security-privacy.md §3). A profile
 * owner sees the candidate audience; a grantee sees an audience derived from their role.
 */
@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Owner of `profileId` grants `granteeEmail` access for `expiresInDays` days. */
  async createShare(user: AuthUser, input: CreateShareInput) {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id: input.profileId, deletedAt: null },
    });
    if (!profile) {
      throw new NotFoundException("profile not found");
    }
    if (profile.ownerUserId !== user.id && user.role !== "ADMIN") {
      throw new ForbiddenException("only the profile owner may grant access");
    }

    const expiresAt = new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);
    return this.prisma.shareGrant.create({
      data: {
        profileId: input.profileId,
        granteeEmail: input.granteeEmail.toLowerCase(),
        status: "ACTIVE",
        expiresAt,
      },
    });
  }

  /** Shares the user granted, across every profile they own. */
  listMine(user: AuthUser) {
    return this.prisma.shareGrant.findMany({
      where: { profile: { ownerUserId: user.id } },
      orderBy: { createdAt: "desc" },
    });
  }

  /** ACTIVE, unexpired shares addressed to the user (the candidates they may view). */
  listGrantedToMe(user: AuthUser) {
    return this.prisma.shareGrant.findMany({
      where: {
        granteeEmail: user.email.toLowerCase(),
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Owner revokes a grant they issued → status REVOKED, revokedAt = now. */
  async revoke(user: AuthUser, grantId: string): Promise<void> {
    const grant = await this.prisma.shareGrant.findUnique({
      where: { id: grantId },
      include: { profile: { select: { ownerUserId: true } } },
    });
    if (!grant) {
      throw new NotFoundException("share not found");
    }
    if (grant.profile.ownerUserId !== user.id && user.role !== "ADMIN") {
      throw new ForbiddenException("only the profile owner may revoke this share");
    }
    await this.prisma.shareGrant.update({
      where: { id: grantId },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  }

  /**
   * Reusable access check for report reads. Allowed when the user owns the profile
   * (audience "candidate"), holds an ACTIVE, unexpired ShareGrant addressed to them
   * (audience derived from role: EMPLOYER→"employer", RECRUITER→"recruiter", else
   * "employer"), or is an ADMIN — who bypasses ownership/consent entirely and always
   * sees the fullest ("employer") view.
   */
  async hasAccess(userId: string, userEmail: string, profileId: string): Promise<AccessDecision> {
    const requester = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (requester?.role === "ADMIN") {
      return { allowed: true, audience: "employer" };
    }

    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id: profileId, deletedAt: null },
      select: { ownerUserId: true },
    });
    if (!profile) {
      return { allowed: false, audience: "candidate" };
    }
    if (profile.ownerUserId === userId) {
      return { allowed: true, audience: "candidate" };
    }

    const grant = await this.prisma.shareGrant.findFirst({
      where: {
        profileId,
        granteeEmail: userEmail.toLowerCase(),
        status: "ACTIVE",
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!grant) {
      return { allowed: false, audience: "candidate" };
    }

    const audience: Audience = requester?.role === "RECRUITER" ? "recruiter" : "employer";
    return { allowed: true, audience };
  }
}
