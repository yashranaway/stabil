import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  filterForAudience,
  type Mode,
  type ParameterScore,
  type ScoreResult,
  type Tier,
} from "@stabil/scoring";
import type { AuthUser } from "@stabil/types";

import { ConsentService } from "../consent/consent.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consent: ConsentService,
  ) {}

  /** Audience-aware report for a profile's latest score run. Access is consent-gated. */
  async getReport(user: AuthUser, profileId: string) {
    const access = await this.consent.hasAccess(user.id, user.email, profileId);
    if (!access.allowed) {
      throw new ForbiddenException("no access to this report");
    }

    const profile = await this.prisma.candidateProfile.findFirst({
      where: { id: profileId, deletedAt: null },
      select: { id: true, displayName: true, mode: true },
    });
    if (!profile) {
      throw new NotFoundException("profile not found");
    }

    const run = await this.prisma.scoreRun.findFirst({
      where: { profileId },
      orderBy: { createdAt: "desc" },
    });
    if (!run) {
      throw new NotFoundException("no score yet for this profile");
    }

    // Rebuild the full result from the stored snapshot, then filter for the audience.
    // The stored breakdown still contains employer-only items; filterForAudience drops
    // them for candidates while keeping total/tier identical.
    const result: ScoreResult = {
      mode: profile.mode as Mode,
      total: run.total,
      maxTotal: run.maxTotal,
      tier: run.tier as Tier,
      byBlock: run.byBlock as unknown as ScoreResult["byBlock"],
      breakdown: run.breakdown as unknown as ParameterScore[],
    };
    const view = filterForAudience(result, access.audience);

    return {
      ...view,
      profile: { id: profile.id, displayName: profile.displayName },
      generatedAt: run.createdAt,
      suggestions: this.buildSuggestions(view.breakdown),
    };
  }

  /** Simple improvement hints from the audience-visible breakdown. */
  private buildSuggestions(breakdown: readonly ParameterScore[]): string[] {
    const suggestions: string[] = [];
    const verified = breakdown.find((b) => b.key === "verifiedDocuments");
    if (verified && verified.awarded === 0) {
      suggestions.push(`Verify your documents for up to +${verified.max} points.`);
    }
    const gaps = breakdown
      .filter((b) => b.key !== "verifiedDocuments" && b.awarded < b.max)
      .sort((a, b) => b.max - b.awarded - (a.max - a.awarded))
      .slice(0, 2);
    for (const g of gaps) {
      suggestions.push(`Improve ${g.label} for up to +${g.max - g.awarded} points.`);
    }
    return suggestions;
  }
}
