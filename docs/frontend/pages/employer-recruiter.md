# Employer & Recruiter Pages

> **Status:** Draft v0.1 · **Phase:** 1 (single report view) + 4 (comparison dashboard) · **Owner area:** frontend
> **Related:**
> - [backend/modules/consent-sharing.md](../../backend/modules/consent-sharing.md) — ShareGrant lifecycle, ConsentGuard
> - [backend/modules/employer-search.md](../../backend/modules/employer-search.md) — candidate search, compare, shortlist services
> - [backend/modules/reports-pdf.md](../../backend/modules/reports-pdf.md) — PDF generation, employer-audience assembly
> - [architecture/05-security-privacy.md](../../architecture/05-security-privacy.md) — RBAC, sensitive-attr handling, audit logging
> - [frontend/charts.md](../charts.md) — Chart.js/react-chartjs-2, chart component specs

These pages serve two closely-related audiences — **employers** (hiring companies) and **recruiters** (staffing agencies) — with the same functional contract but potentially distinct org contexts. Both roles share every screen described here; behavioural differences are called out explicitly. Neither role may view any candidate data unless a valid, active `ShareGrant` exists for that candidate (SCOPE §6.2). This document covers both delivery phases:

- **Phase 1:** single-candidate report view — the employer/recruiter sees one consented candidate's full breakdown, including employer-only fields (age, marital status).
- **Phase 4:** multi-candidate comparison & ranking dashboard — searchable/filterable candidate pool, sort by score/tier, side-by-side comparison with grouped Bar and overlaid Radar charts, and shortlist management.

---

## 1. Purpose & Audiences

### 1.1 Employer
A hiring company user who needs to:
1. Look up the stability report for a specific candidate who has shared their report with the employer.
2. (Phase 4) Browse, filter, and rank a pool of consented candidates.
3. (Phase 4) Compare candidates side-by-side to make shortlisting decisions.

### 1.2 Recruiter
A staffing-agency user with the same access model as an employer, but operating across multiple client roles. The recruiter may build and maintain named shortlists as part of a candidate-pipeline workflow.

### 1.3 What neither audience ever sees
- Any candidate report without an active `ShareGrant` for that specific employer/recruiter (SCOPE §6.2, enforced by `ConsentGuard` on every API route — see [architecture/05-security-privacy.md §3.4](../../architecture/05-security-privacy.md)).
- Age or marital status in any context where the requesting principal's role is `candidate` (SCOPE §6.3, §12). This constraint applies globally; the frontend must never render these fields if the authenticated role is `candidate`, but since these pages are role-gated to `employer` and `recruiter`, they are always shown here.

---

## 2. Routes

All routes require an authenticated session with `role IN ('employer', 'recruiter')`. A `candidate`-role JWT returns `403` before any data is read.

| Route | Phase | Description |
|-------|-------|-------------|
| `/employer/report/:profileId` | 1 | Single-candidate report view (consent-gated) |
| `/employer/candidates` | 4 | Candidate search, filter, sort, and results list |
| `/employer/candidates/compare` | 4 | Side-by-side comparison panel (2–4 candidates) |
| `/employer/shortlists` | 4 | Shortlist management — list and create |
| `/employer/shortlists/:shortlistId` | 4 | Shortlist detail — view, add/remove candidates |

> **Route convention:** The prefix `/employer` is shared between employers and recruiters. The role distinction is enforced by the API and the JWT claim; the frontend reads `user.role` from auth context to render minor label differences ("Your shortlists" vs "Agency shortlists") but the underlying routes are identical.

---

## 3. Phase Mapping

| Page / Feature | Phase | Notes |
|----------------|-------|-------|
| Single report view (`/employer/report/:profileId`) | **1** | Core deliverable; must ship before Phase 4 |
| PDF export of employer report | **1** | Triggered from within the single report view |
| Candidate search & filter (`/employer/candidates`) | **4** | Requires `EmployerSearchModule` backend |
| Sort by score / tier | **4** | Requires DB indexes per [phase-4-enhancements.md §Track 3](../../phases/phase-4-enhancements.md) |
| Side-by-side comparison panel | **4** | Requires `ComparisonService` |
| Grouped Bar chart (comparison) | **4** | Chart.js `Bar`, horizontal, grouped per parameter |
| Overlaid Radar chart (comparison) | **4** | Chart.js `Radar`, one dataset per candidate |
| Shortlist CRUD | **4** | Requires `ShortlistService` |
| Consent-withdrawn placeholder | **1 + 4** | Must be handled wherever a grant is revoked |

---

## 4. Phase 1 — Single-Candidate Report View

### 4.1 Route
`/employer/report/:profileId`

### 4.2 Layout / Wireframe

```
┌─────────────────────────────────────────────────────────────────────┐
│  STABIL  [Employer Dashboard]                  [Account ▾] [Sign out]│
├─────────────────────────────────────────────────────────────────────┤
│  ← Back to candidates                                                │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  CANDIDATE OVERVIEW                                            │  │
│  │                                                                │  │
│  │  [Avatar]  Firstname Lastname                                  │  │
│  │            Mode: Working Professional   Location: Pune         │  │
│  │            ✓ Verified User                                     │  │
│  │                                                                │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │  │
│  │  │ SCORE        │  │ TIER         │  │ CONSENT EXPIRES      │ │  │
│  │  │ 1240 / 1500  │  │ Settled      │  │ 2026-09-01           │ │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────┘ │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  SCORE BREAKDOWN                              [Export PDF ↓]   │  │
│  │  ────────────────────────────────────────────                  │  │
│  │  MODE BLOCK (Working Professional)                             │  │
│  │  Total Experience     ████████████░░░  160 / 200 pts          │  │
│  │  Tenure               ███████████░░░░  138 / 180 pts          │  │
│  │  Spoken Languages     ██████░░░░░░░░░   60 / 100 pts          │  │
│  │  Marital Status *     ████████████████  80 /  80 pts  [E]     │  │
│  │  Age *                █████████░░░░░░   90 / 120 pts  [E]     │  │
│  │                                                                │  │
│  │  COMMON BLOCK                                                  │  │
│  │  Communication        ████████░░░░░░░  140 / 200 pts          │  │
│  │  Location             ████████████░░░  120 / 150 pts          │  │
│  │  Verification Status  █████████████░░  100 / 120 pts          │  │
│  │                                                                │  │
│  │  VERIFICATION BONUS                                            │  │
│  │  Gov ID (Aadhaar)     ████████████████  50 /  50 pts          │  │
│  │                                                                │  │
│  │  ────────────────────────────────────────────                  │  │
│  │  TOTAL                                   1240 / 1500           │  │
│  │                                                                │  │
│  │  [E] = Employer-only field                                     │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  BLOCK DISTRIBUTION                                            │  │
│  │  [Horizontal stacked Bar chart — mode / common / verification] │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  PARAMETER RADAR                                               │  │
│  │  [Radar chart — parameters as axes, single dataset]            │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Legend:**
- `[E]` label in the breakdown indicates a parameter with `visibility = "employer-only"` (age, marital status). These rows are only present in the employer/recruiter response from the API; the candidate API endpoint never includes them (see [architecture/05-security-privacy.md §1.2–§1.3](../../architecture/05-security-privacy.md)).
- Score bars are rendered as `<progress>` or a Chart.js horizontal Bar per parameter.
- The "Consent Expires" field displays the `ShareGrant.expiresAt`; if null, it shows "No expiry set". If the grant is nearing expiry (< 7 days), display a warning badge.

### 4.3 Sub-stages

1. **Consent verification** — On page load, the frontend calls `GET /api/v1/reports/:profileId?audience=employer`. The `ConsentGuard` on the API blocks without a valid `ShareGrant`. If the response is `403`, the no-consent empty state is rendered (see §4.7).
2. **Report rendering** — If consent is valid, the API returns the full employer-audience report DTO including all `visibility = "all"` and `visibility = "employer-only"` parameters. The UI renders the breakdown table, charts, and summary header.
3. **PDF export** — "Export PDF" triggers `GET /api/v1/reports/:profileId/pdf?audience=employer`. The API returns a signed MinIO URL for the generated PDF artifact; the frontend opens it in a new tab or triggers a browser download.

### 4.4 Components

| Component | Source | Notes |
|-----------|--------|-------|
| `<CandidateOverviewCard>` | local | Avatar, name, mode, location, tier badge, verification badge, consent expiry |
| `<ScoreBreakdownTable>` | local | Rows per parameter; shows `[E]` tag for employer-only; progress bar per row |
| `<BlockStackedBar>` | charts — see [charts.md](../charts.md) | Stacked horizontal `Bar` from `react-chartjs-2`; datasets: mode block / common block / verification bonus |
| `<ParameterRadar>` | charts — see [charts.md](../charts.md) | `Radar` from `react-chartjs-2`; axes = parameters; single dataset for this candidate |
| `<TierBadge>` | design-system | Tier label with colour coding per 5-tier ladder |
| `<VerifiedBadge>` | design-system | "Verified User" indicator based on `verifiedUser` flag |
| `<NoConsentState>` | local | Empty-state component for 403/no-consent (see §4.7) |
| `<ExportPDFButton>` | local | Calls PDF endpoint; shows loading state during generation |

### 4.5 Data Needs

#### Query — employer report

```typescript
// apps/web/src/hooks/useEmployerReport.ts
const { data, isLoading, isError, error } = useQuery({
  queryKey: ['employer-report', profileId],
  queryFn: () => apiClient.get<EmployerReportDTO>(
    `/api/v1/reports/${profileId}?audience=employer`
  ),
  retry: false, // Do not retry a 403 — it is not a transient error
});
```

**Endpoint:** `GET /api/v1/reports/:profileId?audience=employer`
**Guards:** `JwtAuthGuard` → `RolesGuard(['employer','recruiter'])` → `ConsentGuard`
**Response shape (employer audience):**

```typescript
// packages/contracts/src/report.ts
interface EmployerReportDTO {
  profileId: string;             // UUID v7
  displayName: string;
  mode: 'fresher' | 'professional';
  location: string;
  verifiedUser: boolean;
  total: number;                 // integer, 0–1500
  tier: Tier;                    // 'unstable'|'developing'|'somewhat-stable'|'settled'|'stable'
  byBlock: {
    mode: number;
    common: number;
    verification: number;
  };
  breakdown: ParameterLineItem[]; // includes employer-only items
  shareGrant: {
    expiresAt: string | null;    // ISO-8601 or null
    scope: string[];             // e.g. ['full-report']
  };
  generatedAt: string;           // ISO-8601
}

interface ParameterLineItem {
  key: string;              // e.g. 'age', 'marital_status', 'tenure'
  label: string;            // human-readable e.g. 'Age'
  block: Block;
  visibility: Visibility;   // 'all' | 'employer-only'
  award: number;            // points awarded, integer
  max: number;              // maximum possible points, integer
  fraction: number;         // [0, 1]
  source: string;           // e.g. 'form' | 'parsed' | 'document'
}
```

#### Mutation — PDF export

```typescript
// Triggered by <ExportPDFButton>
const { mutate: exportPDF, isPending } = useMutation({
  mutationFn: () => apiClient.get<{ url: string }>(
    `/api/v1/reports/${profileId}/pdf?audience=employer`
  ),
  onSuccess: ({ url }) => window.open(url, '_blank'),
});
```

**Endpoint:** `GET /api/v1/reports/:profileId/pdf?audience=employer`
See [backend/modules/reports-pdf.md](../../backend/modules/reports-pdf.md) for PDF assembly and MinIO artifact storage.

### 4.6 States

| State | Trigger | UI |
|-------|---------|-----|
| **Loading** | Query in flight | Skeleton: header card placeholder, breakdown rows shimmer, chart placeholder |
| **No consent / 403** | API returns `403 Forbidden` (`ConsentGuard` — no active `ShareGrant`) | `<NoConsentState>` (see §4.7) |
| **Consent expired** | Grant `status = 'expired'`; API returns `403` | Same `<NoConsentState>` with messaging: "This candidate's consent has expired" |
| **Consent revoked** | Grant `status = 'revoked'`; API returns `403` | Same `<NoConsentState>` with messaging: "This candidate has withdrawn consent" |
| **Success** | Report DTO received | Full layout with breakdown, charts, PDF button |
| **PDF generating** | `exportPDF` mutation in flight | Button label changes to "Generating…"; spinner; disabled |
| **Error (non-403)** | Network error, 500, etc. | Inline error banner with retry option; do not show any partial data |

### 4.7 No-Consent / Empty State

This is the most important state: **no report data must ever be rendered without a valid, active ShareGrant.**

```
┌────────────────────────────────────────────────────────┐
│                                                        │
│             🔒                                         │
│                                                        │
│      No access to this candidate's report              │
│                                                        │
│      A report is only visible after the candidate      │
│      explicitly shares it with you.                    │
│                                                        │
│      If you have already requested access, the         │
│      candidate will be notified and must approve        │
│      the share before you can view their report.       │
│                                                        │
│      [Request access]   [Back to candidates]           │
│                                                        │
└────────────────────────────────────────────────────────┘
```

- The "Request access" button triggers a notification to the candidate (via `POST /api/v1/consent/requests`); it is disabled if a pending request already exists.
- No score, no tier, no name partial data is shown in this state — the component must render entirely from the error response, not from any stale/cached report data.
- The same component is used when `expiresAt` has passed or consent has been revoked, with the message copy adjusted accordingly.

---

## 5. Phase 4 — Multi-Candidate Comparison & Ranking Dashboard

Phase 4 adds a full multi-candidate workflow on top of the single-report foundation. All pages in this section are implemented in Phase 4 and depend on the `EmployerSearchModule` backend (see [backend/modules/employer-search.md](../../backend/modules/employer-search.md)) and the `Shortlist` / `ShortlistEntry` data models (see [phases/phase-4-enhancements.md §Track 3](../../phases/phase-4-enhancements.md)).

### 5.1 Route: `/employer/candidates` — Candidate Search & Results

#### 5.1.1 Layout / Wireframe

```
┌──────────────────────────────────────────────────────────────────────┐
│  STABIL  [Employer Dashboard]            [Shortlists] [Account ▾]    │
├──────────────────────────────────────────────────────────────────────┤
│  Find Candidates                                                      │
│                                                                       │
│  ┌─────────────────────────────────────────┐  [Search]               │
│  │ 🔍  Search by name, skill, or location  │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │  FILTERS                                                      │    │
│  │  Mode         [Fresher ▾]  [Professional ▾]  [Any ✓]         │    │
│  │  Tier         [Any ▾]                                         │    │
│  │  Score range  [  600  ──────────────── 1500  ]                │    │
│  │  Location     [City / State / Country ▾]                      │    │
│  │  Verified     [ ✓ Verified only ]                              │    │
│  │  Relocation   [ Willing to relocate ]                          │    │
│  │                                               [Clear filters]  │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  Sort by: [Score ▼]   38 candidates match  [Compare (0) — disabled]  │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ ☐  Candidate A      ████████████░░ 1240/1500  Settled  ✓  Pune│  │
│  │ ☐  Candidate B      ██████████░░░░ 1105/1500  Settled     Mum  │  │
│  │ ☐  Candidate C      ████████░░░░░░  980/1500  Somewhat  Delhi  │  │
│  │ ☐  Candidate D      ███████░░░░░░░  910/1500  Somewhat  Blr   │  │
│  │ ☐  Candidate E      ██████░░░░░░░░  860/1500  Somewhat  Hyd   │  │
│  │    ...                                                          │  │
│  │                                       [Load more — page 2 of 4]│  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  Shortlists:  [+ New]  Q3 Python Hires (4)  Senior Backend (2)       │
└──────────────────────────────────────────────────────────────────────┘
```

**Row anatomy (single candidate result):**
- Checkbox for comparison selection (max 4 selected simultaneously)
- Display name (anonymised if org policy requires — employer-org-level flag, out of scope for Phase 4 baseline)
- Inline score progress bar (`<ScoreInlineBar>` — Chart.js or CSS, see §5.1.3)
- Score label (`1240 / 1500`)
- Tier badge (`<TierBadge>`)
- Verified badge (`✓` if `verifiedUser = true`)
- Location string
- "Add to shortlist" overflow menu (adds to any of the user's shortlists)
- "View report" link → navigates to `/employer/report/:profileId`

#### 5.1.2 Sub-stages

1. **Initial load** — TanStack Query fetches the first page of results with default sort (`score DESC`, no filters). Results are scoped by the API to only consented candidates (consent-join happens in SQL; no revoked profiles are returned).
2. **Filter application** — Each filter change triggers a new query (debounced 400 ms for the score-range slider and text search). Filter state is persisted to the URL query string (`?tier=settled&mode=professional&minScore=1000`) so the URL is shareable.
3. **Sort change** — Changing the sort dropdown triggers a fresh query with the new `sort` param.
4. **Pagination** — Results use cursor-based pagination (`?cursor=<uuidv7>`). "Load more" appends the next page to the existing list (infinite scroll pattern using `useInfiniteQuery`).
5. **Comparison selection** — Checking candidate rows accumulates `selectedProfileIds`. "Compare (N)" button becomes active when N ≥ 2; it is disabled and labelled "Compare (max 4)" when N = 4. Clicking navigates to `/employer/candidates/compare?ids=a,b,c,d`.

#### 5.1.3 Components

| Component | Source | Notes |
|-----------|--------|-------|
| `<CandidateSearchBar>` | local | Controlled text input; debounced query update |
| `<FilterPanel>` | local | shadcn/ui `Select`, `Slider`, `Checkbox`, `Badge` |
| `<CandidateResultRow>` | local | Single row; checkbox, score bar, tier badge, shortlist menu |
| `<ScoreInlineBar>` | local / CSS | Thin horizontal bar, colour-coded by tier; width = `(total / 1500) * 100%` |
| `<TierBadge>` | design-system | Shared with single-report view |
| `<SortDropdown>` | local | `score`, `tier`, `name`, `submittedAt` options |
| `<CompareButton>` | local | Disabled until ≥ 2 selected; shows count |
| `<ShortlistSidebar>` | local | Collapsed by default on desktop; list of user's shortlists; "Add to shortlist" button |
| `<EmptySearchResults>` | local | When filters produce 0 results (see §5.1.5) |
| `<NoConsentPoolState>` | local | When authenticated user has 0 consented candidates (see §5.1.5) |

#### 5.1.4 Data Needs — Search Query

```typescript
// apps/web/src/hooks/useCandidateSearch.ts
const {
  data,
  fetchNextPage,
  hasNextPage,
  isLoading,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: ['employer-candidates', filters, sort],
  queryFn: ({ pageParam }) =>
    apiClient.get<CandidateSearchPageDTO>('/api/v1/employer/candidates', {
      params: {
        ...filters,   // tier, mode, minScore, maxScore, location, verified, relocation
        sort,         // 'score' | 'tier' | 'name' | 'submittedAt'
        order,        // 'asc' | 'desc'
        cursor: pageParam,
        limit: 20,
      },
    }),
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  initialPageParam: undefined,
});
```

**Endpoint:** `GET /api/v1/employer/candidates`
**Guards:** `JwtAuthGuard` → `RolesGuard(['employer','recruiter'])`
**Note:** `ConsentGuard` is applied at the search-query level in the `CandidateSearchService` as a SQL join — not as a per-row guard — so only candidates with `status = 'active'` `ShareGrant` rows for the requesting user are returned. No extra frontend consent check is needed; the API guarantees filtered results.

**Response shape:**

```typescript
interface CandidateSearchPageDTO {
  items: CandidateSearchResultDTO[];
  nextCursor: string | null;
  total: number;   // total matching (across all pages) for display
}

interface CandidateSearchResultDTO {
  profileId: string;
  displayName: string;
  mode: 'fresher' | 'professional';
  total: number;
  tier: Tier;
  location: string;
  verifiedUser: boolean;
  willingToRelocate: boolean;
  shareGrant: {
    expiresAt: string | null;
  };
}
```

#### 5.1.5 States

| State | Trigger | UI |
|-------|---------|-----|
| **Loading (initial)** | First query in flight | Skeleton rows (5 placeholders) |
| **Loading (more)** | `fetchNextPage` in flight | Spinner below last row |
| **No consented candidates** | API returns 0 results and no filters are active | `<NoConsentPoolState>`: "No candidates have shared their report with you yet." |
| **Empty search results** | Filters applied, 0 results | `<EmptySearchResults>`: "No candidates match your filters." + [Clear filters] button |
| **Error** | Network error or 5xx | Inline error banner; retry button |
| **Max comparison selected** | 4 checkboxes ticked | Further checkboxes are disabled; "Compare (max 4)" |
| **Consent-near-expiry** | `shareGrant.expiresAt` within 7 days | Warning icon on the row; tooltip shows expiry date |

---

### 5.2 Route: `/employer/candidates/compare` — Side-by-Side Comparison Panel

#### 5.2.1 Route & Parameters

`/employer/candidates/compare?ids=<uuid1>,<uuid2>[,<uuid3>[,<uuid4>]]`

`ids` is a comma-separated list of 2–4 `profileId` values. If < 2 or > 4 IDs are present in the query string, redirect to `/employer/candidates` with an error toast.

#### 5.2.2 Layout / Wireframe

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STABIL  [Employer Dashboard]                        [Account ▾] [Sign out]  │
├──────────────────────────────────────────────────────────────────────────────┤
│  ← Back to candidates                                  [Export CSV ↓]        │
│                                                                               │
│  Comparing 3 candidates                                                       │
│                                                                               │
│  ┌──────────────────────┬──────────────────┬──────────────┬────────────────┐  │
│  │  Parameter           │  Candidate A     │  Candidate B │  Candidate C   │  │
│  ├──────────────────────┼──────────────────┼──────────────┼────────────────┤  │
│  │  ─ SUMMARY ─         │                  │              │                │  │
│  │  Total Score         │  1240 / 1500     │  1105 / 1500 │   980 / 1500   │  │
│  │  Tier                │  Settled         │  Settled     │  Somewhat St.  │  │
│  │  Mode                │  Professional    │  Fresher     │  Professional  │  │
│  │  Verified            │  ✓               │  ✗           │  ✓             │  │
│  ├──────────────────────┼──────────────────┼──────────────┼────────────────┤  │
│  │  ─ MODE BLOCK ─      │                  │              │                │  │
│  │  Total Experience    │  ████████░░ 80%  │   —          │  ██████░░ 60%  │  │
│  │  Tenure              │  █████████░ 90%  │   —          │  ███████░ 70%  │  │
│  │  Spoken Languages    │  ██████░░░░ 60%  │   —          │  █████░░░░ 50% │  │
│  │  Marital Status [E]  │  Married         │   —          │  Single        │  │
│  │  Age [E]             │  32              │   —          │  28            │  │
│  │  Academics           │   —              │  █████████░  │   —            │  │
│  │  Projects            │   —              │  ████████░░  │   —            │  │
│  │  AI Familiarity      │   —              │  ██████░░░░  │   —            │  │
│  │  ...                 │  ...             │  ...         │  ...           │  │
│  ├──────────────────────┼──────────────────┼──────────────┼────────────────┤  │
│  │  ─ COMMON BLOCK ─    │                  │              │                │  │
│  │  Communication       │  ███████░░░ 70%  │  █████░░░░░  │  ████████░░    │  │
│  │  Location            │  ████████░░ 80%  │  ███████░░░  │  ██████░░░░    │  │
│  │  Verification Status │  █████████░ 90%  │  ████████░░  │  █████████░    │  │
│  ├──────────────────────┼──────────────────┼──────────────┼────────────────┤  │
│  │  ─ VERIFICATION ─    │                  │              │                │  │
│  │  Gov ID bonus        │  50 / 50 pts     │  0 / 50 pts  │  50 / 50 pts   │  │
│  └──────────────────────┴──────────────────┴──────────────┴────────────────┘  │
│                                                                               │
│  [E] = Employer-only field                                                    │
│  — = parameter not applicable to this candidate's mode                        │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  GROUPED BAR CHART — Score by parameter per candidate                   │  │
│  │  [Chart.js horizontal Bar, grouped; see charts.md §<grouped-bar>]       │  │
│  │                                                                          │  │
│  │  Total Experience   [■ A 160] [■ B  — ] [■ C 120]                       │  │
│  │  Tenure             [■ A 138] [■ B  — ] [■ C  90]                       │  │
│  │  Communication      [■ A 140] [■ B 100] [■ C 130]                       │  │
│  │  ...                                                                     │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  RADAR CHART — Parameter profile overlay (common parameters only)       │  │
│  │  [Chart.js Radar; one dataset per candidate, overlaid; see charts.md]   │  │
│  │                                                                          │  │
│  │              Communication                                               │  │
│  │                   ●                                                      │  │
│  │    Location   ────●──── Verification                                     │  │
│  │                   ●                                                      │  │
│  │  (each dataset = one candidate; colour-coded to match table header)      │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  ADD TO SHORTLIST                                                        │  │
│  │  [+ Add all to shortlist ▾]   Or select per candidate:                   │  │
│  │  Candidate A [Add to... ▾]  Candidate B [Add to... ▾]  ...              │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

#### 5.2.3 Charts

Both charts render inside the comparison panel. They are described fully in [charts.md](../charts.md); this section specifies how they are configured for the comparison context.

##### Grouped Bar Chart

- **Library:** `react-chartjs-2` `<Bar>` component with `indexAxis: 'y'` (horizontal bars).
- **Datasets:** one dataset per candidate (2–4), each with a distinct colour.
- **Labels (Y-axis):** parameter labels (e.g. "Total Experience", "Communication"). Parameters not applicable to a candidate's mode are either omitted from that candidate's dataset or set to `null` / `NaN` so Chart.js skips the bar.
- **X-axis:** points awarded (0 to the parameter's `max`).
- **Grouping:** `grouped: true` (default for `Bar` without `stacked`). Bars for the same parameter sit side-by-side.
- **Employer-only parameters:** Age and marital status are categorical, not numeric — they are shown only in the table, not in the bar chart (a bar for "Married" is not meaningful). Omit from the Bar chart dataset; keep in the table.
- **Accessibility:** each dataset has `label` set to the candidate's display name; `aria-label` on the chart canvas references the same. See §6.

```typescript
// Example dataset shape
const groupedBarData: ChartData<'bar'> = {
  labels: applicableParamLabels,  // string[]
  datasets: comparedProfiles.map((profile, idx) => ({
    label: profile.displayName,
    data: applicableParamLabels.map(
      (paramKey) => profile.breakdown.find((p) => p.key === paramKey)?.award ?? null
    ),
    backgroundColor: CANDIDATE_COLOURS[idx],
    barThickness: 14,
  })),
};
```

##### Overlaid Radar Chart

- **Library:** `react-chartjs-2` `<Radar>` component.
- **Axes:** common-block parameters only (Communication, Location, Verification Status) — these exist for every candidate regardless of mode, making the radar axes consistent across datasets.
- **Datasets:** one dataset per candidate, overlaid. `fill: true` with low opacity (`0.15`) so overlapping regions remain readable.
- **Scale:** normalised fractions `[0, 1]` per parameter, so the radar shape reflects proportional performance rather than raw points.
- **Employer-only parameters:** Age and marital status are not plotted on the radar (they are categorical and mode-specific). The radar is limited to common-block parameters only.
- **Accessibility:** `<Radar>` `aria-label` identifies the chart as "Parameter profile comparison — [Candidate A], [Candidate B]…".

```typescript
const radarData: ChartData<'radar'> = {
  labels: COMMON_BLOCK_PARAM_LABELS, // e.g. ['Communication', 'Location', 'Verification']
  datasets: comparedProfiles.map((profile, idx) => ({
    label: profile.displayName,
    data: COMMON_BLOCK_PARAM_KEYS.map(
      (key) => profile.breakdown.find((p) => p.key === key)?.fraction ?? 0
    ),
    borderColor: CANDIDATE_COLOURS[idx],
    backgroundColor: hexToRgba(CANDIDATE_COLOURS[idx], 0.15),
    pointRadius: 4,
  })),
};
```

#### 5.2.4 Components

| Component | Source | Notes |
|-----------|--------|-------|
| `<ComparisonTable>` | local | Full parameter-by-parameter table; columns = candidates |
| `<ComparisonTableRow>` | local | Single parameter row; bar sparkline per cell |
| `<EmployerOnlyTag>` | local | `[E]` badge on employer-only rows |
| `<GroupedBarChart>` | charts — see [charts.md](../charts.md) | Horizontal grouped Bar; datasets per candidate |
| `<OverlaidRadarChart>` | charts — see [charts.md](../charts.md) | Radar; common-block params; overlaid datasets |
| `<ConsentWithdrawnPlaceholder>` | local | Shown per-column when a candidate's grant is revoked mid-session |
| `<ExportCSVButton>` | local | Calls CSV export endpoint |
| `<ShortlistActions>` | local | Add-to-shortlist controls per candidate + bulk add |

#### 5.2.5 Data Needs — Comparison Query

```typescript
// apps/web/src/hooks/useComparison.ts
const { data, isLoading, isError } = useQuery({
  queryKey: ['comparison', profileIds],
  queryFn: () =>
    apiClient.get<ComparisonDTO>(
      `/api/v1/employer/candidates/compare?ids=${profileIds.join(',')}`
    ),
  enabled: profileIds.length >= 2 && profileIds.length <= 4,
  retry: false,
});
```

**Endpoint:** `GET /api/v1/employer/candidates/compare?ids=<uuid1>,<uuid2>[,<uuid3>[,<uuid4>]]`
**Guards:** `JwtAuthGuard` → `RolesGuard(['employer','recruiter'])` → per-profile consent check in `ComparisonService`

**Response shape:**

```typescript
interface ComparisonDTO {
  profiles: ComparisonProfileDTO[];
}

interface ComparisonProfileDTO {
  profileId: string;
  displayName: string;
  mode: 'fresher' | 'professional';
  total: number;
  tier: Tier;
  verifiedUser: boolean;
  location: string;
  breakdown: ParameterLineItem[];  // same shape as EmployerReportDTO.breakdown
  consentWithdrawn: false;         // always false when data is present
}
// OR, when consent was revoked between search and compare:
interface ConsentWithdrawnProfileDTO {
  profileId: string;
  consentWithdrawn: true;
  // no other fields
}
```

If any of the requested profile IDs lacks an active `ShareGrant`, the API returns that profile's slot as `{ profileId, consentWithdrawn: true }` rather than returning `403` for the entire request — this allows partial comparison to still render. The frontend renders `<ConsentWithdrawnPlaceholder>` for that column.

#### 5.2.6 States

| State | Trigger | UI |
|-------|---------|-----|
| **Loading** | Comparison query in flight | Skeleton table with correct number of columns; chart placeholder |
| **Success** | Comparison DTO received | Full table, grouped bar, radar, shortlist actions |
| **Partial consent withdrawn** | One or more profiles return `consentWithdrawn: true` | Affected columns render `<ConsentWithdrawnPlaceholder>`; charts render only consented candidates' datasets |
| **All consent withdrawn** | Every profile in the request has `consentWithdrawn: true` | Full `<NoConsentState>` with link back to candidates |
| **Invalid IDs (< 2 or > 4)** | URL parsed with wrong count | Redirect to `/employer/candidates` + error toast |
| **Error** | Network/5xx | Error banner; retry; [Back to candidates] link |

---

### 5.3 Route: `/employer/shortlists` — Shortlist Management

#### 5.3.1 Layout / Wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  STABIL  [Employer Dashboard]               [Account ▾] [Sign out]│
├──────────────────────────────────────────────────────────────────┤
│  Shortlists                                    [+ New shortlist]  │
│                                                                    │
│  ┌────────────────────────────┐  ┌────────────────────────────┐  │
│  │  Q3 Python Hires           │  │  Senior Backend (Aug)      │  │
│  │  4 candidates              │  │  2 candidates              │  │
│  │  Created 2026-06-01        │  │  Created 2026-05-28        │  │
│  │  [Open] [Delete]           │  │  [Open] [Delete]           │  │
│  └────────────────────────────┘  └────────────────────────────┘  │
│                                                                    │
│  (empty state if no shortlists yet)                               │
└──────────────────────────────────────────────────────────────────┘
```

#### 5.3.2 Route: `/employer/shortlists/:shortlistId` — Shortlist Detail

```
┌──────────────────────────────────────────────────────────────────┐
│  STABIL  Shortlists › Q3 Python Hires          [Export CSV ↓]     │
├──────────────────────────────────────────────────────────────────┤
│  ← Back to shortlists                                             │
│  Q3 Python Hires — 4 candidates          [Compare selected (0)]   │
│                                                                    │
│  ☐  Candidate A   1240/1500  Settled  ✓  Pune   [Remove] [View]  │
│  ☐  Candidate B   1105/1500  Settled     Mumbai  [Remove] [View]  │
│  ☐  Candidate D    910/1500  Somewhat    Blr     [Remove] [View]  │
│     ─ Consent withdrawn ─                    [Remove from list]   │
│                                                                    │
│  [+ Add more candidates]                                           │
└──────────────────────────────────────────────────────────────────┘
```

**Consent-withdrawn row:** When a candidate's `ShareGrant` is revoked or expired, their row shows a greyed-out "Consent withdrawn" placeholder with no name, score, or any identifying data. The "Remove from list" action is available so the employer can clean up the shortlist. This is enforced at the API level — the `ShortlistService` joins against `ShareGrant` on every query; revoked entries return only `{ profileId, consentWithdrawn: true }`.

#### 5.3.3 Data Needs

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| List shortlists | `GET /api/v1/employer/shortlists` | Returns `Shortlist[]` with entry count |
| Get shortlist detail | `GET /api/v1/employer/shortlists/:id` | Returns entries; consent-withdrawn items included as placeholders |
| Create shortlist | `POST /api/v1/employer/shortlists` | Body: `{ name: string }` |
| Add candidate to shortlist | `POST /api/v1/employer/shortlists/:id/entries` | Body: `{ profileId: string }` |
| Remove candidate from shortlist | `DELETE /api/v1/employer/shortlists/:id/entries/:profileId` | |
| Delete shortlist | `DELETE /api/v1/employer/shortlists/:id` | Confirmation dialog required |

---

## 6. Forms & Validation

The employer/recruiter pages have minimal form input. Validation uses shared Zod schemas from `packages/contracts`.

| Form | Fields | Zod schema | Notes |
|------|--------|------------|-------|
| Create shortlist | `name` (string, 1–80 chars, trimmed) | `CreateShortlistSchema` | Inline validation; error shown below field |
| Search filters | `minScore` (integer 0–1500), `maxScore` (integer 0–1500, > minScore), `location` (string, optional) | `CandidateSearchFiltersSchema` | Slider enforces bounds automatically; cross-field validation (minScore < maxScore) |

---

## 7. Accessibility

All pages must meet WCAG 2.1 AA. Key requirements for this page set:

| Requirement | Implementation |
|-------------|----------------|
| Keyboard navigation | All interactive elements (checkboxes, buttons, links, dropdowns, sliders) are keyboard-reachable and follow logical tab order |
| Chart accessibility | Every `<canvas>` chart has `role="img"` and a descriptive `aria-label`; a fallback `<table>` summary of the chart data is rendered off-screen (`sr-only`) or on toggle |
| Comparison table headers | Use `<th scope="col">` for candidate columns and `<th scope="row">` for parameter rows |
| Employer-only tag | `[E]` is rendered as `<abbr title="Employer-only field">[E]</abbr>` |
| No-consent state | `role="alert"` on the no-consent message so screen readers announce it immediately |
| Score bars | Inline score bars use `<progress value={total} max={1500} aria-label="Stability score: {total} of 1500">` or an equivalent ARIA pattern if CSS-only |
| Consent-withdrawn placeholder | Announced as "Consent withdrawn — candidate data not available" via `aria-label`; no misleading empty cells |
| Focus management | Navigating to the comparison view moves focus to the comparison panel heading; opening a modal shortlist dialog traps focus within the dialog |
| Colour independence | Tier badges and candidate colour coding in charts are not the sole differentiator — tier names are always shown as text; charts include pattern fills as an optional enhancement |
| Motion sensitivity | Chart animations respect `prefers-reduced-motion`; set `animation: false` on Chart.js when `window.matchMedia('(prefers-reduced-motion: reduce)').matches` |

---

## 8. Acceptance Criteria

### 8.1 Phase 1 — Single Report View

- [ ] **No report renders without a valid ShareGrant.** `GET /employer/report/:profileId` where no active `ShareGrant` exists for the requesting employer/recruiter returns the `<NoConsentState>` component — no score, no name, no tier, no breakdown data is visible.
- [ ] **Employer view shows age and marital status; candidate view does not.** The `ParameterLineItem[]` returned by `GET /api/v1/reports/:profileId?audience=employer` includes rows with `visibility = 'employer-only'` (age, marital status). The same report requested with `audience=candidate` (or by a candidate-role JWT) excludes these rows. An integration test asserts this for both audience values.
- [ ] **Expired consent blocks access.** When `ShareGrant.status = 'expired'`, the API returns `403` and the frontend renders the no-consent state with messaging specific to expiry.
- [ ] **Revoked consent blocks access immediately.** When `ShareGrant.revokedAt` is set, the API returns `403` on the next request; no stale data is served from TanStack Query cache (query is invalidated on a `403`).
- [ ] **PDF export is employer-audience.** The generated PDF includes age and marital status line-items and is labelled `[Employer View]` for those fields. The candidate PDF (if separately generated) never includes these.
- [ ] **Route is role-gated.** A `candidate`-role JWT calling `GET /api/v1/reports/:profileId?audience=employer` receives `403`.
- [ ] **Charts render correctly.** The block-distribution stacked Bar chart and the parameter Radar chart render without console errors; they display correctly for both Fresher and Working Professional modes.
- [ ] **Loading and error states are handled.** The page shows skeletons while the report is loading and an error banner (with retry) on non-403 failures; no raw error objects are exposed in the UI.

### 8.2 Phase 4 — Comparison Dashboard (Track 3)

- [ ] **Consent is respected at every comparison access point.** The comparison endpoint returns only candidates with active `ShareGrant`s. A candidate who revokes consent mid-session appears as a consent-withdrawn placeholder in the comparison table — no data is shown for them.
- [ ] **Search results include only consented candidates.** `GET /api/v1/employer/candidates` returns no profiles without an active `ShareGrant` for the requesting employer/recruiter. This is enforced by a SQL join in `CandidateSearchService`, not a post-filter. An integration test seeds profiles with and without grants and asserts only consented ones appear.
- [ ] **Comparison respects per-candidate consent.** In a 3-candidate comparison where one candidate revokes consent, the column for that candidate renders `<ConsentWithdrawnPlaceholder>` and the charts render only the remaining 2 datasets. No data from the revoked-consent candidate is exposed.
- [ ] **Employer-only fields appear in comparison.** Age and marital status rows appear in the comparison table when the requesting role is `employer` or `recruiter`. A unit test asserts these fields are absent from the comparison DTO when the role is `candidate`.
- [ ] **Comparison is limited to 2–4 candidates.** The "Compare" button is disabled for < 2 or > 4 selections. Navigating to `/employer/candidates/compare` with an invalid `ids` count redirects to `/employer/candidates` with an error toast.
- [ ] **Grouped Bar chart renders per-parameter, per-candidate.** Each candidate has its own colour-coded dataset; parameters not applicable to a candidate's mode show no bar (not zero) for that candidate's column. `aria-label` on the canvas identifies the chart and candidate names.
- [ ] **Overlaid Radar chart renders common-block parameters.** The radar axes are limited to common-block parameters (Communication, Location, Verification Status). Each candidate is a separate overlaid dataset. Employer-only parameters (age, marital status) are not plotted.
- [ ] **Filters persist in the URL.** Applying tier, mode, score-range, location, and verified filters updates the URL query string; refreshing the page restores the same filter state.
- [ ] **Sort by score/tier works correctly.** Sorting `score DESC` places the highest-total candidate first; sorting `tier` orders by tier severity; results change on sort change without a full page reload.
- [ ] **Shortlist CRUD is functional.** Create, open, add candidate, remove candidate, and delete shortlist all work; a shortlist entry for a candidate who revokes consent renders a consent-withdrawn placeholder on the shortlist detail page.
- [ ] **CSV export is valid.** The comparison CSV has one column per candidate and one row per parameter; it is parseable and matches the table data.
- [ ] **All employer routes return 403 for candidate role.** Every route under `/api/v1/employer/*` returns `403` for a JWT with `role = 'candidate'`. A Playwright e2e test verifies this for at least the search and compare endpoints.
- [ ] **Mobile-responsive comparison.** On viewports < 768 px, comparison is limited to 2 candidates; the filter panel collapses to a drawer; the table scrolls horizontally.

---

## 9. Security Notes

These are implementation reminders for developers, derived from [architecture/05-security-privacy.md](../../architecture/05-security-privacy.md):

1. **Never read `employer-only` fields on the frontend for a candidate-role session.** The API enforces this, but the frontend must not assume employer-only keys are present and must not attempt to render them based on field names alone.
2. **Invalidate query cache on 403.** When TanStack Query receives a `403` response, call `queryClient.removeQueries({ queryKey: ['employer-report', profileId] })` so stale data is not served if consent is re-granted and the user navigates back.
3. **Do not cache comparison results across sessions.** Comparison DTOs contain employer-only fields and consent-gated data. Set `staleTime: 0` and `gcTime: 0` on comparison queries, or ensure they are always re-fetched on mount.
4. **Audit logging.** Every successful `employer-report` fetch triggers a `report.viewed` and `employer-only-param.accessed` audit event on the backend (see [architecture/05-security-privacy.md §9](../../architecture/05-security-privacy.md)). The frontend does not need to trigger these — they are fired by the NestJS interceptor on every successful employer-audience response.
5. **Consent near-expiry warning.** When `shareGrant.expiresAt` is within 7 days, show a UI warning but do not pre-emptively block access. The `ConsentGuard` is the authoritative gate; the UI warning is informational only.
