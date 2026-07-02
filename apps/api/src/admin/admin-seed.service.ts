import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

import { hashPassword } from "../auth/password.util";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Ensures an admin account exists on boot when ADMIN_EMAIL + ADMIN_PASSWORD
 * are set, so "log in as admin" never requires manual SQL. Idempotent:
 * creates the user on first boot, and on later boots only promotes the role
 * to ADMIN if it drifted — it never overwrites an existing password.
 */
@Injectable()
export class AdminSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger("AdminSeedService");

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (!existing) {
      const passwordHash = await hashPassword(password);
      await this.prisma.user.create({
        data: { email, name: "Admin", role: "ADMIN", passwordHash },
      });
      this.logger.log(`Bootstrapped admin account: ${email}`);
      return;
    }

    if (existing.role !== "ADMIN") {
      await this.prisma.user.update({ where: { id: existing.id }, data: { role: "ADMIN" } });
      this.logger.log(`Promoted existing account to admin: ${email}`);
    }
  }
}
