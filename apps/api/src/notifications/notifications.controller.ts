import { Controller, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import type { AuthUser } from "@stabil/types";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationsService } from "./notifications.service";

@Controller("api/v1/notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.notifications.listForUser(user.id);
  }

  @Post(":id/read")
  @HttpCode(204)
  async read(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<void> {
    await this.notifications.markRead(user.id, id);
  }
}
