# Frontend Best Practices

> **Status:** Draft v0.1 · **Phase:** cross-cutting · **Owner area:** frontend
> **Related:** [design-system.md](./design-system.md) · [charts.md](./charts.md) · [state-and-forms.md](./state-and-forms.md) · [frontend/README.md](./README.md) · [architecture/05-security-privacy.md](../architecture/05-security-privacy.md) · [architecture/04-api-contracts.md](../architecture/04-api-contracts.md) · [SCOPE.md](../SCOPE.md)

This document is the definitive engineering standard for the Stabil Next.js 15 web client. It covers performance, accessibility, security, error/state UX, forms, testing, internationalisation, and observability. It derives entirely from confirmed product scope (SCOPE.md) and the canonical tech stack (Next.js 15 / App Router, React 19, Tailwind, shadcn/ui, Chart.js via react-chartjs-2, TanStack Query, react-hook-form + Zod, Playwright, React Testing Library, MSW, Sentry). Every section has actionable do/don't checklists. Sibling docs are cross-linked by relative path.

---

## Contents

1. [Performance](#1-performance)
2. [Accessibility (a11y)](#2-accessibility-a11y)
3. [Security — frontend boundary](#3-security--frontend-boundary)
4. [Error & State UX](#4-error--state-ux)
5. [Forms](#5-forms)
6. [Testing](#6-testing)
7. [i18n & Locale](#7-i18n--locale)
8. [Observability](#8-observability)

---

## 1. Performance

### 1.1 Server Components vs Client Components

The App Router defaults to **React Server Components (RSC)**. Keep that default — flip to `"use client"` only when the component genuinely needs browser APIs, interactivity, or React hooks.

| Component type | Render where | When to use |
|---|---|---|
| **Server Component** (default) | Next.js server → streamed HTML | Page shells, data-fetching wrappers, static layout, report text sections, tier labels |
| **Client Component** (`"use client"`) | Hydrated in the browser | Chart.js charts, multi-step form wizards, file upload UI, consent toggles, any `useState`/`useEffect` |

**Decision rule:** a component that only receives serialisable props and renders markup is a Server Component. The moment it needs `onClick`, `useState`, `useRef`, a third-party hook, or the DOM, it becomes a Client Component.

```
// Good — Server Component; no "use client" directive needed
// app/(candidate)/report/[id]/page.tsx
import { TierBadge } from "@/components/tier-badge";
import { ScoreBreakdownTable } from "@/components/score-breakdown-table";
import { fetchReport } from "@/lib/api/reports";

export default async function CandidateReportPage({ params }: { params: { id: string } }) {
  const report = await fetchReport(params.id, { audience: "candidate" });
  return (
    <main>
      <TierBadge tier={report.tier} score={report.totalScore} />
      <ScoreBreakdownTable rows={report.breakdown} />
      {/* Chart is interactive — rendered as a Client Component subtree */}
      <RadarChartClient breakdown={report.breakdown} />
    </main>
  );
}
```

```
// Good — Client Component leaf; only this subtree is hydrated
// components/radar-chart-client.tsx
"use client";
import { Radar } from "react-chartjs-2";
import type { BreakdownRow } from "@stabil/contracts";
// ...
```

**Do / Don't**

| Do | Don't |
|---|---|
| Fetch report data in the Server Component's `async` body | Call `useEffect` + `fetch` inside a chart component to load its own data |
| Pass serialisable data down as props to the Client subtree | Lift state up into a Server Component — RSCs cannot hold state |
| Keep Client Component files small; extract sub-trees that can stay server-side | Mark a shared layout file `"use client"` — it forces the whole tree client-side |
| Use `Suspense` boundaries to stream in slow data sections | Await every fetch in sequence at the top of the page (blocks TTFB) |

### 1.2 Code Splitting & Lazy Charts

Chart.js bundles are large. Never import them at the module root of a page — lazy-load them.

```ts
// components/radar-chart-client.tsx
"use client";
import dynamic from "next/dynamic";
import { Suspense } from "react";

const RadarChart = dynamic(
  () => import("./radar-chart-inner").then((m) => m.RadarChart),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

export function RadarChartClient({ breakdown }: { breakdown: BreakdownRow[] }) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <RadarChart breakdown={breakdown} />
    </Suspense>
  );
}
```

- Use `ssr: false` for Chart.js components — Chart.js accesses `window` and `canvas`, which don't exist on the server.
- Apply the same pattern to `@react-pdf/renderer` preview components.
- `dynamic()` creates an automatic split point; the chart bundle is fetched only when the component enters the viewport or is needed.

### 1.3 Image Optimisation

Use `next/image` for all raster images (avatars, document thumbnails, verification badge illustrations). Never use `<img>`.

```tsx
import Image from "next/image";

<Image
  src={user.avatarUrl}
  alt={`${user.name} profile picture`}
  width={64}
  height={64}
  className="rounded-full"
  // Candidates' avatars are user-generated content — size is unknown; use fill + wrapper
/>
```

- Declare `remotePatterns` in `next.config.ts` for your MinIO/S3 domain. Never add `*` wildcards in production.
- Prefer SVG/Lottie for tier badge illustrations; they are resolution-independent and small.
- For document thumbnails (verification phase): generate a small JPEG preview server-side on upload and store it in MinIO; never display the raw PDF as an `<img>`.

### 1.4 Memoisation

Use memoisation sparingly and defensively — premature memoisation is an anti-pattern in React 19.

| Situation | Tool | Notes |
|---|---|---|
| Expensive pure computation (e.g. building Chart.js `datasets` from a 30-row breakdown) | `useMemo` | Only when profiling shows re-render cost |
| Stable callback passed to a memoised child | `useCallback` | Combine with `React.memo` on the child |
| Derived server data (aggregated scores, tier label, improvement tips) | Compute in the Server Component — no hook needed | Avoids the cost entirely |
| Heavy sort/filter in the employer ranking table (later phase) | `useMemo` with a clear dependency array | Include `[candidates, sortKey, sortDir]` |

**React 19 note:** React 19 ships the **React Compiler** (opt-in). When enabled it automatically memoises components and hooks outputs, removing the need for manual `useMemo`/`useCallback` in most cases. Do not add manual memoisation before profiling with DevTools; the compiler will warn about unnecessary wrappers. Check `react-compiler` integration status in `next.config.ts` before adding manual hooks.

```ts
// next.config.ts — enable compiler when stable for the Next.js 15 version in use
const nextConfig = {
  experimental: {
    reactCompiler: true, // validate version compatibility before enabling
  },
};
```

### 1.5 Chart.js Performance

Chart.js re-renders the entire canvas on every data or options change. Contain the blast radius.

**Do / Don't**

| Do | Don't |
|---|---|
| Register only the Chart.js components you use (`ChartJS.register(...)`) — see [charts.md](./charts.md) for the canonical registration list | Import `import "chart.js/auto"` — it registers everything and adds ~120 kB |
| Destructure stable `data` and `options` objects outside the render function or inside `useMemo` | Construct `data={{{ datasets: [...] }}}` inline in JSX — creates a new object reference every render, forcing a full canvas redraw |
| Use `updateMode: "none"` for purely cosmetic re-renders (e.g. theme colour toggle) | Call `chart.destroy()` then re-create on every data update — use `chart.update()` instead |
| Set `animation: false` for charts that update on user interaction (live score preview during form fill) | Leave animation enabled on charts that redraw frequently — it causes visual jank |
| Wrap long data lists in a windowed list if showing a comparison table (employer phase) | Render 100+ Chart.js instances on one page |

See [charts.md](./charts.md) for per-chart type guidance, registration, theming, and mobile chart patterns.

### 1.6 React 19 Specifics

| Feature | How Stabil uses it |
|---|---|
| **`use()` hook** | Unwrap promises passed from Server Components to Client Components (e.g. passing a pre-fetched report promise to a client boundary) |
| **`useOptimistic`** | Optimistic autosave status in multi-step forms — show "Saved" before the API confirms |
| **`useActionState`** / Server Actions | Avoid for the initial POC — TanStack Query mutations are the established pattern in this codebase (see [state-and-forms.md](./state-and-forms.md)); Server Actions can be evaluated for form submissions later |
| **`useTransition`** | Wrap navigation and route updates that trigger data refetches to keep the UI responsive |
| **Streaming / `Suspense`** | Nest `Suspense` boundaries at section granularity inside report pages so the score total streams in before the full breakdown |

---

## 2. Accessibility (a11y)

Stabil must meet **WCAG 2.1 Level AA** across all candidate, employer, and recruiter-facing pages. This is non-negotiable: the product is used in hiring decisions, and inaccessible tools can create discriminatory outcomes.

### 2.1 Keyboard Navigation

Every interactive element must be reachable and operable by keyboard alone.

**Do / Don't**

| Do | Don't |
|---|---|
| Use native `<button>`, `<a href>`, `<input>`, `<select>` for all interactive controls | Use `<div onClick>` or `<span onClick>` without `role` and `tabIndex` |
| Ensure all shadcn/ui primitives (Dialog, Combobox, Select, Popover) are keyboard-accessible — they use Radix UI which is keyboard-correct by default | Override Radix's focus management with custom `tabIndex` values without thorough testing |
| Test the mode-selection → form wizard → report flow entirely by keyboard (Tab, Shift+Tab, Enter, Space, Escape, arrow keys) before each release | Assume a working mouse flow implies keyboard accessibility |
| Use `role="group"` with `aria-labelledby` on form fieldsets (e.g. work-mode preference radio group) | Rely solely on placeholder text as the accessible name for an input |
| Trap focus inside modal dialogs (consent confirmation, document upload) | Let focus escape a modal dialog and reach background content |

### 2.2 ARIA

Follow the ARIA authoring practices. Use native semantics first; only reach for ARIA when a native element cannot serve the purpose.

```tsx
// Tier badge — score is not communicated by colour alone
<div
  role="status"
  aria-label={`Stability score: ${score} out of 1500 — ${tierLabel}`}
  className="flex items-center gap-2"
>
  <TierColourIndicator tier={tier} aria-hidden="true" />
  <span className="font-semibold">{tierLabel}</span>
  <span className="text-muted-foreground">{score} / 1500</span>
</div>
```

Key ARIA patterns for Stabil:

| Component | ARIA pattern |
|---|---|
| Multi-step form wizard | `aria-current="step"` on the active step indicator; `role="progressbar"` with `aria-valuenow` / `aria-valuemax` on the progress bar |
| Score radar chart | `role="img"` on the canvas wrapper + `aria-label` describing the chart; provide a screen-reader-only `<table>` with the same data (see [charts.md](./charts.md)) |
| Live score preview (if shown during form fill) | `aria-live="polite"` region so screen readers announce score updates without interrupting |
| Error messages | `aria-describedby` linking each input to its error message; `role="alert"` on form-level errors |
| File upload dropzone | `role="button"` or native `<button>` triggering a visually hidden `<input type="file">`; announce drop events with `aria-live` |
| Consent modal | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the dialog title, focus trapped inside |
| Verification status badge | Text description, not just a coloured dot or icon |

### 2.3 Focus Management

- On route changes (App Router navigation), move focus to the `<main>` landmark or the page heading. Use a skip-to-content link at the top of the layout.
- After a modal closes, return focus to the element that triggered it.
- After a multi-step form step advances, move focus to the new step's heading.
- After an async action completes (document upload, score submit), announce the result via `aria-live="polite"` and move focus to the confirmation or error message.

```tsx
// Layout — skip link
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-white focus:text-primary focus:rounded"
>
  Skip to main content
</a>
<main id="main-content" tabIndex={-1}>
  {children}
</main>
```

### 2.4 Colour Not Only — Tiers & Charts

The five stability tiers (Unstable → Stable) are communicated with colour-coded badges throughout the UI. Colour must never be the **sole** channel of information.

**Do:**
- Always pair a tier colour with the tier name text label (`Settled`, `Unstable`, etc.)
- Use a distinguishable icon or pattern alongside colour in charts (dashed vs solid lines, filled vs unfilled points, hatch patterns in bar charts) — see [design-system.md](./design-system.md) for the canonical tier colour tokens and [charts.md](./charts.md) for chart pattern usage
- Maintain a contrast ratio of ≥ 4.5:1 for normal text and ≥ 3:1 for large text and UI components against their background (WCAG AA)
- Test all tier colours against both light and dark mode backgrounds

**Don't:**
- Use colour alone to indicate which radar-chart axis corresponds to which parameter
- Use employer-only vs candidate-visible distinction as a colour hint in any candidate-facing UI — this information must not leak at any level (see [§3](#3-security--frontend-boundary))
- Use red for errors without also including an icon and text — red/green contrast is invisible to deuteranopes

**Tier colour / label pairing (always both):**

```tsx
// components/tier-badge.tsx
import type { Tier } from "@stabil/contracts";

const TIER_CONFIG: Record<Tier, { label: string; className: string; icon: string }> = {
  unstable:       { label: "Unstable",       className: "bg-tier-unstable text-tier-unstable-fg",       icon: "●" },
  developing:     { label: "Developing",     className: "bg-tier-developing text-tier-developing-fg",     icon: "◐" },
  "somewhat-stable": { label: "Somewhat Stable", className: "bg-tier-somewhat-stable text-tier-somewhat-stable-fg", icon: "◑" },
  settled:        { label: "Settled",        className: "bg-tier-settled text-tier-settled-fg",          icon: "◕" },
  stable:         { label: "Stable",         className: "bg-tier-stable text-tier-stable-fg",            icon: "●" },
};

export function TierBadge({ tier }: { tier: Tier }) {
  const { label, className, icon } = TIER_CONFIG[tier];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${className}`}>
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
```

### 2.5 `prefers-reduced-motion`

Stabil uses animated score counters, chart draw animations, and step-transition animations. All must respect the OS reduced-motion preference.

```ts
// lib/use-reduced-motion.ts
"use client";
import { useEffect, useState } from "react";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}
```

```ts
// Pass to Chart.js options
const chartOptions = {
  animation: prefersReducedMotion ? false : { duration: 400 },
};
```

- In Tailwind: use `motion-safe:` and `motion-reduce:` variants for CSS transitions.
- Set `animation: false` in Chart.js options whenever `prefersReducedMotion` is true.
- Score counter animations (counting up from 0 to the final score): skip the animation entirely or cut to the final value immediately when reduced motion is preferred.

---

## 3. Security — Frontend Boundary

The most critical frontend security requirement in Stabil is **audience-scoped data isolation**: the candidate bundle must never receive employer-only fields (age, marital status, the raw parameter records carrying `visibility: "employer-only"`). This is not merely a UI-rendering concern — it is a privacy and legal obligation (SCOPE §6.3, §8, §12; [architecture/05-security-privacy.md](../architecture/05-security-privacy.md)).

### 3.1 Audience-Scoped API Fetches — Never Filter Client-Side

The API is the authoritative enforcement point. The frontend must fetch data from audience-scoped endpoints and must never receive sensitive data and then hide it in the UI.

```
// CORRECT: fetch the audience-appropriate endpoint
// The API assembles and filters the report DTO before it leaves the server.
// The candidate's HTTP response body never contains employer-only parameters.

GET /api/v1/reports/:scoreRunId          → candidate view (role=candidate → employer-only fields absent from payload)
GET /api/v1/reports/:scoreRunId/employer → employer/recruiter view (role=employer|recruiter → full payload)
```

```
// WRONG: never do this
const fullReport = await fetch("/api/v1/reports/123/employer"); // fetches ALL fields
const candidateView = fullReport.breakdown.filter(p => p.visibility !== "employer-only"); // filters in the browser
// ^ sensitive data still hit the network and was parsed by the browser JS engine
```

**Do / Don't**

| Do | Don't |
|---|---|
| Call the audience-appropriate endpoint — the API enforces `visibility` via role-scoped serialisation (see [architecture/05-security-privacy.md §1.3](../architecture/05-security-privacy.md)) | Fetch the full employer report payload and filter it in a React component |
| Trust the API response; render what it returns — the absence of `age`/`marital_status` fields in the candidate response is the guarantee | Check `p.visibility !== "employer-only"` in JSX — this means the data arrived in the bundle |
| Verify in code review that no candidate-facing page imports a query hook that targets an employer endpoint | Add `visibility` to any client-side type — if the field reaches the frontend it is already a violation |
| Write an MSW handler for the candidate report endpoint that asserts the response body contains no employer-only keys (see [§6.3](#63-msw-for-api-mocking)) | Rely on the employer-facing UI "just not rendering" sensitive fields — the data is still in `window.__NEXT_DATA__` |

### 3.2 No PII or Tokens in `localStorage`

Stabil handles government ID numbers, Aadhaar/PAN references, and JWT tokens. None of these must be persisted to `localStorage` or `sessionStorage`.

| Data category | Correct storage | Rationale |
|---|---|---|
| JWT refresh token (web) | `HttpOnly; Secure; SameSite=Strict` cookie, set by the API | XSS cannot read `HttpOnly` cookies |
| JWT access token (web) | In-memory only (React context / TanStack Query cache) — do not persist | Short-lived (15 min); loss on page refresh is acceptable — refresh silently via cookie |
| JWT tokens (mobile) | Expo SecureStore (`expo-secure-store`) | Encrypted native keychain; see [mobile.md](./mobile.md) |
| User profile (name, email, mode) | TanStack Query cache (in-memory) | Refetched on mount; not sensitive enough to require persistence |
| Score draft (multi-step form) | Server-side draft endpoint + autosave (see [§5.4](#54-autosave)) | Never `localStorage` — form data may include Aadhaar number, date of birth |
| Uploaded document presigned URLs | Never stored — used once immediately | Presigned MinIO URLs expire; do not cache |

```ts
// lib/auth/token-store.ts — access token in memory only
let _accessToken: string | null = null;

export const tokenStore = {
  get: () => _accessToken,
  set: (t: string) => { _accessToken = t; },
  clear: () => { _accessToken = null; },
};
// On app boot / SPA navigation: call GET /api/v1/auth/session (sends HttpOnly cookie)
// → API validates refresh token → returns new access token in response body → store in memory
```

### 3.3 XSS Prevention & Sanitisation

Next.js (React) escapes JSX interpolations by default. The risk areas in Stabil are:

- **Rendered report text from the API** (improvement guidance, parameter labels) — these are data values, not HTML. Render them with JSX interpolation, never `dangerouslySetInnerHTML`.
- **Resume/document parsing output (Phase 2)** — the Ollama parser may return extracted text from a user-uploaded resume. Never render raw parser output as HTML.
- **User-supplied content** (profile bio, language list, etc.) — treat as plain text.

```tsx
// Safe — JSX escapes the string
<p>{report.improvementGuidance}</p>

// NEVER — do not render API strings as HTML
<p dangerouslySetInnerHTML={{ __html: report.improvementGuidance }} />
```

If rich text rendering is ever required (e.g. Markdown improvement tips), sanitise with `DOMPurify` before rendering:

```ts
import DOMPurify from "isomorphic-dompurify";
const safeHtml = DOMPurify.sanitize(markdownHtml, { ALLOWED_TAGS: ["p", "ul", "li", "strong", "em"] });
```

### 3.4 CSRF

- The API uses `HttpOnly` cookies for refresh tokens. Protect `POST`/`PATCH`/`DELETE` endpoints against CSRF.
- Strategy: **Double-Submit Cookie** — the API sets a `csrf-token` cookie (readable by JS, not `HttpOnly`); the client reads it and sends it as a custom header (`X-CSRF-Token`). The API validates that header. TanStack Query's `defaultOptions.mutations` can inject this header globally.

```ts
// lib/api/client.ts
import Cookies from "js-cookie";

export const apiClient = createApiClient({
  headers: () => ({
    "X-CSRF-Token": Cookies.get("csrf-token") ?? "",
  }),
});
```

- `SameSite=Strict` on the refresh token cookie provides an additional layer — cross-origin requests cannot include the cookie at all.

### 3.5 Dependency & Supply-Chain Security

- Pin exact versions in `package.json` (no `^` ranges) for security-sensitive packages.
- Run `pnpm audit` in CI; fail on high/critical findings.
- Use `next.config.ts` `headers()` to set `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.

---

## 4. Error & State UX

### 4.1 Error Boundaries

Wrap each major page section in its own `ErrorBoundary` so a single chart or breakdown table failure does not blank the entire report.

```tsx
// app/(candidate)/report/[id]/page.tsx
import { ErrorBoundary } from "react-error-boundary";

export default async function CandidateReportPage({ params }) {
  const report = await fetchReport(params.id, { audience: "candidate" });
  return (
    <main>
      <TierBadge tier={report.tier} score={report.totalScore} />
      <ErrorBoundary fallback={<SectionError message="Could not load score breakdown." />}>
        <ScoreBreakdownTable rows={report.breakdown} />
      </ErrorBoundary>
      <ErrorBoundary fallback={<SectionError message="Chart unavailable." />}>
        <RadarChartClient breakdown={report.breakdown} />
      </ErrorBoundary>
      <ErrorBoundary fallback={<SectionError message="Improvement tips unavailable." />}>
        <ImprovementPanel tips={report.improvementTips} />
      </ErrorBoundary>
    </main>
  );
}
```

**Do / Don't**

| Do | Don't |
|---|---|
| Place one `ErrorBoundary` per independent UI section | Wrap the whole `<main>` in a single boundary — a chart crash wipes the score total |
| Log the error to Sentry inside `onError` (see [§8.2](#82-sentry)) | Swallow errors silently — always log |
| Show a concise, non-technical message to users | Expose stack traces, error codes, or internal field names to end users |
| Provide a retry button or a link to reload the section | Leave the user in a permanently broken UI state |

### 4.2 RFC 9457 Problem+JSON → User Messages

The Stabil API uses RFC 9457 `application/problem+json` for all errors (see [architecture/04-api-contracts.md §1.5](../architecture/04-api-contracts.md)). The frontend maps these to user-facing messages.

```ts
// packages/contracts/src/errors.ts
export interface ApiProblem {
  type: string;         // URI e.g. "https://stabil.app/errors/not-found"
  title: string;        // short description
  status: number;       // HTTP status
  detail?: string;      // human-readable detail (may be shown to users)
  instance?: string;    // the request URI
  // extension fields:
  errors?: { field: string; message: string }[]; // 422 validation errors
  retryAfter?: number;  // 429 rate limit
}
```

```ts
// lib/api/error-handler.ts
import type { ApiProblem } from "@stabil/contracts";

export function problemToUserMessage(problem: ApiProblem): string {
  switch (problem.status) {
    case 401: return "Your session has expired. Please sign in again.";
    case 403: return "You don't have permission to view this report.";
    case 404: return "This report could not be found.";
    case 409: return "This action conflicts with a pending request. Please try again.";
    case 422: return problem.detail ?? "Some fields need attention. Please review the form.";
    case 429: return `Too many requests. Please wait ${problem.retryAfter ?? 60} seconds.`;
    case 500:
    case 502:
    case 503: return "Something went wrong on our end. Please try again shortly.";
    default:  return problem.detail ?? "An unexpected error occurred.";
  }
}
```

**Validation errors (422):** map `errors[].field` to inline form field errors using `react-hook-form`'s `setError` (see [§5.2](#52-inline-errors)).

### 4.3 Retry & Backoff

Configure TanStack Query's retry behaviour globally. Do not retry on auth or validation errors.

```ts
// lib/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        // Never retry auth, permission, or validation errors
        if (status && [401, 403, 404, 422].includes(status)) return false;
        return failureCount < 3;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000), // exponential, cap 30s
      staleTime: 60_000,     // report data: 1 min
      gcTime: 5 * 60_000,    // 5 min cache
    },
    mutations: {
      retry: false,           // mutations are not idempotent; never auto-retry
    },
  },
});
```

### 4.4 Loading, Empty & Skeleton States

Every async section must have a defined state for each possible render condition.

| State | Requirement |
|---|---|
| **Loading** | Show a skeleton that matches the content's shape and size — not a generic spinner in the middle of the page |
| **Empty** | Explain why the section is empty and what to do next (e.g. "No documents uploaded yet — [Add a document] to earn verification bonus points") |
| **Error** | Friendly message + retry action (see [§4.1](#41-error-boundaries)) |
| **Success** | Render content; no special treatment needed |

```tsx
// components/score-breakdown-skeleton.tsx
export function ScoreBreakdownSkeleton() {
  return (
    <div role="status" aria-label="Loading score breakdown" className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
          <div className="h-4 w-12 animate-pulse rounded bg-muted" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
```

Respect `prefers-reduced-motion` — replace `animate-pulse` with a static shimmer or remove the animation:

```css
/* globals.css */
@media (prefers-reduced-motion: reduce) {
  .animate-pulse { animation: none; }
}
```

---

## 5. Forms

Stabil's multi-step scoring wizard is the core interaction. Form correctness, validation, and autosave are first-class concerns. See [state-and-forms.md](./state-and-forms.md) for the full implementation guide; this section sets the mandatory standards.

### 5.1 Validation Parity with Backend Zod

All form validation must use the **same Zod schemas** defined in `packages/contracts`. Never duplicate validation logic in the frontend.

```ts
// packages/contracts/src/scoring-inputs.ts
import { z } from "zod";

export const FresherInputSchema = z.object({
  relocationWillingness: z.enum(["yes", "no", "maybe"]),
  workModePreference: z.enum(["on-site", "hybrid", "remote"]),
  aiFamiliarity: z.number().int().min(0).max(5),
  // ...
});

// apps/web/components/forms/fresher-form.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FresherInputSchema } from "@stabil/contracts";

const form = useForm({
  resolver: zodResolver(FresherInputSchema),
  defaultValues: draft ?? {},
});
```

**Do / Don't**

| Do | Don't |
|---|---|
| Import schemas from `@stabil/contracts` — one source of truth for web, mobile, and API | Re-write validation rules in the component using `register` options like `{ required: true, min: 0 }` |
| Map 422 API `errors[]` back to field-level errors with `form.setError` | Silently discard server-side validation errors — they catch cases the client schema misses |
| Show validation errors on blur and on submit, not on keystroke (reduces noise) | Show red borders before the user has touched the field |
| Validate the complete schema before each wizard step advance | Only validate the current step's fields — let partial invalid state accumulate |

### 5.2 Inline Errors

Every form field must have an accessible inline error. Use `aria-describedby` to link the error to its input.

```tsx
// components/ui/form-field.tsx
import { useId } from "react";

interface FormFieldProps {
  label: string;
  error?: string;
  children: (id: string, describedBy: string) => React.ReactNode;
}

export function FormField({ label, error, children }: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children(id, error ? errorId : "")}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive flex items-center gap-1">
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}
    </div>
  );
}
```

Map 422 API validation errors to form fields:

```ts
// After a failed mutation:
if (problem.status === 422 && problem.errors) {
  for (const { field, message } of problem.errors) {
    form.setError(field as keyof FormValues, { message });
  }
}
```

### 5.3 Multi-Step Wizard Conventions

See [state-and-forms.md](./state-and-forms.md) for the full wizard architecture. Required standards:

- Persist partial state to the server as a **draft score run** (via `PATCH /api/v1/score-runs/:id/draft`) — never to `localStorage` (see [§3.2](#32-no-pii-or-tokens-in-localstorage)).
- Validate the completed fields of each step before allowing progression; do not allow skipping steps.
- Show a step indicator with `aria-current="step"` and a numeric progress label (`Step 2 of 5`).
- On browser back-navigation, restore the previous step's state from the server draft.
- On page refresh, restore from the server draft (TanStack Query's `initialData` pattern).

### 5.4 Autosave

Autosave must be debounced and must not block the user interaction.

```ts
// hooks/use-autosave.ts
"use client";
import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useOptimistic } from "react"; // React 19

const DEBOUNCE_MS = 1500;

export function useAutosave<T>(values: T, saveFn: (values: T) => Promise<void>) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const { mutate, isPending } = useMutation({ mutationFn: saveFn });

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => mutate(values), DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [values, mutate]);

  return { isSaving: isPending };
}
```

- Show a non-intrusive save status indicator ("Saving…" / "Saved" / "Save failed — [Retry]").
- Use `useOptimistic` to show "Saved" immediately and revert if the server returns an error.
- On `beforeunload`, warn the user if there are unsaved changes that the autosave has not yet committed.

---

## 6. Testing

### 6.1 Playwright E2E — Score → Report Happy Path

The canonical e2e test covers the full candidate flow: sign up → mode selection → multi-step form → score submission → report view. This test must pass in CI before any merge to the main branch.

```ts
// tests/e2e/candidate-score-report.spec.ts
import { test, expect } from "@playwright/test";

test.describe("Candidate: score → report happy path", () => {
  test.beforeEach(async ({ page }) => {
    // Seed a fresh test candidate via API; receive credentials
    await page.goto("/sign-up");
  });

  test("fresher completes form and sees report", async ({ page }) => {
    // 1. Sign up
    await page.getByLabel("Email").fill("test.fresher@stabil.test");
    await page.getByLabel("Password").fill("Test1234!");
    await page.getByRole("button", { name: "Create account" }).click();

    // 2. Mode selection
    await page.getByRole("radio", { name: "Fresher" }).click();
    await page.getByRole("button", { name: "Continue" }).click();

    // 3. Multi-step form — step 1 (relocation + work mode)
    await page.getByLabel("Relocation willingness").selectOption("yes");
    await page.getByRole("radio", { name: "Hybrid" }).click();
    await page.getByRole("button", { name: "Next" }).click();

    // ... remaining steps

    // 4. Submit
    await page.getByRole("button", { name: "Get my score" }).click();

    // 5. Report visible
    await expect(page.getByRole("heading", { name: /Stability Score/i })).toBeVisible();
    await expect(page.getByRole("status", { name: /Stability score:/i })).toBeVisible();

    // 6. Employer-only fields must not appear in the DOM
    const html = await page.content();
    expect(html).not.toContain("marital");
    expect(html).not.toContain("employer-only");
  });

  test("candidate report page contains no employer-only data in network responses", async ({ page }) => {
    const apiResponses: unknown[] = [];
    page.on("response", async (res) => {
      if (res.url().includes("/api/v1/reports/")) {
        const json = await res.json().catch(() => null);
        if (json) apiResponses.push(json);
      }
    });

    // ... navigate to report page

    for (const body of apiResponses) {
      const text = JSON.stringify(body);
      expect(text).not.toMatch(/"visibility"\s*:\s*"employer-only"/);
      expect(text).not.toContain('"marital_status"');
      expect(text).not.toContain('"age"');
    }
  });
});
```

**Additional Playwright test scenarios:**

- Employer signs in → views full report → employer-only fields are present
- Consent flow: candidate shares report → employer receives share link → consent banner appears
- Keyboard-only navigation through the entire form wizard
- Mobile viewport (375 × 812) layout for report and form pages

### 6.2 React Testing Library — Component Tests

Unit-test components in isolation. Focus on behaviour, not implementation.

```ts
// components/__tests__/tier-badge.test.tsx
import { render, screen } from "@testing-library/react";
import { TierBadge } from "../tier-badge";

describe("TierBadge", () => {
  it("renders the tier label, not only a colour indicator", () => {
    render(<TierBadge tier="settled" />);
    expect(screen.getByText("Settled")).toBeInTheDocument();
  });

  it("has an accessible label that includes both score and tier", () => {
    render(<TierBadge tier="settled" score={1200} />);
    const badge = screen.getByRole("status");
    expect(badge).toHaveAccessibleName(/1200.*Settled/i);
  });
});
```

**Component test scope:**

| Component | What to test |
|---|---|
| `TierBadge` | Renders correct label for all 5 tiers; accessible name includes score |
| `ScoreBreakdownTable` | Does not render rows with `visibility === "employer-only"` when `audience="candidate"` |
| `FormField` | Shows error message linked via `aria-describedby`; clears error when corrected |
| `RadarChartClient` | Renders canvas; provides screen-reader `<table>` fallback |
| `ConsentModal` | Focus is trapped; Escape closes; confirm callback fires once |
| `ImprovementPanel` | Renders guidance text as plain text, not HTML |
| `ScoreBreakdownSkeleton` | Has `role="status"` and screen-reader label |

### 6.3 MSW for API Mocking

Use MSW (Mock Service Worker) for both Playwright e2e and React Testing Library. Define handlers in a shared fixture file.

```ts
// tests/msw/handlers/reports.ts
import { http, HttpResponse } from "msw";
import type { CandidateReportDTO } from "@stabil/contracts";

const candidateReport: CandidateReportDTO = {
  id: "01920000-0000-7000-0000-000000000001",
  totalScore: 1200,
  tier: "settled",
  breakdown: [
    { parameterId: "relocation", label: "Relocation Willingness", score: 80, maxScore: 100, block: "mode", visibility: "all" },
    // Note: NO employer-only rows in this fixture — the API never returns them to candidates
  ],
  improvementTips: ["Verify your ID to earn up to 50 bonus points."],
};

export const reportHandlers = [
  http.get("/api/v1/reports/:scoreRunId", ({ params }) => {
    // Candidate endpoint — never include employer-only fields
    return HttpResponse.json(candidateReport);
  }),
  http.get("/api/v1/reports/:scoreRunId/employer", () => {
    // Employer endpoint — full payload including employer-only fields
    return HttpResponse.json({
      ...candidateReport,
      breakdown: [
        ...candidateReport.breakdown,
        { parameterId: "marital_status", label: "Marital Status", score: 40, maxScore: 50, block: "mode", visibility: "employer-only" },
        { parameterId: "age", label: "Age", score: 30, maxScore: 50, block: "mode", visibility: "employer-only" },
      ],
    });
  }),
];
```

MSW is set up as a browser service worker for Playwright and as a Node server for RTL:

```ts
// tests/setup/msw.ts (RTL)
import { setupServer } from "msw/node";
import { reportHandlers } from "../msw/handlers/reports";
import { authHandlers } from "../msw/handlers/auth";

export const server = setupServer(...reportHandlers, ...authHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**`onUnhandledRequest: "error"`** is mandatory — if a test makes an API call that has no handler, the test fails rather than silently hitting the real network.

---

## 7. i18n & Locale

Stabil is geo-scoped to India + international from day one (SCOPE §14, decision #14). Internationalisation is a first-class concern, not an afterthought.

### 7.1 Framework

Use `next-intl` for the Next.js App Router. Locale routing via path prefix: `/en`, `/hi` (Hindi), with English as the default fallback.

```
// i18n configuration (next-intl)
// supported locales: en (default), hi
// messages directory: messages/{locale}.json
// date/number formatting uses Intl API — no manual locale-specific code
```

### 7.2 Locale-Sensitive Data

| Data | Formatting approach |
|---|---|
| Score (numeric, 0–1500) | `Intl.NumberFormat(locale)` — Indian locale uses lakh/crore separators for large numbers; scores fit in 4 digits, so grouping is cosmetic but consistent |
| Dates (score run date, document submission date) | `Intl.DateTimeFormat(locale, { dateStyle: "medium" })` — never hardcode `MM/DD/YYYY` |
| Percentages (parameter contribution) | `Intl.NumberFormat(locale, { style: "percent" })` |
| Currency | Not used in POC; use `Intl.NumberFormat` with `style: "currency"` when pricing is added |
| Text direction | All supported locales (en, hi) are LTR — Tailwind's `dir="ltr"` is sufficient; add RTL support (`dir="rtl"`, Tailwind `rtl:` variant) if Arabic/Urdu locales are added |

### 7.3 Translation Key Conventions

```json
// messages/en.json (excerpt)
{
  "report": {
    "title": "Your Stability Score",
    "score": "{score} out of {maxScore}",
    "tier": {
      "unstable": "Unstable",
      "developing": "Developing",
      "somewhat-stable": "Somewhat Stable",
      "settled": "Settled",
      "stable": "Stable"
    },
    "improvement": {
      "heading": "How to improve your score",
      "verifyId": "Verify your government ID to earn up to {points} bonus points."
    }
  }
}
```

**Do / Don't**

| Do | Don't |
|---|---|
| Use ICU message format for plurals and variables (`{count, plural, one {# document} other {# documents}}`) | Concatenate translated strings with JS string interpolation (`"Your score is " + score`) |
| Extract all user-visible strings to `messages/` — no hardcoded English in JSX | Hardcode tier labels in component code — they must be translatable |
| Format all numbers and dates with `Intl` APIs or `next-intl`'s `useFormatter` | Use `toLocaleDateString()` without a locale argument (inherits the runtime locale, which is unpredictable on the server) |
| Test with Hindi locale enabled in CI — use `playwright.config.ts` locale projects | Build only in English and assume "we'll add translations later" |

### 7.4 Document Type Names & India-Specific Content

Phase 3 verification supports India-specific documents (Aadhaar, PAN). Keep document type labels in translation files so they can be localised:

```json
// messages/en.json
{
  "verification": {
    "documentTypes": {
      "aadhaar": "Aadhaar Card",
      "pan": "PAN Card",
      "passport": "Passport",
      "national_id": "National ID"
    }
  }
}
```

---

## 8. Observability

### 8.1 Web Vitals

Collect Core Web Vitals to catch performance regressions before users notice them. The report page (heaviest page: charts + breakdown table) and the form wizard are the primary targets.

```ts
// app/layout.tsx — Next.js built-in Web Vitals reporting
export function reportWebVitals(metric: NextWebVitalsMetric) {
  // Send to your analytics endpoint or Sentry performance
  if (process.env.NODE_ENV === "production") {
    fetch("/api/v1/vitals", {
      method: "POST",
      body: JSON.stringify({
        name: metric.name,
        value: metric.value,
        id: metric.id,
        // DO NOT include user ID or any PII here
      }),
      keepalive: true,
    });
  }
}
```

**Target thresholds (WCAG-adjacent, Google CWV):**

| Metric | Target | Critical |
|---|---|---|
| LCP (Largest Contentful Paint) | ≤ 2.5s | > 4.0s |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | > 0.25 |
| INP (Interaction to Next Paint) | ≤ 200ms | > 500ms |
| FCP (First Contentful Paint) | ≤ 1.8s | > 3.0s |
| TTFB (Time to First Byte) | ≤ 800ms | > 1.8s |

- The score report page's LCP element is typically the tier badge or score total — ensure it is server-rendered HTML, not a hydration-dependent client render.
- Chart canvas elements are excluded from LCP measurement (no text or image content), but their render delay affects INP.

### 8.2 Sentry

Stabil uses Sentry for error tracking and performance monitoring. PII scrubbing is mandatory.

```ts
// sentry.client.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  // Never send PII to Sentry
  beforeSend(event) {
    return scrubPii(event);
  },
  beforeSendTransaction(event) {
    return scrubPii(event);
  },
});

function scrubPii<T extends object>(event: T): T {
  const text = JSON.stringify(event);
  // Remove common PII patterns before any data leaves the browser
  const scrubbed = text
    .replace(/"email"\s*:\s*"[^"]+"/g, '"email":"[REDACTED]"')
    .replace(/"aadhaar[^"]*"\s*:\s*"[^"]+"/gi, '"aadhaar":"[REDACTED]"')
    .replace(/"pan[^"]*"\s*:\s*"[^"]+"/gi, '"pan":"[REDACTED]"')
    .replace(/\b\d{12}\b/g, "[REDACTED_12DIGIT]") // Aadhaar number pattern
    .replace(/[A-Z]{5}\d{4}[A-Z]/g, "[REDACTED_PAN]"); // PAN pattern
  return JSON.parse(scrubbed) as T;
}
```

**Sentry configuration checklist:**

| Item | Status |
|---|---|
| `beforeSend` scrubs email, Aadhaar, PAN from all events | Required |
| `beforeSendTransaction` scrubs PII from performance traces | Required |
| User context set to only `{ id: userId }` — never `email` or `name` | Required |
| `allowUrls` restricted to your domain — blocks third-party script errors | Recommended |
| Source maps uploaded at build time; `hideSourceMaps: true` in next config | Required for production |
| Replay disabled or replay masking enabled for all inputs (`maskAllInputs: true`) | Required if Session Replay is used |

```ts
// Setting user context — ID only, never PII
Sentry.setUser({ id: user.id }); // userId is UUID — not PII
// NEVER: Sentry.setUser({ email: user.email, name: user.name });
```

**Tagging for Stabil-specific context:**

```ts
// Tag score-related errors with the mode and phase — useful for debugging wizard failures
Sentry.withScope((scope) => {
  scope.setTag("mode", form.getValues("mode")); // "fresher" | "professional"
  scope.setTag("wizard_step", currentStep);
  scope.setTag("phase", "1");
  Sentry.captureException(error);
});
```

**Do / Don't**

| Do | Don't |
|---|---|
| Apply `beforeSend` PII scrubbing | Send events to Sentry without a `beforeSend` hook |
| Use `Sentry.setUser({ id })` with UUID only | Set `email`, `name`, `phone`, or any personal data as Sentry user context |
| Enable `maskAllInputs: true` if Sentry Replay is enabled | Record session replays without input masking — form inputs may contain Aadhaar numbers |
| Set `tracesSampleRate` to 0.1 in production (10% sampling) | Set `tracesSampleRate: 1.0` in production — sends every transaction |
| Capture error boundaries' `onError` via `Sentry.captureException` | Rely solely on Sentry's global unhandled-error handler — boundary-caught errors would be missed |

---

## Appendix A — Quick Checklists

### A.1 Pre-merge checklist (PR author)

- [ ] No `"use client"` added to a file that doesn't need it (verify with `grep -r '"use client"' apps/web/app`)
- [ ] No `dangerouslySetInnerHTML` added without `DOMPurify` sanitisation
- [ ] No `localStorage` / `sessionStorage` reads or writes in new code
- [ ] Candidate-facing pages fetch from candidate-scoped API endpoints only
- [ ] All new interactive elements are keyboard-accessible and have accessible names
- [ ] Error boundaries wrap new async UI sections
- [ ] New form fields use schema from `@stabil/contracts` and have inline error display
- [ ] Tier labels and colours always appear together (never colour-only)
- [ ] Animations and chart draw effects respect `prefers-reduced-motion`
- [ ] New MSW handlers added for any new API endpoints used by tests
- [ ] `pnpm lint` and `pnpm tsc --noEmit` pass with zero errors

### A.2 Security checklist (per feature)

- [ ] No employer-only fields (`age`, `marital_status`, `visibility: "employer-only"`) appear in the candidate report page network responses (verify with Playwright network interception test)
- [ ] No tokens or sensitive form data written to `localStorage`
- [ ] `X-CSRF-Token` header sent on all mutation requests
- [ ] Sentry `beforeSend` hook tested with a sample event containing mock PII — confirm scrubbing works
- [ ] New API endpoints added to `Content-Security-Policy` connect-src if needed

### A.3 Accessibility checklist (per new page/component)

- [ ] Navigable by keyboard alone: Tab through all interactive elements
- [ ] Screen reader announces all meaningful content (tested with VoiceOver / NVDA)
- [ ] All images have `alt` text (decorative images have `alt=""`)
- [ ] Colour contrast meets WCAG AA (verified with browser DevTools or axe)
- [ ] No information conveyed by colour alone
- [ ] Focus is managed correctly after modals, navigation, and async actions
- [ ] `prefers-reduced-motion` disables all animations

---

*Cross-reference: for Chart.js chart-type specifics and registration, see [charts.md](./charts.md). For TanStack Query and react-hook-form patterns, see [state-and-forms.md](./state-and-forms.md). For Tailwind tokens, shadcn/ui component usage, and colour system, see [design-system.md](./design-system.md). For the full API error model and endpoint list, see [architecture/04-api-contracts.md](../architecture/04-api-contracts.md). For the security and privacy enforcement model, see [architecture/05-security-privacy.md](../architecture/05-security-privacy.md).*
