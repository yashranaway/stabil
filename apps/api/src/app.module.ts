import { Module } from "@nestjs/common";

import { HealthController } from "./health/health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { ScoringModule } from "./scoring/scoring.module";
import { UsersModule } from "./users/users.module";

@Module({
  imports: [PrismaModule, UsersModule, ScoringModule],
  controllers: [HealthController],
})
export class AppModule {}
