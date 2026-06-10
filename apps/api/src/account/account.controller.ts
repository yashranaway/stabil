import { Controller, Delete, Get, HttpCode, UseGuards } from "@nestjs/common";
import type { AuthUser } from "@stabil/types";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AccountService } from "./account.service";

@Controller("api/v1/account")
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get("export")
  export(@CurrentUser() user: AuthUser) {
    return this.account.exportData(user);
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser): Promise<void> {
    await this.account.deleteAccount(user);
  }
}
