import { Module } from "@nestjs/common";

import { ConsentModule } from "../consent/consent.module";
import { PdfService } from "./pdf.service";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [ConsentModule],
  controllers: [ReportsController],
  providers: [ReportsService, PdfService],
})
export class ReportsModule {}
