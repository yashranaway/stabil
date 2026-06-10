import type { Tier } from "@stabil/scoring";

import { tierColor, tierLabel } from "../../lib/tier";

export function TierBadge({ tier }: { tier: Tier }) {
  const color = tierColor[tier];
  return (
    <span
      className="tier-badge"
      style={{ color, borderColor: color, background: `${color}1a` }}
    >
      <span className="tier-badge-dot" style={{ background: color }} />
      {tierLabel[tier]}
    </span>
  );
}
