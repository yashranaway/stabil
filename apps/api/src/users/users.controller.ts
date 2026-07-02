import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { UsersService } from "./users.service";

// Phase-0 scaffold endpoint, now admin-gated. Real signup is /api/v1/auth/register.
@Controller("api/v1/users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() body: { email?: string; name?: string }) {
    return this.users.create(body);
  }
}
