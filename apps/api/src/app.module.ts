import { Module } from "@nestjs/common";

import { AuthModule } from "./auth/auth.module";
import { ConsentModule } from "./consent/consent.module";
import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { ReportsModule } from "./reports/reports.module";
import { ScoringModule } from "./scoring/scoring.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    ScoringModule,
    ProfilesModule,
    ConsentModule,
    ReportsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
