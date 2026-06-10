import { SetMetadata } from "@nestjs/common";
import type { Role } from "@stabil/types";

/** Metadata key under which required roles are stored. */
export const ROLES_KEY = "roles";

/**
 * Restrict a route (or controller) to one or more roles.
 * Usage: `@Roles("ADMIN", "RECRUITER")`. Enforced by `RolesGuard`.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
