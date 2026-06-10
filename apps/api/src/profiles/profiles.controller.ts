import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  type AuthUser,
  createProfileSchema,
  scoreRequestSchema,
  submitCandidateSchema,
} from "@stabil/types";

import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { ProfilesService } from "./profiles.service";

@Controller("api/v1/profiles")
@UseGuards(JwtAuthGuard)
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  /** Candidate self-creates a profile they own. */
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = createProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.profiles.createProfile(user, parsed.data);
  }

  /** List the caller's owned profiles with their latest score summary. */
  @Get("mine")
  listMine(@CurrentUser() user: AuthUser) {
    return this.profiles.listMine(user);
  }

  /** Employer/recruiter submits an unclaimed profile on a candidate's behalf. */
  @Post("submit-candidate")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("EMPLOYER", "RECRUITER")
  submitCandidate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = submitCandidateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.profiles.submitCandidate(user, parsed.data);
  }

  /** Return a profile (owner or submitter) plus its latest ScoreRun. */
  @Get(":id")
  getOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.profiles.getOne(user, id);
  }

  /** Claim an unclaimed profile submitted to the caller's email. */
  @Post(":id/claim")
  claim(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.profiles.claim(user, id);
  }

  /** Owner-only: persist a submission + ScoreRun, return the candidate view. */
  @Post(":id/score")
  score(@CurrentUser() user: AuthUser, @Param("id") id: string, @Body() body: unknown) {
    const parsed = scoreRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.profiles.score(user, id, parsed.data.answers);
  }

  /** Owner-only: re-scoring history, newest first. */
  @Get(":id/score-runs")
  listScoreRuns(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.profiles.listScoreRuns(user, id);
  }
}
