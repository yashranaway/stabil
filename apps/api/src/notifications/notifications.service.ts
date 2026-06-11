import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { MailService } from "./mail.service";

/** Human-readable email copy per notification kind. */
function emailFor(kind: string, payload: Record<string, unknown>): { subject: string; text: string } {
  if (kind === "verification_result") {
    const status = String(payload.status ?? "").toLowerCase();
    const docKind = String(payload.kind ?? "document");
    return {
      subject: `Your ${docKind} document was ${status}`,
      text: `Update on your Stabil verification: your ${docKind} document was ${status}.`,
    };
  }
  return { subject: "Stabil notification", text: `You have a new Stabil notification: ${kind}.` };
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(userId: string, kind: string, payload: Record<string, unknown>) {
    const notification = await this.prisma.notification.create({
      data: { userId, kind, payload: payload as unknown as Prisma.InputJsonValue },
    });

    // Also email the user (best-effort; failures are logged, never thrown).
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user?.email) {
      const { subject, text } = emailFor(kind, payload);
      await this.mail.send(user.email, subject, text);
    }

    return notification;
  }

  listForUser(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
