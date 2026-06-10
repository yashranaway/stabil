import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { scoreRequestSchema } from "@stabil/types";

import { ScoringService } from "./scoring.service";

@Controller("api/v1")
export class ScoringController {
  constructor(private readonly scoring: ScoringService) {}

  @Post("score")
  score(@Body() body: unknown) {
    const parsed = scoreRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    // Phase 1 stateless scoring; persistence (ScoreRun) lands with the profiles module.
    return this.scoring.score(parsed.data.answers);
  }
}
