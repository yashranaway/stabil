import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { createShareSchema } from "@stabil/types";
import type { AuthUser } from "@stabil/types";
import { z } from "zod";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ConsentService } from "./consent.service";

/** POST body: the shared createShareSchema plus the profile being shared. */
const createShareBodySchema = createShareSchema.extend({
  profileId: z.string().uuid(),
});

@Controller("api/v1/shares")
@UseGuards(JwtAuthGuard)
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = createShareBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.consent.createShare(user, {
      profileId: parsed.data.profileId,
      granteeEmail: parsed.data.granteeEmail,
      expiresInDays: parsed.data.expiresInDays,
    });
  }

  @Get("mine")
  mine(@CurrentUser() user: AuthUser) {
    return this.consent.listMine(user);
  }

  @Get("granted-to-me")
  grantedToMe(@CurrentUser() user: AuthUser) {
    return this.consent.listGrantedToMe(user);
  }

  @Delete(":id")
  @HttpCode(204)
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string): Promise<void> {
    return this.consent.revoke(user, id);
  }
}
