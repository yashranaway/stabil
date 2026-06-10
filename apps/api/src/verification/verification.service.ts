import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "@stabil/types";

import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Owner submits a document for verification (file bytes handled by storage later). */
  async submit(user: AuthUser, profileId: string, input: { kind: string; region: string }) {
    await this.assertOwner(user, profileId);
    return this.prisma.document.create({
      data: { profileId, kind: input.kind, region: input.region },
    });
  }

  async listForProfile(user: AuthUser, profileId: string) {
    await this.assertOwner(user, profileId);
    return this.prisma.document.findMany({ where: { profileId }, orderBy: { createdAt: "desc" } });
  }

  /** Admin review queue. */
  listPending() {
    return this.prisma.document.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" } });
  }

  async review(admin: AuthUser, docId: string, approve: boolean) {
    const doc = await this.prisma.document.findUnique({
      where: { id: docId },
      include: { profile: { select: { ownerUserId: true } } },
    });
    if (!doc) throw new NotFoundException("document not found");

    const updated = await this.prisma.document.update({
      where: { id: docId },
      data: {
        status: approve ? "APPROVED" : "REJECTED",
        reviewedBy: admin.id,
        reviewedAt: new Date(),
      },
    });

    if (doc.profile.ownerUserId) {
      await this.notifications.create(doc.profile.ownerUserId, "verification_result", {
        documentId: docId,
        kind: doc.kind,
        status: updated.status,
      });
    }
    return updated;
  }

  /** Count of approved documents — feeds the verification bonus at score time. */
  countApproved(profileId: string): Promise<number> {
    return this.prisma.document.count({ where: { profileId, status: "APPROVED" } });
  }

  private async assertOwner(user: AuthUser, profileId: string): Promise<void> {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id: profileId, deletedAt: null },
      select: { ownerUserId: true },
    });
    if (!profile) throw new NotFoundException("profile not found");
    if (profile.ownerUserId !== user.id) throw new ForbiddenException("not your profile");
  }
}
