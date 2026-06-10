import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthUser, Role } from "@stabil/types";

import { ROLES_KEY } from "./roles.decorator";

/**
 * Reads `@Roles(...)` metadata and allows the request only when the
 * authenticated principal's role is among the required set. Must run after
 * `JwtAuthGuard` so that `request.user` is populated. A route with no
 * `@Roles(...)` metadata is unrestricted.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException("Insufficient role.");
    }
    return true;
  }
}
