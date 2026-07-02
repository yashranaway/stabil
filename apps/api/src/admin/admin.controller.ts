import { Controller, Get, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ProfilesService } from "../profiles/profiles.service";
import { UsersService } from "../users/users.service";

/**
 * Admin-only "see everything" surface: every profile and every user, with no
 * ownership filtering. Combined with the ADMIN bypass in ConsentService /
 * ProfilesService / VerificationService, an admin can also open any profile's
 * existing pages (report, re-score, documents, share) directly.
 */
@Controller("api/v1/admin")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMIN")
export class AdminController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
  ) {}

  @Get("profiles")
  listProfiles() {
    return this.profiles.listAll();
  }

  @Get("users")
  listUsers() {
    return this.users.list();
  }
}
