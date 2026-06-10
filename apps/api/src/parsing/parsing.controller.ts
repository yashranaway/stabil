import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ParsingService } from "./parsing.service";

const parseResumeSchema = z.object({
  resumeText: z.string().min(20).max(50_000),
});

@Controller("api/v1/parse")
@UseGuards(JwtAuthGuard)
export class ParsingController {
  constructor(private readonly parsing: ParsingService) {}

  @Post("resume")
  parseResume(@Body() body: unknown) {
    const parsed = parseResumeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.parsing.parseResume(parsed.data.resumeText);
  }
}
