import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { AuthUser, Role } from "@stabil/types";

interface AccessClaims {
  sub: string;
  email: string;
  role: Role;
}

/**
 * Verifies the `Authorization: Bearer <jwt>` access token and attaches the
 * decoded principal to `request.user` as an `AuthUser`. Throws
 * `UnauthorizedException` if the header is missing, malformed, or the token
 * fails verification.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; user?: AuthUser }>();

    const header = request.headers["authorization"] ?? request.headers["Authorization"];
    if (!header || !header.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing or malformed Authorization header.");
    }

    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      throw new UnauthorizedException("Missing bearer token.");
    }

    let claims: AccessClaims;
    try {
      claims = this.jwt.verify<AccessClaims>(token);
    } catch {
      throw new UnauthorizedException("Invalid or expired access token.");
    }

    request.user = {
      id: claims.sub,
      email: claims.email,
      role: claims.role,
      name: null,
    };
    return true;
  }
}
