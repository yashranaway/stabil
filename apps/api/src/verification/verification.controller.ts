import { BadRequestException, Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { AuthUser } from "@stabil/types";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { VerificationService } from "./verification.service";

const submitSchema = z.object({
  kind: z.enum(["aadhaar", "pan", "passport", "national_id"]),
  region: z.enum(["IN", "INTL"]),
});

@Controller("api/v1")
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post("profiles/:id/documents")
  @UseGuards(JwtAuthGuard)
  submit(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const parsed = submitSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.verification.submit(user, id, parsed.data);
  }

  @Get("profiles/:id/documents")
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.verification.listForProfile(user, id);
  }

  @Get("admin/verifications")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  pending() {
    return this.verification.listPending();
  }

  @Post("admin/verifications/:docId/approve")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  approve(@CurrentUser() admin: AuthUser, @Param("docId") docId: string) {
    return this.verification.review(admin, docId, true);
  }

  @Post("admin/verifications/:docId/reject")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("ADMIN")
  reject(@CurrentUser() admin: AuthUser, @Param("docId") docId: string) {
    return this.verification.review(admin, docId, false);
  }
}
