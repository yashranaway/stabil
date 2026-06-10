import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthUser } from "@stabil/types";

/**
 * Inject the authenticated principal (set on `request.user` by `JwtAuthGuard`).
 * Usage: `me(@CurrentUser() user: AuthUser) { ... }`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return request.user;
  },
);
