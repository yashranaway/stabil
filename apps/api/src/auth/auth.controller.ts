import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { googleAuthSchema, loginSchema, refreshSchema, registerSchema } from "@stabil/types";
import type { AuthUser } from "@stabil/types";

import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { JwtAuthGuard } from "./jwt-auth.guard";

@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: unknown) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.auth.register(parsed.data);
  }

  @Post("login")
  @HttpCode(200)
  login(@Body() body: unknown) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.auth.login(parsed.data);
  }

  @Post("google")
  @HttpCode(200)
  google(@Body() body: unknown) {
    const parsed = googleAuthSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.auth.loginWithGoogle(parsed.data.idToken);
  }

  @Post("refresh")
  @HttpCode(200)
  refresh(@Body() body: unknown) {
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.auth.refresh(parsed.data);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(@Body() body: unknown): Promise<void> {
    const parsed = refreshSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    await this.auth.logout(parsed.data.refreshToken);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
