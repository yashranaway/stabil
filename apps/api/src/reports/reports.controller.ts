import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import type { AuthUser } from "@stabil/types";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ReportsService } from "./reports.service";

@Controller("api/v1/profiles/:profileId/report")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser, @Param("profileId") profileId: string) {
    return this.reports.getReport(user, profileId);
  }

  @Get("pdf")
  pdf(@CurrentUser() user: AuthUser, @Param("profileId") profileId: string) {
    return this.reports.getReportPdf(user, profileId);
  }
}
