import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me";

/**
 * Global so any module can `@UseGuards(JwtAuthGuard | RolesGuard)` without
 * re-importing AuthModule, and so `JwtService` is available app-wide for token
 * verification inside `JwtAuthGuard`.
 */
@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: JWT_ACCESS_SECRET,
      signOptions: { expiresIn: "15m" },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
