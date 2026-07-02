import { Module } from "@nestjs/common";

import { ProfilesModule } from "../profiles/profiles.module";
import { UsersModule } from "../users/users.module";
import { AdminController } from "./admin.controller";
import { AdminSeedService } from "./admin-seed.service";

@Module({
  imports: [ProfilesModule, UsersModule],
  controllers: [AdminController],
  providers: [AdminSeedService],
})
export class AdminModule {}
