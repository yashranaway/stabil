# Candidate Report Dashboard

> **Status:** Draft v0.1 · **Phase:** 1 · **Owner area:** frontend
> **Related:**
> [frontend/charts.md](../charts.md) · [backend/modules/reports-pdf.md](../../backend/modules/reports-pdf.md) · [architecture/03-scoring-engine.md](../../architecture/03-scoring-engine.md) · [frontend/pages/employer-recruiter.md](./employer-recruiter.md) · [SCOPE.md](../../SCOPE.md)

This page is the candidate's own view of their Stabil report. It shows their overall stability score and tier, a breakdown of every candidate-visible scoring parameter grouped by block, a score history over time, a strengths radar, and concrete improvement guidance cards — all derived from the `AudienceScoreResult` already audience-filtered by `filterForAudience("candidate")` on the API side. Sensitive employer-only parameters (`age`, `maritalStatus`) are never surfaced here, but they still contribute to the total the candidate sees. The page also exposes a PDF download of the same filtered report.

---

## 1. Purpose & audience

| Item | Value |
|------|-------|
| **Audience** | Candidate (authenticated, `role = "candidate"`) |
| **Goal** | Let a candidate understand their score, see which parameters they can improve, track progress across re-scores, and download a shareable PDF |
| **Sensitive-data rule** | `age` and `maritalStatus` are **never rendered** in any component on this page — not in the breakdown, not in the radar, not in improvement cards, not in the PDF preview. The `hiddenParameterCount` may be surfaced in a disclosure note ("Your score also includes X factor(s) visible to employers only"). |

---

## 2. Route

```
/dashboard/report
```

- Protected: requires `role === "candidate"` session. Redirect to `/auth/sign-in` if unauthenticated.
- If the candidate has no `ScoreRun` yet, render the **empty state** (§7.2).
- No route params — each candidate has exactly one current report; history is listed within the page.

---

## 3. Phase

**Phase 1.** This page ships in Phase 1 alongside the scoring engine and form flows. All chart components reference Chart.js via `react-chartjs-2` as specified in [frontend/charts.md](../charts.md).

---

## 4. Layout & wireframe

The page uses a **single-column, card-stacked** layout on mobile; a **two-column grid** (primary 2/3 + sidebar 1/3) on `lg` and wider. All widths are Tailwind utility classes. The sidebar collapses below the primary column on mobile.

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back to Dashboard                          [↓ Download PDF]      │
│─────────────────────────────────────────────────────────────────────│
│                                                                     │
│  ┌──────────────────────────────┐  ┌────────────────────────────┐  │
│  │  SCORE GAUGE CARD            │  │  BLOCK SUMMARY SIDEBAR      │  │
│  │  ┌──────────────────────┐   │  │                              │  │
│  │  │   Doughnut Gauge     │   │  │  Mode block     ●●●●○  720  │  │
│  │  │   1 1 8 0  / 1500    │   │  │  Common block   ●●●○○  230  │  │
│  │  │   ████████████░░░    │   │  │  Verification   ●●○○○   90  │  │
│  │  └──────────────────────┘   │  │                              │  │
│  │  [TierBadge: Settled]        │  │  Total          ████░░  1040│  │
│  │                              │  └────────────────────────────┘  │
│  │  Score also includes 2        │                                  │
│  │  factor(s) visible to         │  ┌────────────────────────────┐  │
│  │  employers only.              │  │  HISTORY SIDEBAR            │  │
│  └──────────────────────────────┘  │  Line chart — re-scores     │  │
│                                    │  over time                   │  │
│  ┌────────────────────────────────┐│  Jun 6 ● 1040               │  │
│  │  PER-PARAMETER BREAKDOWN       ││  May 1 ● 910                 │  │
│  │                                ││  Apr 3 ● 760                 │  │
│  │  ▸ Mode block (Fresher)        │└────────────────────────────┘  │
│  │    Academics         200/250   │                                  │
│  │    Projects          120/250   │                                  │
│  │    Programming langs  90/150   │                                  │
│  │    AI familiarity     60/100   │                                  │
│  │    Cloud exposure     40/100   │                                  │
│  │    Courses & certs    70/100   │                                  │
│  │    Relocation          48/60   │                                  │
│  │    Flexibility         35/50   │                                  │
│  │    Work-mode pref      17/40   │                                  │
│  │                                │                                  │
│  │  ▸ Common block                │                                  │
│  │    Communication      100/150  │                                  │
│  │    Location            80/100  │                                  │
│  │                                │                                  │
│  │  ▸ Verification                │                                  │
│  │    Verified documents   90/150 │                                  │
│  └────────────────────────────────┘                                  │
│                                                                     │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐│
│  │  STRENGTHS RADAR         │  │  IMPROVEMENT GUIDANCE            ││
│  │  (Spider / radar chart)  │  │                                  ││
│  │                          │  │  ┌──────────────────────────┐   ││
│  │     Academics            │  │  │ +60 pts  Verify your ID  │   ││
│  │   /    \                 │  │  │  Upload a govt. ID doc.  │   ││
│  │  Projects  Comms         │  │  └──────────────────────────┘   ││
│  │   \    /                 │  │  ┌──────────────────────────┐   ││
│  │     Cloud                │  │  │ +130 pts  Add projects   │   ││
│  │                          │  │  │  Detail 1+ strong proj.  │   ││
│  └──────────────────────────┘  │  └──────────────────────────┘   ││
│                                │  (sorted: highest gain first)    ││
│                                └──────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Column grid (Tailwind)

```
<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
  <!-- Primary column: score gauge + breakdown + radar + guidance -->
  <div class="lg:col-span-2 space-y-6"> … </div>
  <!-- Sidebar: block summary + history -->
  <div class="lg:col-span-1 space-y-6"> … </div>
</div>
```

---

## 5. Sub-stages / sections

The page is a single route with no wizard steps. The content is divided into six visually distinct sections, all rendered from a single `GET /api/v1/score-runs/latest?audience=candidate` response:

| # | Section | Primary component |
|---|---------|-------------------|
| 1 | Score gauge + TierBadge | `ScoreGaugeCard` |
| 2 | Block summary (sidebar) | `BlockSummaryCard` |
| 3 | Per-parameter breakdown | `ParameterBreakdownAccordion` |
| 4 | Score history (sidebar) | `ScoreHistoryCard` |
| 5 | Strengths radar | `StrengthsRadarCard` |
| 6 | Improvement guidance cards | `ImprovementGuidanceList` |

---

## 6. Components

### 6.1 Design-system components (from `shadcn/ui` + Tailwind)

| Component | Usage |
|-----------|-------|
| `Card` | Wraps each section |
| `Badge` | `TierBadge` — tier name + tier colour ring (see §11 for non-colour accessibility) |
| `Accordion` | Collapsible block sections inside `ParameterBreakdownAccordion` |
| `Button` (variant `outline`) | "Download PDF" trigger |
| `Progress` | Per-parameter fill bar inside each row |
| `Tooltip` | "What is this?" hints on parameter labels |
| `Skeleton` | Loading state placeholder (§7.1) |
| `Alert` (variant `info`) | Employer-only disclosure note below gauge |

### 6.2 Chart components (see [frontend/charts.md](../charts.md) for full chart registry)

All charts use **Chart.js** via **`react-chartjs-2`**. Register only the components you use via `ChartJS.register(…)` to keep the bundle lean.

#### Chart A — Score Gauge (Doughnut)

- **Chart.js type:** `Doughnut` (half-doughnut / gauge variant)
- **Location in charts.md:** `gauge-score` entry
- **Data:** two segments — `total` (filled) and `maxTotal - total` (track). Always sums to `maxTotal` (1500).
- **Options:** `circumference: Math.PI`, `rotation: -Math.PI`, `cutout: "75%"`, `plugins.tooltip.enabled: false`. The numeric label (e.g. "1180 / 1500") is rendered in a centred `<div>` overlay, not as a chart label.
- **Colours:** filled segment uses the tier colour token from the design system (`tier-settled`, `tier-stable`, etc.); track is `gray-200`. Colour is decorative; tier name is always present as text (§11).
- **Animation:** `animation.duration: 800` on mount; `animation.duration: 0` on data-update to avoid jarring flicker on re-renders.
- **Responsive:** `maintainAspectRatio: false`; container has `aspect-ratio: 2/1`.

#### Chart B — Block Summary Bar (Horizontal Bar)

- **Chart.js type:** `Bar` (horizontal, `indexAxis: "y"`)
- **Location in charts.md:** `bar-block-summary` entry
- **Data:** three datasets (mode, common, verification), each a single row showing `awarded` vs `max`. Rendered as a stacked bar with two series: awarded (coloured) and remaining (gray track).
- **Labels:** `["Mode", "Common", "Verification"]`
- **Options:** `stacked: true`, `plugins.legend.display: false`, `scales.x.max: 1500`, ticks show integer values.
- **Note:** Block labels must match the `Block` enum values (`mode | common | verification`) from `domain.ts`. Human-readable labels are mapped in the presentation layer only.

#### Chart C — Score History Line

- **Chart.js type:** `Line`
- **Location in charts.md:** `line-score-history` entry
- **Data:** one dataset — one point per `ScoreRun` ordered chronologically: `x = scoredAt` (ISO timestamp), `y = total`.
- **Options:** `tension: 0.3` (slight curve), `plugins.tooltip` shows tier name + total on hover, `scales.y.min: 0`, `scales.y.max: 1500`. Horizontal dashed reference lines at each tier boundary (500, 800, 1100, 1350) via the `annotation` plugin (or drawn as dataset if annotation plugin is not registered).
- **Empty branch:** if `history.length === 1`, the chart renders a single point with a tooltip and a note "Score history will appear after your next re-score."
- **Accessibility:** line has `aria-label="Score history over time"`.

#### Chart D — Strengths Radar (Spider)

- **Chart.js type:** `Radar`
- **Location in charts.md:** `radar-strengths` entry
- **Data:** one dataset of per-parameter **performance fractions** (`awarded / max` for each visible parameter). Labels are the parameter `label` strings from `AudienceScoreResult.breakdown`.
- **Candidate view constraint:** only parameters with `visibility === "all"` appear as radar axes. The data arrives pre-filtered (`filterForAudience("candidate")`) so no client-side visibility filtering is needed.
- **Options:** `scales.r.min: 0`, `scales.r.max: 1`, `scales.r.ticks.display: false`. Point labels are the parameter short-names. Fill is semi-transparent tier colour.
- **Mobile:** chart height capped at `280px` on `sm` breakpoint; labels may be abbreviated (see [frontend/charts.md](../charts.md) mobile section).

---

## 7. Data needs

### 7.1 Queries

All queries use **TanStack Query** (`@tanstack/react-query`). See [frontend/state-and-forms.md](../state-and-forms.md) for conventions.

#### Latest score run (primary)

```ts
// Query key
["scoreRuns", "latest", { audience: "candidate" }]

// Endpoint
GET /api/v1/score-runs/latest?audience=candidate

// Response shape (matches AudienceScoreResult from domain.ts)
{
  id: string;                         // UUID v7 of the ScoreRun
  scoredAt: string;                   // ISO 8601 timestamp
  mode: "fresher" | "professional";
  total: number;                      // integer, 0–1500
  maxTotal: number;                   // always 1500
  tier: "unstable" | "developing" | "somewhat-stable" | "settled" | "stable";
  audience: "candidate";
  hiddenParameterCount: number;       // count of employer-only factors omitted
  breakdown: ParameterScore[];        // visibility === "all" rows only (age/maritalStatus absent)
  byBlock: {
    mode: { awarded: number; max: number };
    common: { awarded: number; max: number };
    verification: { awarded: number; max: number };
  };
}
```

> **Critical invariant (SCOPE §6.3):** The `total` field in the candidate response equals the `total` an employer sees for the same `ScoreRun`. Only `breakdown` differs (employer-only rows are stripped). Never derive the candidate's total by summing only their visible breakdown rows — it will not match. `byBlock` totals also reflect all blocks including hidden rows.

#### Score history (all runs)

```ts
// Query key
["scoreRuns", "history", { audience: "candidate" }]

// Endpoint
GET /api/v1/score-runs?audience=candidate&orderBy=scoredAt&dir=asc

// Response
{
  runs: Array<{
    id: string;
    scoredAt: string;
    total: number;
    tier: Tier;
    mode: Mode;
  }>;
}
```

History must include **every ScoreRun** the candidate has ever completed, not just the most recent N. There is no pagination cap in Phase 1; add cursor pagination in Phase 4 if needed.

### 7.2 Mutations

#### Trigger re-score

```ts
// Mutation key (TanStack Mutation)
POST /api/v1/score-runs

// Body (empty — the API scores from the candidate's current profile)
{}

// On success: invalidate ["scoreRuns", "latest", ...] and ["scoreRuns", "history", ...]
```

A "Re-score" button (visible only when `breakdown` is stale relative to profile edits) triggers this mutation. On loading state, disable the button and show a spinner.

#### Request PDF download

```ts
// Not a TanStack mutation; use a direct link or window.open to avoid blob-handling complexity.
GET /api/v1/score-runs/:id/pdf?audience=candidate

// Returns: application/pdf
// Triggers: browser download via Content-Disposition: attachment; filename="stabil-report-<id>.pdf"
```

See [backend/modules/reports-pdf.md](../../backend/modules/reports-pdf.md) for the PDF assembly contract. The PDF is generated server-side with `@react-pdf/renderer` and contains the same audience-filtered view (no `age`, no `maritalStatus`).

---

## 8. States

### 8.1 Loading

Displayed while `["scoreRuns", "latest"]` is in `pending` state.

- Replace the score gauge with a `Skeleton` of equivalent height (`h-48`).
- Replace the parameter breakdown with three `Skeleton` rows per block.
- Replace charts with a `Skeleton` of `h-48`.
- The PDF download button is disabled with `aria-disabled="true"`.

```tsx
if (query.isPending) return <CandidateReportSkeleton />;
```

### 8.2 Empty (no score yet)

Displayed when `GET /api/v1/score-runs/latest` returns `404` — the candidate has never completed scoring.

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│   [Illustration: blank gauge]                          │
│                                                        │
│   You don't have a score yet.                          │
│   Complete your profile to get your Stabil score.      │
│                                                        │
│   [ Start your assessment → ]                          │
│                                                        │
└────────────────────────────────────────────────────────┘
```

- "Start your assessment" links to `/dashboard/mode-select` (the mode selection + forms flow).
- The PDF download button and all chart sections are hidden.

### 8.3 Error

Displayed when the query fails (network error, 5xx, etc.).

```
┌────────────────────────────────────────────────────────┐
│  ⚠  Could not load your report.                        │
│     Please try again. If the problem persists, contact │
│     support.                                           │
│                                [ Retry ]               │
└────────────────────────────────────────────────────────┘
```

- "Retry" calls `query.refetch()`.
- Do not display a partial/stale chart while in error state.

### 8.4 Success (default)

All six sections render. The page header shows the `scoredAt` date as "Last scored on June 6, 2026".

### 8.5 Stale / re-score in progress

If the candidate has edited their profile since the last `ScoreRun`, a `Banner` above the gauge reads:

> "Your profile has changed since your last score. Re-score to see updated results."

With a "Re-score now" button that fires the `POST /api/v1/score-runs` mutation.

---

## 9. Forms & validation

This page has no data-entry forms. All inputs live in the mode-selection and profile-forms flow ([frontend/pages/mode-selection-and-forms.md](./mode-selection-and-forms.md)). The only interactive controls here are:

- "Download PDF" button (fires a `GET` download — no Zod schema needed).
- "Re-score" button (fires `POST /api/v1/score-runs` with an empty body — no client validation needed).

---

## 10. Charts (consolidated reference)

| ID | Section | Chart.js type | Key `charts.md` entry | Data source | Candidate-filter note |
|----|---------|---------------|-----------------------|-------------|----------------------|
| A | Score gauge | `Doughnut` (half) | `gauge-score` | `total`, `maxTotal` | N/A — total is identical for all audiences |
| B | Block summary bar | `Bar` (`indexAxis: "y"`, stacked) | `bar-block-summary` | `byBlock.{mode,common,verification}` | `byBlock` reflects all blocks; do not reconstruct from breakdown rows |
| C | Score history line | `Line` | `line-score-history` | `/score-runs?audience=candidate` history array | History endpoint already audience-scoped |
| D | Strengths radar | `Radar` | `radar-strengths` | `breakdown[]` (awarded/max per parameter) | Only `visibility === "all"` rows; pre-filtered by API |

All four charts must be wrapped in `<ErrorBoundary>` components — a chart crash must not blank the entire page.

---

## 11. Accessibility

- **Do not rely on colour alone to convey tier.** The `TierBadge` must always include the tier label as text (e.g. "Settled"), not just a coloured dot. Each tier additionally carries a distinct shape or icon to differentiate for users who cannot perceive colour:
  - `unstable` — hollow circle ○
  - `developing` — quarter-filled ◔
  - `somewhat-stable` — half-filled ◑
  - `settled` — three-quarter filled ◕
  - `stable` — filled circle ●
- **Score gauge:** wrap the gauge canvas in a `<figure>` with `<figcaption>` containing the score as text. Add `role="img"` and `aria-label="Stability score: 1180 out of 1500. Tier: Settled."` to the canvas element.
- **Radar chart:** `aria-label="Strengths radar chart"` on the canvas. Provide a visually-hidden `<table>` with the same data for screen readers (see [frontend/charts.md](../charts.md) accessibility section).
- **Progress bars:** each `<Progress>` component in the breakdown must have `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax` set to the parameter's `max`.
- **PDF button:** `aria-label="Download your Stabil report as PDF"`.
- **Focus order:** gauge → block summary → breakdown → history → radar → guidance. On mobile (single column), this matches reading order naturally.
- **Keyboard navigation:** the breakdown `Accordion` must be fully operable by keyboard. Use `shadcn/ui`'s `Accordion` which follows the ARIA Accordion pattern.
- **Colour contrast:** all tier colour tokens must meet WCAG 2.1 AA (4.5:1 for text, 3:1 for UI components) against both light and dark backgrounds. Verify in [frontend/design-system.md](../design-system.md).

---

## 12. Improvement guidance cards

The guidance cards derive directly from `AudienceScoreResult.breakdown` using the `improvementSuggestions` helper specified in [architecture/03-scoring-engine.md §7.1](../../architecture/03-scoring-engine.md):

```ts
// Presentation helper (client-side, mirrors §7.1 of scoring-engine doc)
interface Suggestion {
  key: string;        // parameter key, e.g. "verifiedDocuments"
  label: string;      // parameter label, e.g. "Verified documents"
  potentialGain: number; // max - awarded; always > 0
}

function improvementSuggestions(breakdown: ParameterScore[]): Suggestion[] {
  return breakdown
    .map((p) => ({ key: p.key, label: p.label, potentialGain: p.max - p.awarded }))
    .filter((s) => s.potentialGain > 0)
    .sort((a, b) => b.potentialGain - a.potentialGain);
}
```

Since `breakdown` is already audience-filtered (`visibility === "all"` only), `age` and `maritalStatus` are structurally absent — they can never appear in a suggestion card.

Each card renders:

```
┌──────────────────────────────────────────────────────────────────┐
│  +{potentialGain} pts  {label}                                  │
│  {actionable hint, e.g. "Upload a government ID document"}      │
│  [ Take action → ]  (links to relevant form section)            │
└──────────────────────────────────────────────────────────────────┘
```

- `potentialGain` reads from the live `max` in the breakdown — never hard-coded. Weights are PLACEHOLDER pending calibration (SCOPE §13).
- Guidance copy for each parameter key is maintained in a static `GUIDANCE_COPY` record in the component; keys map to human-readable hints and deep-links to the relevant form section.
- Show at most **5 cards** on initial render; a "Show more" button reveals the rest (if any).
- If `improvementSuggestions` returns an empty array (the candidate has a perfect 1500), render a congratulatory state: "Your score is maxed out! Share your report with employers."

---

## 13. PDF download

- The "Download PDF" button performs a direct navigation to `GET /api/v1/score-runs/:id/pdf?audience=candidate`.
- The API server assembles the PDF with `@react-pdf/renderer`. See [backend/modules/reports-pdf.md](../../backend/modules/reports-pdf.md) for the full assembly contract.
- The PDF contains the same audience-filtered data as this page. Employer-only items (`age`, `maritalStatus`) are never present in the candidate PDF.
- On click, disable the button and show a loading spinner for up to 10 seconds; restore if the download does not begin (detect via a `setTimeout` + `onfocus` pattern).
- The `Content-Disposition` header from the server uses the filename pattern: `stabil-report-<candidateId>-<scoredAt-date>.pdf`.

---

## 14. Employer-only disclosure note

Below the score gauge, always render the following `Alert` when `hiddenParameterCount > 0`:

```tsx
<Alert variant="info">
  Your score also includes {hiddenParameterCount} factor
  {hiddenParameterCount === 1 ? "" : "s"} that{" "}
  {hiddenParameterCount === 1 ? "is" : "are"} visible to employers only.
  These factors contribute to your total but are not itemized here.
</Alert>
```

When `hiddenParameterCount === 0` (which should not occur for a `professional` mode candidate, but may occur if all employer-only parameters score 0 and config changes), omit the alert.

---

## 15. Acceptance criteria

### Candidate-safety invariants

- [ ] The rendered breakdown contains **zero rows** with `visibility === "employer-only"`. Specifically, parameters keyed `age` and `maritalStatus` must never appear in any component on this page.
- [ ] The `total` displayed in the score gauge is **identical** to the total an employer would see for the same `ScoreRun` (verified by asserting `AudienceScoreResult.total === ScoreResult.total` at the query level).
- [ ] The radar chart axes contain no employer-only parameter labels.
- [ ] No improvement guidance card suggests an employer-only action (e.g. "be older" or "be married").
- [ ] The PDF downloaded via the "Download PDF" button contains no age or marital status line items. (Verified in [backend/modules/reports-pdf.md](../../backend/modules/reports-pdf.md) acceptance criteria.)

### Score history

- [ ] The history line chart plots **all** `ScoreRun` records for the authenticated candidate, ordered chronologically oldest-to-newest.
- [ ] Each point on the history chart is clickable and shows the `total` and `tier` for that run in a tooltip.
- [ ] After a re-score (POST `/api/v1/score-runs` succeeds), the history chart updates to include the new run without a full page reload (TanStack Query invalidation).

### Gauge & tier

- [ ] The gauge fills to `total / 1500` of its arc.
- [ ] The `TierBadge` label matches `result.tier` exactly (one of `unstable | developing | somewhat-stable | settled | stable`), displayed as the human-readable form (e.g. "Somewhat Stable").
- [ ] The `TierBadge` renders the tier label as visible text, not only as a colour or icon.

### Improvement guidance

- [ ] Cards are sorted by `potentialGain` descending.
- [ ] Each card's `+N pts` value equals `parameter.max - parameter.awarded` for that parameter, read from the live API response (not hard-coded).
- [ ] At most 5 cards are visible by default; a "Show more" button reveals the rest.
- [ ] When `total === 1500` (perfect score), the guidance section renders the congratulatory state and no cards.

### States

- [ ] While the primary query is pending, `CandidateReportSkeleton` renders with no chart canvases.
- [ ] When no `ScoreRun` exists (404), the empty state renders with a "Start your assessment" CTA linking to `/dashboard/mode-select`.
- [ ] When the query errors, the error state renders with a "Retry" button that calls `query.refetch()`.

### PDF download

- [ ] Clicking "Download PDF" initiates a file download without navigating away from the page.
- [ ] The downloaded filename matches `stabil-report-<candidateId>-<YYYY-MM-DD>.pdf`.
- [ ] The button is disabled while the request is in-flight.

### Accessibility

- [ ] The score gauge canvas has a non-empty `aria-label` that includes the numeric total, max, and tier name.
- [ ] The breakdown `Accordion` is fully keyboard-navigable (Tab, Enter/Space to open/close).
- [ ] Every `Progress` bar has `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` attributes.
- [ ] All tier colour tokens pass WCAG 2.1 AA contrast in both light and dark themes.
- [ ] Tier is distinguishable without colour (icon or text label always present alongside colour).

---

## 16. Cross-references

| Document | Why relevant |
|----------|-------------|
| [frontend/charts.md](../charts.md) | Canonical chart registry; defines `gauge-score`, `bar-block-summary`, `line-score-history`, `radar-strengths` entries referenced in §10 |
| [backend/modules/reports-pdf.md](../../backend/modules/reports-pdf.md) | PDF assembly, `@react-pdf/renderer` contract, audience-filtering at PDF render time |
| [architecture/03-scoring-engine.md](../../architecture/03-scoring-engine.md) | `ScoreResult`, `AudienceScoreResult`, `filterForAudience`, `improvementSuggestions` derivation (§7.1), `hiddenParameterCount` semantics |
| [frontend/pages/employer-recruiter.md](./employer-recruiter.md) | The employer view of the same score — shows all parameters including employer-only; useful for diffing the two views |
| [SCOPE.md §6.3](../../SCOPE.md) | Differentiated report views; sensitive-attr suppression rule |
| [SCOPE.md §7](../../SCOPE.md) | Stability tier bands and names (bands are PLACEHOLDER, pending calibration) |
| [SCOPE.md §8](../../SCOPE.md) | Output report requirements (improvement guidance, verification status) |
| [frontend/state-and-forms.md](../state-and-forms.md) | TanStack Query conventions, loading/error/empty patterns |
| [frontend/design-system.md](../design-system.md) | Tier colour tokens, contrast requirements, `TierBadge` component |
| [phases/phase-1-core-scoring.md](../../phases/phase-1-core-scoring.md) | Phase scope; this page ships in Phase 1 |
