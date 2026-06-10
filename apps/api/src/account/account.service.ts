import { Injectable } from "@nestjs/common";
import type { AuthUser } from "@stabil/types";

import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  /** Export everything tied to the user (data-subject access, SCOPE §11). */
  async exportData(user: AuthUser) {
    const profiles = await this.prisma.candidateProfile.findMany({
      where: { ownerUserId: user.id },
      include: {
        submissions: true,
        scoreRuns: { orderBy: { createdAt: "desc" } },
        shares: true,
      },
    });
    return {
      user,
      profiles,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Delete-on-request: soft-delete the user and their profiles, revoke all shares,
   * and delete refresh tokens so sessions can't be renewed. Runs in one transaction.
   */
  async deleteAccount(user: AuthUser): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.shareGrant.updateMany({
        where: { profile: { ownerUserId: user.id }, status: "ACTIVE" },
        data: { status: "REVOKED", revokedAt: now },
      }),
      this.prisma.candidateProfile.updateMany({
        where: { ownerUserId: user.id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.user.update({ where: { id: user.id }, data: { deletedAt: now } }),
    ]);
  }
}
