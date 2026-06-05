import { Controller, Get } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("health")
  async health(): Promise<{ status: string; service: string; db: "up" | "down" }> {
    let db: "up" | "down" = "down";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = "up";
    } catch {
      db = "down";
    }
    return { status: "ok", service: "stabil-api", db };
  }
}
