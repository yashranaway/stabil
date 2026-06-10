import type { Tier } from "@stabil/scoring";

/** Human-friendly label per tier. */
export const tierLabel: Record<Tier, string> = {
  unstable: "Unstable",
  developing: "Developing",
  "somewhat-stable": "Somewhat Stable",
  settled: "Settled",
  stable: "Stable",
};

/** Tier → accent color (also drives the gauge arc). */
export const tierColor: Record<Tier, string> = {
  unstable: "#f87171",
  developing: "#fb923c",
  "somewhat-stable": "#facc15",
  settled: "#38bdf8",
  stable: "#34d399",
};

/** One-line, encouraging blurb per tier. */
export const tierBlurb: Record<Tier, string> = {
  unstable: "Lots of room to grow — small wins move this fast.",
  developing: "A solid start. A few focused improvements lift you a tier.",
  "somewhat-stable": "Good footing. Tighten the weaker areas to settle in.",
  settled: "Strong and steady. You're close to the top tier.",
  stable: "Excellent — among the most stable profiles.",
};
