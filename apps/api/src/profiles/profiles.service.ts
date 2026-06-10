import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { toFractions } from "@stabil/core";
import { computeScore, filterForAudience, stabilConfig } from "@stabil/scoring";
import type {
  AuthUser,
  CreateProfileDto,
  RawAnswers,
  SubmitCandidateDto,
} from "@stabil/types";

import { PrismaService } from "../prisma/prisma.service";
import { VerificationService } from "../verification/verification.service";

const CONFIG_VERSION = "stabil-v0.1";

/** Latest ScoreRun summary surfaced alongside a profile. */
type ScoreRunSummary = { total: number; tier: string } | null;

@Injectable()
export class ProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: VerificationService,
  ) {}

  /** Candidate self-creates a profile they own (claimed immediately). */
  async createProfile(user: AuthUser, dto: CreateProfileDto) {
    return this.prisma.candidateProfile.create({
      data: {
        displayName: dto.displayName,
        mode: dto.mode,
        ownerUserId: user.id,
        submittedByUserId: user.id,
        claimStatus: "CLAIMED",
      },
    });
  }

  /** Employer/recruiter submits an unclaimed profile on a candidate's behalf. */
  async submitCandidate(user: AuthUser, dto: SubmitCandidateDto) {
    return this.prisma.candidateProfile.create({
      data: {
        displayName: dto.displayName,
        mode: dto.mode,
        candidateEmail: dto.candidateEmail,
        submittedByUserId: user.id,
        claimStatus: "UNCLAIMED",
      },
    });
  }

  /** List the caller's owned profiles (newest first) with their latest score summary. */
  async listMine(user: AuthUser) {
    const profiles = await this.prisma.candidateProfile.findMany({
      where: { ownerUserId: user.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        scoreRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    return profiles.map(({ scoreRuns, ...profile }) => ({
      ...profile,
      latestScoreRun: this.toSummary(scoreRuns[0]),
    }));
  }

  /**
   * Return a profile the caller is entitled to (owner or submitter) plus its
   * latest ScoreRun. 404 when missing/soft-deleted, 403 when the caller is
   * neither owner nor submitter.
   */
  async getOne(user: AuthUser, id: string) {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id, deletedAt: null },
      include: {
        scoreRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (!profile) {
      throw new NotFoundException("Profile not found");
    }
    if (profile.ownerUserId !== user.id && profile.submittedByUserId !== user.id) {
      throw new ForbiddenException("You do not have access to this profile");
    }

    const { scoreRuns, ...rest } = profile;
    return { ...rest, latestScoreRun: scoreRuns[0] ?? null };
  }

  /**
   * Owner claims an unclaimed profile that was submitted to their email.
   * 404 when missing, 409 when already claimed, 403 when the email mismatches.
   */
  async claim(user: AuthUser, id: string) {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id, deletedAt: null },
    });

    if (!profile) {
      throw new NotFoundException("Profile not found");
    }
    if (profile.claimStatus !== "UNCLAIMED") {
      throw new ConflictException("Profile is already claimed");
    }
    if (profile.candidateEmail !== user.email) {
      throw new ForbiddenException("This profile was not submitted to your email");
    }

    return this.prisma.candidateProfile.update({
      where: { id: profile.id },
      data: { ownerUserId: user.id, claimStatus: "CLAIMED" },
    });
  }

  /**
   * Owner-only: persist a submission, compute the full score, persist an
   * immutable ScoreRun, and return the candidate-filtered result.
   */
  async score(user: AuthUser, id: string, answers: RawAnswers) {
    await this.assertOwner(user, id);

    const submission = await this.prisma.formSubmission.create({
      data: { profileId: id, mode: answers.mode, answers },
    });

    // Verified documents (admin-approved) override the self-reported count so that
    // verification actually moves the score (Phase 3 bonus).
    const approvedDocs = await this.verification.countApproved(id);
    const effectiveAnswers = { ...answers, verifiedDocumentsCount: approvedDocs };

    const result = computeScore(
      { mode: effectiveAnswers.mode, values: toFractions(effectiveAnswers) },
      stabilConfig,
    );

    await this.prisma.scoreRun.create({
      data: {
        profileId: id,
        submissionId: submission.id,
        total: result.total,
        maxTotal: result.maxTotal,
        tier: result.tier,
        byBlock: result.byBlock as unknown as Prisma.InputJsonValue,
        breakdown: result.breakdown as unknown as Prisma.InputJsonValue,
        configVersion: CONFIG_VERSION,
      },
    });

    return filterForAudience(result, "candidate");
  }

  /** Owner-only: re-scoring history, newest first. */
  async listScoreRuns(user: AuthUser, id: string) {
    await this.assertOwner(user, id);

    return this.prisma.scoreRun.findMany({
      where: { profileId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, total: true, tier: true, createdAt: true },
    });
  }

  /** Resolve a profile and ensure the caller owns it (404 missing, 403 otherwise). */
  private async assertOwner(user: AuthUser, id: string) {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, ownerUserId: true },
    });

    if (!profile) {
      throw new NotFoundException("Profile not found");
    }
    if (profile.ownerUserId !== user.id) {
      throw new ForbiddenException("You do not own this profile");
    }
    return profile;
  }

  private toSummary(run: { total: number; tier: string } | undefined): ScoreRunSummary {
    return run ? { total: run.total, tier: run.tier } : null;
  }
}
