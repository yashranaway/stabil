/**
 * Stability tiers and the mapping from a total score (0–1500) to a tier.
 * Bands per SCOPE.md §7; the ~1000 and ~1500 anchors come from the briefing.
 */

export type Tier =
  | "unstable"
  | "developing"
  | "somewhat-stable"
  | "settled"
  | "stable";

interface TierBand {
  readonly tier: Tier;
  /** Inclusive lower bound of the band. */
  readonly min: number;
}

/** Highest band first, so the first satisfied bound wins. */
const TIER_BANDS: readonly TierBand[] = [
  { tier: "stable", min: 1350 },
  { tier: "settled", min: 1100 },
  { tier: "somewhat-stable", min: 800 },
  { tier: "developing", min: 500 },
  { tier: "unstable", min: 0 },
];

/** Map a total score to its stability tier. Out-of-range totals clamp to the nearest tier. */
export function mapTier(total: number): Tier {
  return TIER_BANDS.find((band) => total >= band.min)?.tier ?? "unstable";
}
