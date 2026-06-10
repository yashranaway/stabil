import { Module } from "@nestjs/common";

import { ConsentModule } from "../consent/consent.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [ConsentModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
