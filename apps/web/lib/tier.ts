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
  unstable: "#f0506e",
  developing: "#ff8c42",
  "somewhat-stable": "#ffce4f",
  settled: "#4fd1c5",
  stable: "#b8f34a",
};

/** One-line, encouraging blurb per tier. */
export const tierBlurb: Record<Tier, string> = {
  unstable: "Lots of room to grow — small wins move this fast.",
  developing: "A solid start. A few focused improvements lift you a tier.",
  "somewhat-stable": "Good footing. Tighten the weaker areas to settle in.",
  settled: "Strong and steady. You're close to the top tier.",
  stable: "Excellent — among the most stable profiles.",
};
