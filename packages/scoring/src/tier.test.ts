import { describe, expect, it } from "vitest";

import { mapTier } from "./tier";

describe("mapTier", () => {
  it("returns 'unstable' below 500", () => {
    expect(mapTier(0)).toBe("unstable");
    expect(mapTier(499)).toBe("unstable");
  });

  it("returns 'developing' from 500 to 799", () => {
    expect(mapTier(500)).toBe("developing");
    expect(mapTier(799)).toBe("developing");
  });

  it("returns 'somewhat-stable' from 800 to 1099 (the ~1000 briefing anchor)", () => {
    expect(mapTier(800)).toBe("somewhat-stable");
    expect(mapTier(1000)).toBe("somewhat-stable");
    expect(mapTier(1099)).toBe("somewhat-stable");
  });

  it("returns 'settled' from 1100 to 1349", () => {
    expect(mapTier(1100)).toBe("settled");
    expect(mapTier(1349)).toBe("settled");
  });

  it("returns 'stable' from 1350 up (the ~1500 briefing anchor)", () => {
    expect(mapTier(1350)).toBe("stable");
    expect(mapTier(1500)).toBe("stable");
  });

  it("clamps out-of-range totals to the nearest tier", () => {
    expect(mapTier(-50)).toBe("unstable");
    expect(mapTier(99999)).toBe("stable");
  });
});
