# Charts

> **Status:** Draft v0.1 · **Phase:** cross-cutting (first used in Phase 1, extended in Phase 4) · **Owner area:** frontend
> **Related:** [design-system.md](./design-system.md), [README.md](./README.md), [pages/candidate-report.md](./pages/candidate-report.md), [pages/employer-recruiter.md](./pages/employer-recruiter.md), [mobile.md](./mobile.md), [../backend/modules/reports-pdf.md](../backend/modules/reports-pdf.md), [../architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md)

This is the authoritative guide for **data visualization in Stabil**. The web app renders every chart with **Chart.js v4** through **react-chartjs-2 v5**; the mobile app (Expo/React Native) cannot run Chart.js without a WebView, so it uses **victory-native** / **react-native-gifted-charts** (§Mobile). Every chart in this doc is fed directly from the `@stabil/scoring` engine output (`ScoreResult` / `AudienceScoreResult` / `ParameterScore` / `BlockTotals` / `Tier`, see [domain.ts](../../packages/scoring/src/domain.ts)). Reports are **audience-filtered before they reach the chart** — the API returns an `AudienceScoreResult` whose `breakdown` has already dropped `employer-only` parameters for candidates (SCOPE §6.3), so chart components never re-implement visibility rules.

---

## Why Chart.js + react-chartjs-2

- **Canvas-based** — one `<canvas>` per chart renders the whole report cheaply, even with many parameters, where an SVG/DOM library would emit hundreds of nodes.
- **Tree-shakeable** in v4 — we register only the controllers/elements/plugins we use (§Tree-shaking), keeping the report bundle small.
- **`toBase64Image()`** lets us rasterize any chart to a PNG for the PDF export pipeline (§PDF export → [reports-pdf.md](../backend/modules/reports-pdf.md)).
- **react-chartjs-2** is a thin typed React wrapper (`<Doughnut>`, `<Bar>`, `<Line>`, `<Radar>`, `<PolarArea>`), so we keep the React component model while Chart.js owns the canvas.

> **Versions matter.** Chart.js **v4** and react-chartjs-2 **v5** are the supported pair. react-chartjs-2 v5 dropped the auto-registration that v2 had — **you must register elements yourself**, which is exactly what we want for tree-shaking.

---

## (a) Install + tree-shaking registration

### Install

```bash
pnpm --filter @stabil/web add chart.js react-chartjs-2
# optional: a gauge needle plugin (see Chart 1)
pnpm --filter @stabil/web add chartjs-plugin-datalabels
```

> Do **not** import `chart.js/auto`. That pulls the entire library (all controllers, scales, plugins) into the bundle and defeats tree-shaking. Always register explicitly.

### Single registration module

Register **once**, at module load, in a shared file every chart imports. Only the pieces our seven charts need are registered: `ArcElement` (Doughnut/PolarArea), `BarElement` (Bar), `LineElement` + `PointElement` (Line/Radar points), `RadialLinearScale` (Radar/PolarArea), `CategoryScale` + `LinearScale` (Bar/Line axes), `Tooltip`, `Legend`, and `Filler` (Radar/Line area fills).

```ts
// apps/web/src/lib/charts/register.ts
import {
  Chart as ChartJS,
  // elements
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  // scales
  RadialLinearScale,
  CategoryScale,
  LinearScale,
  // plugins
  Tooltip,
  Legend,
  Filler,
} from "chart.js";

ChartJS.register(
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  RadialLinearScale,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
);

// Side-effect-only module. Import it once near the chart components.
export {};
```

```ts
// apps/web/src/lib/charts/index.ts — barrel that guarantees registration ran first
import "./register"; // MUST be first
export * from "./ChartCard";
export * from "./theme";
export * from "./gauge/ScoreGauge";
// ...one export per chart component
```

> **Next.js note.** Chart.js touches `canvas`, so chart components are **client components** (`"use client"`). Keep the report **page** a server component and render chart components as client islands, lazy-loaded (§Performance → lazy-loading). Importing `./register` from the barrel means every chart island shares one registration call; Chart.js's registry is idempotent so duplicate imports are harmless.

**What we deliberately do NOT register:** `PieController`'s extras, `TimeScale`/`TimeSeriesScale` (we format dates ourselves), `LogarithmicScale`, `BubbleController`, `ScatterController`, `SubTitle`, `Decimation` is registered **only** on the history Line chart's module (it is opt-in per chart via options, not a global element — see §Performance).

---

## (b) Typed reusable wrapper pattern

Don't scatter raw `<Doughnut data={...} options={...}>` across pages. Wrap each chart in a **named, typed component** that (1) owns its data/options shape, (2) merges the design-token theme, (3) renders the offscreen data-table fallback (§Accessibility), and (4) forwards a `ref` so the PDF pipeline can call `toBase64Image()`.

### The shared `ChartCard` shell

```tsx
// apps/web/src/lib/charts/ChartCard.tsx
"use client";
import { type ReactNode } from "react";

interface ChartCardProps {
  /** Visible heading for the chart. */
  title: string;
  /** Sub-line, e.g. "1180 / 1500 · Settled". */
  caption?: string;
  /** Accessible description announced to screen readers. */
  ariaLabel: string;
  /** The offscreen <table> equivalent of the chart data (a11y fallback). */
  dataTable: ReactNode;
  children: ReactNode;
}

export function ChartCard({ title, caption, ariaLabel, dataTable, children }: ChartCardProps) {
  return (
    <figure className="rounded-lg border bg-card p-4">
      <figcaption className="mb-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null}
      </figcaption>
      {/* role=img + aria-label give SR users a one-line summary; the canvas is decorative. */}
      <div role="img" aria-label={ariaLabel} className="relative aspect-video">
        {children}
      </div>
      {/* Visually hidden but in the a11y tree and SR-readable; see design-system.md `.sr-only`. */}
      <div className="sr-only">{dataTable}</div>
    </figure>
  );
}
```

### Typed per-chart component with a forwarded ref

Every chart component takes a **domain object** (not raw Chart.js shapes) and builds the Chart.js `data`/`options` internally. This keeps pages decoupled from Chart.js and makes the data-table fallback trivial to derive from the same source.

```tsx
// apps/web/src/lib/charts/types.ts
import type { ChartTypeRegistry, ChartData, ChartOptions } from "chart.js";

/** A typed (data, options) bundle for a given Chart.js chart type. */
export interface ChartConfig<T extends keyof ChartTypeRegistry> {
  data: ChartData<T>;
  options: ChartOptions<T>;
}
```

```tsx
// apps/web/src/lib/charts/useChartRef.ts — exposes toBase64Image() for the PDF path
"use client";
import { useRef, useImperativeHandle, type Ref } from "react";
import type { Chart as ChartJS } from "chart.js";

export interface ChartImageHandle {
  toImage(): string | null; // PNG data URL or null if not yet mounted
}

export function useChartImageHandle(ref: Ref<ChartImageHandle>) {
  const chartRef = useRef<ChartJS | null>(null);
  useImperativeHandle(ref, () => ({
    toImage: () => chartRef.current?.toBase64Image() ?? null,
  }));
  return chartRef;
}
```

`react-chartjs-2`'s `ref` resolves to the underlying `Chart` instance, so wiring `useChartImageHandle` into any `<Doughnut ref={chartRef} />` (etc.) is uniform across all seven charts.

---

## (c) Theming, responsiveness & dark mode

### Bind Chart.js options to design tokens

Chart.js does not read CSS variables, so we **read the resolved token values from the DOM at render time** and pass them into options. The tokens themselves (colors, radii, font) live in [design-system.md](./design-system.md); charts must never hard-code hex values.

```ts
// apps/web/src/lib/charts/theme.ts
"use client";
import type { Tier } from "@stabil/scoring";

/** Resolve a CSS custom property to its computed value (hsl string). */
function token(name: string): string {
  if (typeof window === "undefined") return "#000"; // SSR guard
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Tier → token color. Tier values come straight from `Tier` in @stabil/scoring. */
export const tierColorVar: Record<Tier, string> = {
  unstable: "--tier-unstable",
  developing: "--tier-developing",
  "somewhat-stable": "--tier-somewhat-stable",
  settled: "--tier-settled",
  stable: "--tier-stable",
};

export function chartTheme() {
  return {
    fg: `hsl(${token("--foreground")})`,
    muted: `hsl(${token("--muted-foreground")})`,
    grid: `hsl(${token("--border")})`,
    track: `hsl(${token("--muted")})`,
    accent: `hsl(${token("--primary")})`,
    tier: (t: Tier) => `hsl(${token(tierColorVar[t])})`,
    // Block palette for the contribution chart (one token per Block).
    block: {
      mode: `hsl(${token("--chart-block-mode")})`,
      common: `hsl(${token("--chart-block-common")})`,
      verification: `hsl(${token("--chart-block-verification")})`,
    },
  };
}
```

> **Design-system contract.** The tokens `--tier-*`, `--chart-block-*`, `--primary`, `--muted`, `--border`, `--foreground`, `--muted-foreground` are defined in [design-system.md](./design-system.md) and re-mapped under `.dark`. Charts consume them; they do not define them.

### Responsiveness

Always set `responsive: true` and `maintainAspectRatio: false`, then size the chart via the **container** (the `ChartCard`'s `aspect-video` wrapper). This lets the same component flow from a desktop two-column grid to a single mobile-web column without per-breakpoint options.

```ts
const base: ChartOptions = {
  responsive: true,
  maintainAspectRatio: false, // container controls height; avoids canvas overflow
  resizeDelay: 100,           // debounce ResizeObserver thrash on layout shifts
};
```

### Dark mode

`chartTheme()` reads the **currently applied** tokens, so when the `.dark` class toggles (via next-themes; see [design-system.md](./design-system.md)) the tokens change automatically. The catch: a chart already mounted on canvas won't repaint by itself. Subscribe to the theme and **rebuild options** so the memo key changes:

```tsx
"use client";
import { useTheme } from "next-themes";
import { useMemo } from "react";

const { resolvedTheme } = useTheme();
// resolvedTheme is part of the dependency list → options recompute on toggle,
// react-chartjs-2 diffs and Chart.js redraws with the new token colors.
const options = useMemo(() => buildOptions(chartTheme()), [resolvedTheme]);
```

---

## (d) Accessibility

Charts are images of data; a `<canvas>` is opaque to assistive tech. Stabil's a11y rules (see [best-practices.md](./best-practices.md), [design-system.md](./design-system.md)):

1. **`role="img"` + `aria-label`** on the chart wrapper give a one-sentence summary (handled by `ChartCard`), e.g. `aria-label="Overall stability score: 1180 out of 1500, tier Settled."`.
2. **Offscreen data-table fallback.** Every chart renders an `.sr-only` `<table>` with the exact numbers, derived from the **same domain object**. This is the source of truth for SR users and a graceful no-canvas fallback. Example for the parameter breakdown:

   ```tsx
   function BreakdownTable({ rows }: { rows: readonly ParameterScore[] }) {
     return (
       <table>
         <caption>Per-parameter score breakdown</caption>
         <thead>
           <tr><th scope="col">Parameter</th><th scope="col">Awarded</th><th scope="col">Max</th></tr>
         </thead>
         <tbody>
           {rows.map((r) => (
             <tr key={r.key}>
               <th scope="row">{r.label}</th>
               <td>{r.awarded}</td>
               <td>{r.max}</td>
             </tr>
           ))}
         </tbody>
       </table>
     );
   }
   ```

3. **Never color-only.** Tier and block are encoded with **text labels in the legend/tooltip and direct datalabels**, not just hue. For stacked/grouped bars, distinguish series with **labels** and, where two adjacent series can read as similar, a **pattern fill** (e.g. `patternomaly` or a small canvas pattern) in addition to color. Tooltips always state the label and the number: `"Tenure: 240 / 300"`.
4. **Respect `prefers-reduced-motion`.** Disable entry animations when the user opts out:

   ```ts
   const reduceMotion =
     typeof window !== "undefined" &&
     window.matchMedia("(prefers-reduced-motion: reduce)").matches;

   const options: ChartOptions = {
     animation: reduceMotion ? false : { duration: 400 },
   };
   ```

   We also force `animation: false` for the **PDF render path** (§PDF export) so the snapshot is taken on the final frame.
5. **Tooltips keyboard-reachable via the table.** Since canvas hover isn't keyboard-accessible, the `.sr-only` table is the keyboard/SR equivalent — it carries every value a sighted user would get from hovering.

---

## (e) Performance

- **Memoize `data` and `options`.** Recreating either object on every render forces react-chartjs-2 to diff and Chart.js to re-render. Wrap both in `useMemo` keyed on the domain input (and `resolvedTheme` for options). The `ScoreResult` reference is stable from TanStack Query, so memos rarely invalidate.

  ```tsx
  const data = useMemo(() => toBarData(result.breakdown, theme), [result.breakdown, theme]);
  const options = useMemo(() => buildBarOptions(theme, reduceMotion), [theme, reduceMotion]);
  ```

- **Decimation for long history.** The score-history Line chart can grow with each re-score (SCOPE §11 improvement loop). Enable Chart.js decimation so long series downsample on the GPU/CPU instead of plotting thousands of points:

  ```ts
  import { Decimation } from "chart.js";
  ChartJS.register(Decimation); // registered only in the history chart module

  const options: ChartOptions<"line"> = {
    parsing: false,              // required: feed pre-parsed {x, y} points
    plugins: {
      decimation: { enabled: true, algorithm: "lttb", samples: 100 },
    },
    scales: { x: { type: "linear" } },
  };
  ```

- **Lazy-load chart islands.** Charts are below-the-fold on the report page and pull in Chart.js. Load them with `next/dynamic` and `ssr: false` so the chart bundle is split out and never blocks first paint:

  ```tsx
  import dynamic from "next/dynamic";
  const ScoreGauge = dynamic(() => import("@/lib/charts/gauge/ScoreGauge"), {
    ssr: false,
    loading: () => <div className="aspect-video animate-pulse rounded-lg bg-muted" />,
  });
  ```

- **One canvas per metric.** Don't overlay unrelated metrics; smaller datasets render and rasterize faster for the PDF path.
- **`resizeDelay`** (set in `base` options above) debounces resize redraws during responsive layout shifts.

---

## Chart-per-metric mapping (Stabil reports)

All examples consume `@stabil/scoring` output. Recall the engine shapes (see [domain.ts](../../packages/scoring/src/domain.ts)):

```ts
interface ScoreResult {
  mode: "fresher" | "professional";
  total: number; maxTotal: number; tier: Tier;
  breakdown: readonly ParameterScore[];   // { key, label, block, visibility, awarded, max }
  byBlock: Record<"mode" | "common" | "verification", { awarded: number; max: number }>;
}
interface AudienceScoreResult extends ScoreResult {
  audience: "candidate" | "employer" | "recruiter";
  hiddenParameterCount: number; // > 0 only in the candidate view
}
```

| # | Metric | react-chartjs-2 component | Chart.js type | Phase |
|---|--------|---------------------------|---------------|-------|
| 1 | Overall score 0–1500 | `<Doughnut>` (gauge) | `doughnut` | 1 |
| 2 | Block contribution | `<Bar>` (stacked) or `<Doughnut>` | `bar` / `doughnut` | 1 |
| 3 | Per-parameter breakdown | `<Bar>` (horizontal) | `bar` | 1 |
| 4 | Score history | `<Line>` | `line` | 1 (grows over time) |
| 5 | Parameter strengths | `<Radar>` (or `<PolarArea>`) | `radar` / `polarArea` | 1 |
| 6 | Cohort/tier distribution | `<Bar>` | `bar` | 4 |
| 7 | Candidate comparison | `<Bar>` (grouped) + `<Radar>` overlay | `bar` / `radar` | 4 |

---

### Chart 1 — Overall score (radial GAUGE)

**Component:** `<Doughnut>` configured as a half/three-quarter gauge via `rotation` + `circumference`, with a colored arc up to `total/maxTotal`, a muted "track" remainder, the **tier color**, and a **center label** showing `total / maxTotal` and the tier name. Used on [candidate-report.md](./pages/candidate-report.md) and [employer-recruiter.md](./pages/employer-recruiter.md).

**Data shape (`ChartData<"doughnut">`).** Two slices: filled (tier-colored) and remainder (track).

```ts
function toGaugeData(result: ScoreResult, theme: ReturnType<typeof chartTheme>): ChartData<"doughnut"> {
  const filled = result.total;
  const remainder = Math.max(0, result.maxTotal - result.total);
  return {
    labels: ["Score", "Remaining"],
    datasets: [{
      data: [filled, remainder],
      backgroundColor: [theme.tier(result.tier), theme.track],
      borderWidth: 0,
      circumference: 270, // arc length (deg) — must match options
      rotation: 225,      // start angle (deg) so the gap sits at the bottom
    }],
  };
}
```

**Options shape (`ChartOptions<"doughnut">`).** Big inner radius for a thin ring; disable tooltip/legend (the center label carries the value); the center text is drawn by a tiny inline plugin.

```ts
const options: ChartOptions<"doughnut"> = {
  responsive: true,
  maintainAspectRatio: false,
  rotation: 225,
  circumference: 270,
  cutout: "78%",
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  animation: reduceMotion ? false : { animateRotate: true, duration: 600 },
};
```

**Center label + (optional) needle plugin.** A small custom plugin draws the score + tier in the doughnut hole. For a true needle, use a gauge/needle plugin — `chartjs-gauge` exposes `needle` / `valueLabel` options, or register a one-off `needle` plugin keyed to `total/maxTotal`. We default to the **center-label** style (no extra dep) and treat the needle as optional polish.

```tsx
"use client";
import { Doughnut } from "react-chartjs-2";
import "@/lib/charts/register";
import type { ScoreResult, Tier } from "@stabil/scoring";

const tierLabel: Record<Tier, string> = {
  unstable: "Unstable", developing: "Developing",
  "somewhat-stable": "Somewhat Stable", settled: "Settled", stable: "Stable",
};

const centerLabelPlugin = (result: ScoreResult, theme: ReturnType<typeof chartTheme>) => ({
  id: "centerLabel",
  afterDraw(chart: import("chart.js").Chart) {
    const { ctx, chartArea: { width, height, top } } = chart;
    const cx = width / 2;
    const cy = top + height * 0.62; // nudge into the 270° arc's visual center
    ctx.save();
    ctx.textAlign = "center";
    ctx.fillStyle = theme.fg;
    ctx.font = "600 28px var(--font-sans, system-ui)";
    ctx.fillText(`${result.total}`, cx, cy);
    ctx.fillStyle = theme.muted;
    ctx.font = "400 12px var(--font-sans, system-ui)";
    ctx.fillText(`of ${result.maxTotal} · ${tierLabel[result.tier]}`, cx, cy + 20);
    ctx.restore();
  },
});

export default function ScoreGauge({ result }: { result: ScoreResult }) {
  const theme = chartTheme();
  const data = useMemo(() => toGaugeData(result, theme), [result, theme]);
  const options = useMemo(() => /* options above */ buildGaugeOptions(reduceMotion), [reduceMotion]);
  return (
    <ChartCard
      title="Overall stability score"
      caption={`${result.total} / ${result.maxTotal} · ${tierLabel[result.tier]}`}
      ariaLabel={`Overall stability score ${result.total} of ${result.maxTotal}, tier ${tierLabel[result.tier]}.`}
      dataTable={<table><caption>Overall score</caption><tbody>
        <tr><th scope="row">Score</th><td>{result.total}</td></tr>
        <tr><th scope="row">Maximum</th><td>{result.maxTotal}</td></tr>
        <tr><th scope="row">Tier</th><td>{tierLabel[result.tier]}</td></tr>
      </tbody></table>}
    >
      <Doughnut data={data} options={options} plugins={[centerLabelPlugin(result, theme)]} />
    </ChartCard>
  );
}
```

---

### Chart 2 — Block contribution (mode vs common vs verification)

**Component:** `<Bar>` (single stacked bar) **or** `<Doughnut>`. We default to a **stacked horizontal Bar** because it reads as "parts of one 1500 total" and aligns with the gauge. Source = `result.byBlock` (`BlockTotals`). Blocks: `mode`, `common`, `verification` (SCOPE §4.1).

**Data shape (`ChartData<"bar">`).** One stack, three datasets (one per block) so each gets its own token color + legend label.

```ts
const BLOCK_LABEL: Record<Block, string> = {
  mode: "Mode-specific", common: "Common", verification: "Verification bonus",
};

function toBlockData(byBlock: BlockTotals, theme: ReturnType<typeof chartTheme>): ChartData<"bar"> {
  return {
    labels: ["Score"],
    datasets: (["mode", "common", "verification"] as const).map((b) => ({
      label: `${BLOCK_LABEL[b]} (${byBlock[b].awarded}/${byBlock[b].max})`,
      data: [byBlock[b].awarded],
      backgroundColor: theme.block[b],
      borderWidth: 0,
    })),
  };
}
```

**Options shape (`ChartOptions<"bar">`).** Horizontal (`indexAxis: "y"`), both axes stacked, x capped at `maxTotal` so the bar's filled length reads as a fraction of 1500.

```ts
const options: ChartOptions<"bar"> = {
  indexAxis: "y",
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { stacked: true, min: 0, max: result.maxTotal, grid: { color: theme.grid }, ticks: { color: theme.muted } },
    y: { stacked: true, grid: { display: false }, ticks: { color: theme.muted } },
  },
  plugins: {
    legend: { position: "bottom", labels: { color: theme.fg } },
    tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.x}` } },
  },
};
```

```tsx
import { Bar } from "react-chartjs-2";
// <Bar data={toBlockData(result.byBlock, theme)} options={options} />
```

> **Doughnut alternative:** same three values as arcs (`data: [mode, common, verification]`, `cutout: "60%"`) when the report layout prefers a compact donut next to the gauge. Keep the legend labels identical so the data-table fallback matches either rendering.

---

### Chart 3 — Per-parameter breakdown (awarded vs max)

**Component:** `<Bar>`, **horizontal** (`indexAxis: "y"`), one row per parameter with the **awarded** value plus a faint **max** track behind it. Source = `result.breakdown` (`ParameterScore[]`). Bars are tinted by `block`.

> **Audience filtering is already done.** For the **candidate view** the API returns an `AudienceScoreResult` whose `breakdown` has already dropped `employer-only` parameters (e.g. `age`, `maritalStatus` — see [config.ts](../../packages/scoring/src/config.ts) and `filterForAudience` in [audience.ts](../../packages/scoring/src/audience.ts)). The chart **maps `breakdown` as-is** and never filters by `visibility` itself. When `hiddenParameterCount > 0`, show a small note ("Some employer-only factors are not itemized here") sourced from that field — do **not** infer it from the array.

**Data shape (`ChartData<"bar">`).** Two datasets sharing the same `labels`: awarded (block-colored) and the max track (muted, drawn behind).

```ts
function toBreakdownData(rows: readonly ParameterScore[], theme: ReturnType<typeof chartTheme>): ChartData<"bar"> {
  return {
    labels: rows.map((r) => r.label),
    datasets: [
      {
        label: "Awarded",
        data: rows.map((r) => r.awarded),
        backgroundColor: rows.map((r) => theme.block[r.block]),
        borderRadius: 4,
      },
      {
        label: "Max",
        data: rows.map((r) => r.max),
        backgroundColor: theme.track,
        // draw behind "Awarded" with a non-stacked overlay
        grouped: false,
        order: 1,
      },
    ],
  };
}
```

**Options shape (`ChartOptions<"bar">`).** Horizontal; x to `0..maxOfMaxes`; tooltip reports `awarded / max`.

```ts
const maxX = Math.max(...rows.map((r) => r.max));
const options: ChartOptions<"bar"> = {
  indexAxis: "y",
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { min: 0, max: maxX, grid: { color: theme.grid }, ticks: { color: theme.muted } },
    y: { grid: { display: false }, ticks: { color: theme.fg } },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (c) => {
          const row = rows[c.dataIndex];
          return `${row.label}: ${row.awarded} / ${row.max}`;
        },
      },
    },
  },
};
```

```tsx
import { Bar } from "react-chartjs-2";
// <Bar data={toBreakdownData(result.breakdown, theme)} options={options} />
// note: result.breakdown is already audience-filtered upstream.
```

---

### Chart 4 — Score history across re-scores

**Component:** `<Line>`. Source = a `ScoreHistoryPoint[]` from the scoring module's history endpoint (see [../backend/modules/scoring.md](../backend/modules/scoring.md)) — each re-run produces a `{ scoredAt, total, tier }`. Shows the improvement loop (SCOPE §11). Tier bands can be drawn as faint horizontal bands using `mapTier` thresholds.

```ts
interface ScoreHistoryPoint { scoredAt: string /* ISO */; total: number; tier: Tier; }
```

**Data shape (`ChartData<"line">`).** Pre-parse to `{x, y}` so decimation can run (`parsing: false`). `Filler` shades the area under the line.

```ts
function toHistoryData(points: readonly ScoreHistoryPoint[], theme: ReturnType<typeof chartTheme>): ChartData<"line"> {
  return {
    datasets: [{
      label: "Total score",
      data: points.map((p) => ({ x: new Date(p.scoredAt).getTime(), y: p.total })),
      borderColor: theme.accent,
      backgroundColor: `${theme.accent}22`, // translucent fill via Filler
      fill: true,
      tension: 0.25,
      pointRadius: points.length > 60 ? 0 : 3, // hide points on long series
    }],
  };
}
```

**Options shape (`ChartOptions<"line">`).** Linear x (we format epoch ms into dates ourselves — no `TimeScale` dependency), y fixed `0..1500`, decimation enabled for long histories.

```ts
const options: ChartOptions<"line"> = {
  responsive: true,
  maintainAspectRatio: false,
  parsing: false,
  plugins: {
    legend: { display: false },
    decimation: { enabled: true, algorithm: "lttb", samples: 100 },
    tooltip: {
      callbacks: {
        title: (items) => new Date(items[0].parsed.x).toLocaleDateString(),
        label: (c) => `${c.parsed.y} / 1500`,
      },
    },
  },
  scales: {
    x: {
      type: "linear",
      ticks: { color: theme.muted, callback: (v) => new Date(v as number).toLocaleDateString() },
      grid: { color: theme.grid },
    },
    y: { min: 0, max: 1500, ticks: { color: theme.muted }, grid: { color: theme.grid } },
  },
};
```

```tsx
import { Line } from "react-chartjs-2";
// Register Decimation in THIS module: ChartJS.register(Decimation);
// <Line data={toHistoryData(points, theme)} options={options} />
```

---

### Chart 5 — Parameter strengths (Radar / PolarArea)

**Component:** `<Radar>` (default) or `<PolarArea>`. Plots each parameter's **normalized** strength `awarded/max` on a common `0..1` radial axis so parameters with different `max` values are comparable at a glance. Source = `result.breakdown`. Like Chart 3, `breakdown` is **already audience-filtered**, so candidate radars naturally omit employer-only spokes. Requires `RadialLinearScale` + `Filler` (registered in §a).

**Data shape (`ChartData<"radar">`).** One dataset of fractions; `RadialLinearScale` runs `0..1`.

```ts
function toRadarData(rows: readonly ParameterScore[], theme: ReturnType<typeof chartTheme>): ChartData<"radar"> {
  return {
    labels: rows.map((r) => r.label),
    datasets: [{
      label: "Strength",
      data: rows.map((r) => (r.max > 0 ? r.awarded / r.max : 0)),
      borderColor: theme.accent,
      backgroundColor: `${theme.accent}33`,
      fill: true,
      pointBackgroundColor: theme.accent,
    }],
  };
}
```

**Options shape (`ChartOptions<"radar">`).** Single `r` radial scale `0..1`.

```ts
const options: ChartOptions<"radar"> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    r: {
      min: 0, max: 1,
      ticks: { stepSize: 0.25, color: theme.muted, backdropColor: "transparent" },
      grid: { color: theme.grid },
      angleLines: { color: theme.grid },
      pointLabels: { color: theme.fg },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (c) => {
          const row = rows[c.dataIndex];
          return `${row.label}: ${row.awarded}/${row.max} (${Math.round((c.parsed.r as number) * 100)}%)`;
        },
      },
    },
  },
};
```

```tsx
import { Radar } from "react-chartjs-2";
// <Radar data={toRadarData(result.breakdown, theme)} options={options} />
```

> **PolarArea alternative** (`<PolarArea>`): same fractions as wedge radii — useful when there are few parameters and a radar looks sparse. Keep the `r` scale at `0..1` for comparability.

---

### Chart 6 — Employer cohort / tier distribution

**Component:** `<Bar>` (vertical). Employer/recruiter dashboards (Phase 4, see [employer-recruiter.md](./pages/employer-recruiter.md)) need "how many candidates fall in each tier." Source = an aggregate from [../backend/modules/employer-search.md](../backend/modules/employer-search.md): a count per `Tier`. Each bar is **tier-colored** and labeled with the tier name (never color-only).

```ts
type TierCounts = Record<Tier, number>;
const TIER_ORDER: readonly Tier[] = ["unstable", "developing", "somewhat-stable", "settled", "stable"];
```

**Data shape (`ChartData<"bar">`).** One dataset, one bar per tier in ladder order.

```ts
function toTierDistData(counts: TierCounts, theme: ReturnType<typeof chartTheme>): ChartData<"bar"> {
  return {
    labels: TIER_ORDER.map((t) => tierLabel[t]),
    datasets: [{
      label: "Candidates",
      data: TIER_ORDER.map((t) => counts[t]),
      backgroundColor: TIER_ORDER.map((t) => theme.tier(t)),
      borderRadius: 4,
    }],
  };
}
```

**Options shape (`ChartOptions<"bar">`).** Vertical bars; integer y ticks (counts are whole — points/counts are integers per README conventions).

```ts
const options: ChartOptions<"bar"> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { grid: { display: false }, ticks: { color: theme.fg } },
    y: { beginAtZero: true, ticks: { color: theme.muted, precision: 0 }, grid: { color: theme.grid } },
  },
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (c) => `${c.parsed.y} candidates` } },
  },
};
```

```tsx
import { Bar } from "react-chartjs-2";
// <Bar data={toTierDistData(counts, theme)} options={options} />
```

---

### Chart 7 — Phase 4 side-by-side candidate comparison

**Component:** **grouped `<Bar>`** (per-parameter, one dataset per candidate) and/or **overlaid `<Radar>`** (one dataset per candidate). Powers the comparison/ranking dashboard (SCOPE §9 post-POC, Phase 4; [employer-recruiter.md](./pages/employer-recruiter.md)). Each candidate is one `AudienceScoreResult` from the employer audience (employer view, so all parameters are visible). Cap to ~2–4 candidates for legibility.

**Grouped Bar — data shape (`ChartData<"bar">`).** Shared `labels` = parameter labels across the (employer) union; one dataset per candidate, each a distinct color **and** legend label (plus a pattern fill if colors crowd — see Accessibility).

```ts
interface NamedResult { name: string; result: AudienceScoreResult; }

function toCompareBarData(people: readonly NamedResult[], palette: string[]): ChartData<"bar"> {
  // Employer-audience results share the same parameter set; key by `key`.
  const keys = people[0].result.breakdown.map((p) => p.key);
  const labels = people[0].result.breakdown.map((p) => p.label);
  return {
    labels,
    datasets: people.map((person, i) => ({
      label: person.name,
      data: keys.map((k) => person.result.breakdown.find((p) => p.key === k)?.awarded ?? 0),
      backgroundColor: palette[i % palette.length],
      borderRadius: 4,
    })),
  };
}
```

**Overlaid Radar — data shape (`ChartData<"radar">`).** Same `labels`, one fractional dataset per candidate; translucent fills so overlap is visible.

```ts
function toCompareRadarData(people: readonly NamedResult[], palette: string[]): ChartData<"radar"> {
  const keys = people[0].result.breakdown.map((p) => p.key);
  const labels = people[0].result.breakdown.map((p) => p.label);
  return {
    labels,
    datasets: people.map((person, i) => ({
      label: person.name,
      data: keys.map((k) => {
        const p = person.result.breakdown.find((x) => x.key === k);
        return p && p.max > 0 ? p.awarded / p.max : 0;
      }),
      borderColor: palette[i % palette.length],
      backgroundColor: `${palette[i % palette.length]}22`,
      fill: true,
    })),
  };
}
```

**Options.** Grouped bar uses default (non-stacked) grouping with `legend.position: "top"`. Radar uses the same `r: { min: 0, max: 1 }` scale as Chart 5. Both always show the legend (the candidate name is the only disambiguator) and add per-series tooltips: `"Asha — Tenure: 240 / 300"`.

```tsx
import { Bar, Radar } from "react-chartjs-2";
// <Bar data={toCompareBarData(people, palette)} options={groupedBarOptions} />
// <Radar data={toCompareRadarData(people, palette)} options={radarCompareOptions} />
```

> **Audience note.** Comparison is an employer/recruiter feature, so results use the **employer audience** (`hiddenParameterCount === 0`) and parameter sets line up. Never mix a candidate-audience result (filtered breakdown) into a comparison — the spokes/bars would not align.

---

## (f) PDF export — charts as images

The PDF is built with **@react-pdf/renderer** ([../backend/modules/reports-pdf.md](../backend/modules/reports-pdf.md)), which cannot render a live `<canvas>`. So we **rasterize each chart to a PNG data URL** with Chart.js's `chart.toBase64Image()` and embed it as a `<Image>`.

There are two render paths; both reuse the same chart components and data builders:

1. **Client-side capture (in-app "Download PDF").** The report page already has the charts mounted. Use the `ChartImageHandle` (§b) refs to grab each PNG, then pass the data URLs into the PDF document.

   ```tsx
   const gaugeRef = useRef<ChartImageHandle>(null);
   // ...after charts have painted (e.g. in an onClick handler):
   const gaugePng = gaugeRef.current?.toImage(); // "data:image/png;base64,..."
   // <Image src={gaugePng!} /> inside the @react-pdf/renderer <Document>
   ```

2. **Server-side capture (emailed/stored PDF).** The API renders charts headlessly. For PNG output without a DOM, instantiate Chart.js on a **node-canvas** surface (`chartjs-node-canvas`) using the **same `data`/`options` builders** exported from `@/lib/charts`, call `toBuffer()`, and feed the buffer to @react-pdf/renderer. Keeping the data builders pure and framework-agnostic is what makes this reuse possible.

**Rules for the PDF path:**
- Force `animation: false` and `responsive: false` with a fixed `devicePixelRatio: 2` so the snapshot is sharp and taken on the final frame.
- Use **light-theme tokens** for print regardless of the user's dark-mode preference (pass `theme` built from the light token set).
- Always also render the **data table** in the PDF below each chart image — it is the print equivalent of the offscreen a11y table and keeps the export readable if an image fails.

See [../backend/modules/reports-pdf.md](../backend/modules/reports-pdf.md) for the document layout and where each PNG/table slots in.

---

## (g) Mobile (Expo / React Native)

Chart.js renders to `<canvas>`, which **does not exist in React Native** — running it would require a `WebView`, adding weight and breaking the native feel and a11y. So the mobile app (see [mobile.md](./mobile.md)) uses **victory-native** (Skia-based, v40+) as the default, with **react-native-gifted-charts** as a lighter alternative for simple bars/lines. The **data builders stay shared** (`@stabil/scoring` output → plain arrays); only the rendering layer differs per platform.

```bash
# victory-native (Skia)
pnpm --filter @stabil/mobile add victory-native @shopify/react-native-skia
# or the lighter option
pnpm --filter @stabil/mobile add react-native-gifted-charts react-native-linear-gradient
```

### Equivalent component per chart

| # | Metric | Web (Chart.js) | victory-native | react-native-gifted-charts |
|---|--------|----------------|----------------|----------------------------|
| 1 | Overall gauge | `<Doughnut>` (rotation/circ) | `Pie` with `innerRadius` + start/end angle, center `Text` | `PieChart` (`donut`, `radius`, center label) |
| 2 | Block contribution | stacked `<Bar>` | `CartesianChart` + stacked `Bar` | `BarChart` (`stackData`) |
| 3 | Per-parameter | horizontal `<Bar>` | `CartesianChart` + horizontal `Bar` | `BarChart` (`horizontal`) |
| 4 | Score history | `<Line>` | `CartesianChart` + `Line` (+ `Area`) | `LineChart` (`areaChart`) |
| 5 | Strengths | `<Radar>` / `<PolarArea>` | custom Skia polygon (no built-in radar) | `PieChart`/`PopulationPyramid` fallback, or custom Skia |
| 6 | Tier distribution | `<Bar>` | `CartesianChart` + `Bar` | `BarChart` |
| 7 | Comparison | grouped `<Bar>` / overlaid `<Radar>` | `CartesianChart` grouped `Bar`; overlay via two `Line`/polygons | `BarChart` (grouped via `stackData`/side-by-side) |

> **Radar caveat:** neither library ships a first-class radar. For mobile parity, either (a) draw a Skia polygon over a radial grid in victory-native, or (b) substitute a horizontal bar (Chart 3 shape) on mobile for the strengths view. Document the chosen substitution in [mobile.md](./mobile.md) so web/mobile parity expectations are explicit.

**Mobile a11y & theming:** same principles — feed `accessibilityLabel` from the domain object (the gauge's "1180 of 1500, Settled"), back charts with the same NativeWind tokens as [design-system.md](./design-system.md), and provide an accessible value summary near each chart (mobile's equivalent of the offscreen table).

---

## Acceptance criteria

- [ ] `chart.js/auto` is **never** imported; a single `register.ts` registers exactly the elements/scales/plugins in §a, and `Decimation` is registered only in the history chart module.
- [ ] Each of the seven metrics has a typed component built from a domain object (`ScoreResult` / `AudienceScoreResult` / `BlockTotals` / `ParameterScore[]` / `Tier`), not raw Chart.js shapes passed from pages.
- [ ] All chart colors come from design tokens via `chartTheme()`; **no hard-coded hex**; dark mode repaints on theme toggle.
- [ ] Every chart is wrapped in `ChartCard` with `role="img"`, an `aria-label`, and an `.sr-only` data table; tier/block are conveyed by **label**, not color alone; `prefers-reduced-motion` disables animation.
- [ ] `data` and `options` are memoized; the candidate breakdown/radar consume `breakdown` **as-is** (already audience-filtered) and surface `hiddenParameterCount` rather than re-filtering by `visibility`.
- [ ] Charts lazy-load via `next/dynamic` (`ssr:false`); the history Line uses decimation for long series.
- [ ] PDF export rasterizes via `toBase64Image()` / node-canvas with `animation:false`, light-theme tokens, and a fallback data table ([reports-pdf.md](../backend/modules/reports-pdf.md)).
- [ ] Mobile uses victory-native / react-native-gifted-charts per the mapping table, sharing the same data builders ([mobile.md](./mobile.md)).
