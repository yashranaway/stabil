# Employer Search Module

> **Status:** Draft v0.1 · **Phase:** 4 · **Owner area:** backend
> **Related:**
> - [backend/modules/consent-sharing.md](consent-sharing.md) — ShareGrant lifecycle, ConsentGuard, grant status transitions
> - [phases/phase-4-enhancements.md](../../phases/phase-4-enhancements.md) — Track 3 task checklist, acceptance criteria, milestones M4.6–M4.8
> - [frontend/pages/employer-recruiter.md](../../frontend/pages/employer-recruiter.md) — comparison dashboard UI, data hooks, states, accessibility
> - [architecture/05-security-privacy.md](../../architecture/05-security-privacy.md) — RBAC, sensitive-attr visibility, audit logging
> - [architecture/02-data-model.md](../../architecture/02-data-model.md) — full ERD, indexing strategy, migration conventions
> - [backend/modules/scoring.md](scoring.md) — ScoreRun structure, latest-score query pattern

The `EmployerSearchModule` gives employers and recruiters the ability to **search, filter, sort, compare side-by-side, and shortlist candidates** from within Stabil. Every operation in this module is **strictly scoped to candidates who have given explicit per-share consent to the requesting employer or recruiter** (SCOPE §6.2). The consent join is embedded in SQL — not applied as a post-filter — so a non-consenting candidate's data is never loaded into application memory. Employer-only fields (age, marital status) are visible in the full breakdown returned to this audience (SCOPE §6.3) but are never sent to a candidate-role principal.

---

## 1. Responsibility

One purpose: **serve a consent-scoped, query-optimised interface over the scored candidate pool** for employer and recruiter principals. This module does not modify scores, does not write consent records, and does not perform document verification — it only reads from the scored profile surface and manages the employer's own shortlists.

---

## 2. Public API

All routes are prefixed `/api/v1/employer`. Every route is guarded by `JwtAuthGuard → RolesGuard(['employer','recruiter'])`. A `candidate`-role JWT returns `403 Forbidden` on any route in this module.

### 2.1 Candidate Search & Filter

#### `GET /api/v1/employer/candidates`

Search, filter, sort, and paginate the consent-scoped candidate pool.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | `string` (optional) | Full-text search over display name, location, and declared skills |
| `mode` | `'fresher' \| 'professional'` (optional) | Filter by scoring mode |
| `tier` | `'unstable' \| 'developing' \| 'somewhat-stable' \| 'settled' \| 'stable'` (optional) | Filter to a specific stability tier |
| `minScore` | `integer 0–1500` (optional) | Inclusive lower bound on total score |
| `maxScore` | `integer 0–1500` (optional) | Inclusive upper bound on total score |
| `location` | `string` (optional) | Partial match against candidate location (city / state / country) |
| `verified` | `boolean` (optional) | `true` = return only `verifiedUser = true` candidates |
| `willingToRelocate` | `boolean` (optional) | Filter on relocation willingness flag from the profile |
| `sort` | `'score' \| 'tier' \| 'name' \| 'submittedAt'` (default `'score'`) | Sort field |
| `order` | `'asc' \| 'desc'` (default `'desc'`) | Sort direction |
| `cursor` | `string` (UUID v7, optional) | Cursor for next-page retrieval (cursor-based pagination) |
| `limit` | `integer 1–100` (default `20`) | Page size |

**Response:**

```typescript
// packages/contracts/src/employer-search.ts

interface CandidateSearchPageDTO {
  items: CandidateSearchResultDTO[];
  nextCursor: string | null;   // UUID v7 of the last item; null if no further pages
  total: number;               // total matching records across all pages
}

interface CandidateSearchResultDTO {
  profileId: string;           // UUID v7
  displayName: string;
  mode: 'fresher' | 'professional';
  total: number;               // integer, 0–1500 — from the candidate's latest ScoreRun
  tier: Tier;                  // mapped from total
  location: string;
  verifiedUser: boolean;
  willingToRelocate: boolean;
  shareGrant: {
    expiresAt: string | null;  // ISO-8601 or null
  };
}
```

**Auth:** `JwtAuthGuard` → `RolesGuard(['employer','recruiter'])`
**Consent enforcement:** SQL join against `ShareGrant` (`status = 'active'`, `granteeId = requestingUserId`) in `CandidateSearchService`. No post-filter.

---

### 2.2 Side-by-Side Comparison

#### `GET /api/v1/employer/candidates/compare`

Fetch a full parameter breakdown for 2–4 candidates simultaneously. The response is shaped for direct consumption by the comparison table and charts on the frontend.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `ids` | `string` (comma-separated UUIDs v7) | 2–4 `profileId` values to compare |

**Validation:** returns `400 Bad Request` if `ids` contains fewer than 2 or more than 4 entries, or if any ID is not a valid UUID v7.

**Response:**

```typescript
interface ComparisonDTO {
  profiles: Array<ComparisonProfileDTO | ConsentWithdrawnProfileDTO>;
}

// Returned when an active ShareGrant exists for this profile
interface ComparisonProfileDTO {
  profileId: string;
  displayName: string;
  mode: 'fresher' | 'professional';
  total: number;
  tier: Tier;
  verifiedUser: boolean;
  location: string;
  breakdown: ParameterLineItem[];   // all parameters, including employer-only (age, marital status)
  consentWithdrawn: false;
}

// Returned when consent was revoked between search and compare (partial result pattern)
interface ConsentWithdrawnProfileDTO {
  profileId: string;
  consentWithdrawn: true;
  // no other fields — no name, no score, no breakdown
}

// Shared with EmployerReportDTO — sourced from the latest ScoreRun
interface ParameterLineItem {
  key: string;           // e.g. 'tenure', 'age', 'communication'
  label: string;         // e.g. 'Tenure', 'Age', 'Communication'
  block: 'mode' | 'common' | 'verification';
  visibility: 'all' | 'employer-only';
  award: number;         // integer points awarded
  max: number;           // integer maximum for this parameter
  fraction: number;      // [0, 1] normalized
  source: string;        // 'form' | 'parsed' | 'document' | 'ai-assessed'
}
```

**Design note:** the endpoint returns partial results rather than a `403` for the whole request. If one candidate's grant has lapsed, the other candidates' data is still returned alongside a `{ profileId, consentWithdrawn: true }` slot. This prevents a single revocation from destroying a multi-candidate comparison session.

**Auth:** `JwtAuthGuard` → `RolesGuard(['employer','recruiter'])` → per-profile consent check in `ComparisonService`

---

### 2.3 Comparison CSV Export

#### `GET /api/v1/employer/candidates/compare/export`

Same query parameter contract as the compare endpoint (`ids`). Returns a `text/csv` file attachment with one column per candidate and one row per parameter.

**Response headers:**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="stabil-comparison-<timestamp>.csv"
```

**CSV structure:**

```
Parameter,Candidate A,Candidate B,Candidate C
Total Score,1240,1105,980
Tier,Settled,Settled,Somewhat Stable
Mode,Professional,Fresher,Professional
Total Experience (pts),160,—,120
Tenure (pts),138,—,90
...
Age [Employer-only],32,—,28
Marital Status [Employer-only],Married,—,Single
```

Parameters not applicable to a candidate's mode are rendered as `—`. Consent-withdrawn profiles are rendered as a column with `Consent withdrawn` in every cell.

---

### 2.4 Shortlist CRUD

Shortlists are named collections of candidate `profileId` values scoped to the requesting employer or recruiter's account.

| Method | Path | Description | Body / Response |
|--------|------|-------------|-----------------|
| `GET` | `/api/v1/employer/shortlists` | List all shortlists owned by the requesting user | `Shortlist[]` (with entry count, no entries) |
| `POST` | `/api/v1/employer/shortlists` | Create a new shortlist | Body: `{ name: string }` → `Shortlist` |
| `GET` | `/api/v1/employer/shortlists/:id` | Get shortlist detail with entries | `ShortlistDetailDTO` (entries joined against active ShareGrants) |
| `POST` | `/api/v1/employer/shortlists/:id/entries` | Add a candidate to a shortlist | Body: `{ profileId: string }` → `201 Created` |
| `DELETE` | `/api/v1/employer/shortlists/:id/entries/:profileId` | Remove a candidate from a shortlist | `204 No Content` |
| `DELETE` | `/api/v1/employer/shortlists/:id` | Delete shortlist (and all its entries) | `204 No Content` |

**Response shapes:**

```typescript
interface Shortlist {
  id: string;          // UUID v7
  ownerId: string;     // employer/recruiter userId
  name: string;
  entryCount: number;
  createdAt: string;   // ISO-8601
  updatedAt: string;
}

interface ShortlistDetailDTO {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  entries: Array<ShortlistEntryDTO | ConsentWithdrawnEntryDTO>;
}

interface ShortlistEntryDTO {
  profileId: string;
  displayName: string;
  total: number;
  tier: Tier;
  location: string;
  verifiedUser: boolean;
  addedAt: string;       // ISO-8601
  shareGrant: {
    expiresAt: string | null;
  };
  consentWithdrawn: false;
}

interface ConsentWithdrawnEntryDTO {
  profileId: string;
  addedAt: string;
  consentWithdrawn: true;
  // no other fields
}
```

**Auth:** All shortlist routes: `JwtAuthGuard` → `RolesGuard(['employer','recruiter'])`. Ownership of the shortlist (`:id` must be owned by `requestingUserId`) is enforced in `ShortlistService` — other employers cannot read or modify each other's shortlists.

---

## 3. Data Model Touched

### 3.1 New models (Phase 4 — employer-search module owns these)

```prisma
model Shortlist {
  id        String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ownerId   String          @db.Uuid         // FK → User.id (employer or recruiter)
  name      String
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  entries   ShortlistEntry[]

  @@index([ownerId])
}

model ShortlistEntry {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  shortlistId String    @db.Uuid
  profileId   String    @db.Uuid
  addedAt     DateTime  @default(now())

  shortlist   Shortlist @relation(fields: [shortlistId], references: [id], onDelete: Cascade)

  @@unique([shortlistId, profileId])           // prevent duplicate entries
  @@index([profileId])                         // for consent-revocation sweeps
}
```

### 3.2 Read-only access to existing models

The module reads (never writes) the following models owned by other modules:

| Model | Owner module | What is read |
|-------|-------------|--------------|
| `CandidateProfile` | `profiles` | `displayName`, `mode`, `location`, `verifiedUser`, `willingToRelocate` |
| `ScoreRun` | `scoring` | `total`, `tier`, `breakdown` — **latest run only** (see §5 for indexing strategy) |
| `ShareGrant` | `consent-sharing` | `granteeId`, `profileId`, `status`, `expiresAt` — only `status = 'active'` rows enter results |
| `User` | `auth-accounts` | `id`, `role` — for ownership checks on shortlists |

---

## 4. Dependencies

| Dependency | Notes |
|------------|-------|
| **`consent-sharing` module** | `ShareGrant` table is the authoritative consent record. This module joins against it in every query. It does not write to it. See [consent-sharing.md](consent-sharing.md). |
| **`scoring` module** | Provides the latest `ScoreRun` per profile. The indexing strategy in §5 ensures this join is fast. |
| **`profiles` module** | Source of `CandidateProfile` display fields (name, location, verified status). |
| **`auth-accounts` module** | JWT principal contains `userId` and `role`; shortlist ownership is validated against `userId`. |
| **`@stabil/scoring` package** | `Tier` enum and `ParameterLineItem` types are re-exported from the shared contracts package (`packages/contracts`). |
| **`fast-csv`** | CSV serialisation for the export endpoint. |
| **Postgres full-text search** | `to_tsvector` / `plainto_tsquery` for the `q` (free-text) filter — GIN index on `profiles.location` and `profiles.skills`. |

---

## 5. Indexing & Latest-Score Strategy

Scoring a candidate multiple times over their account lifetime (SCOPE §2 decision 17) means `ScoreRun` is an append-only history table. The employer search always needs the **latest** run per profile. Two viable strategies are documented below; the default is the **materialized latest-score view**.

### 5.1 Materialized latest-score column (recommended default)

Add a `latestScoreRunId` foreign key and a denormalized `latestTotal` + `latestTier` on `CandidateProfile`. These are updated in the same database transaction as every new `ScoreRun` write (in the `scoring` module).

```prisma
// Addition to CandidateProfile (owned by profiles module; employer-search module reads it)
model CandidateProfile {
  // ... existing fields ...
  latestScoreRunId String?   @db.Uuid   // FK → ScoreRun.id; null if never scored
  latestTotal      Int?                  // integer 0–1500; null if never scored
  latestTier       String?               // Tier enum value; null if never scored
}
```

**Why:** avoids a correlated subquery or `LATERAL JOIN` on every search request. Filtering by score/tier hits `CandidateProfile` directly using a B-tree index — no join to `ScoreRun` required for the search list view.

**Index set:**

```sql
-- Score and tier filters on CandidateProfile (materialized latest)
CREATE INDEX idx_profiles_latest_total ON candidate_profiles(latest_total DESC NULLS LAST);
CREATE INDEX idx_profiles_latest_tier  ON candidate_profiles(latest_tier);

-- Consent join (most-accessed index in this module)
CREATE INDEX idx_consent_grants_active
  ON share_grants(grantee_id, profile_id, status)
  WHERE status = 'active';

-- Full-text search on location (and optionally skills)
CREATE INDEX idx_profiles_location_fts
  ON candidate_profiles USING GIN(to_tsvector('english', location));

-- Shortlist entry lookup by profileId (consent revocation sweep)
CREATE INDEX idx_shortlist_entries_profile ON shortlist_entries(profile_id);
```

### 5.2 Alternative: indexed subquery (no schema change)

If the materialized column is not adopted, use a `LATERAL JOIN` to select the most recent `ScoreRun` per profile:

```sql
SELECT cp.*, sr.total, sr.tier
FROM candidate_profiles cp
JOIN share_grants sg
  ON sg.profile_id = cp.id
  AND sg.grantee_id = :requestingUserId
  AND sg.status = 'active'
JOIN LATERAL (
  SELECT total, tier, breakdown, created_at
  FROM score_runs
  WHERE profile_id = cp.id
  ORDER BY created_at DESC
  LIMIT 1
) sr ON TRUE
WHERE /* filters */
ORDER BY sr.total DESC
LIMIT :limit;
```

This requires:

```sql
CREATE INDEX idx_score_runs_profile_created
  ON score_runs(profile_id, created_at DESC);
```

The LATERAL approach incurs a per-row subquery; at low candidate volumes it is acceptable. At scale (>10 k consented candidates per employer), the materialized column is strongly preferred.

---

## 6. Key Flows

### 6.1 Candidate Search Flow

```mermaid
sequenceDiagram
    participant ER as Employer / Recruiter
    participant FE as apps/web
    participant API as NestJS API<br/>(EmployerSearchModule)
    participant DB as PostgreSQL

    ER->>FE: Enter search query / apply filters
    FE->>API: GET /api/v1/employer/candidates?tier=settled&minScore=1000&sort=score&cursor=<uuid>
    API->>API: JwtAuthGuard: extract userId, role
    API->>API: RolesGuard: assert role IN (employer, recruiter)
    API->>API: CandidateSearchService: build Prisma query
    API->>DB: SELECT cp.*, sg.expires_at<br/>FROM candidate_profiles cp<br/>JOIN share_grants sg ON sg.profile_id = cp.id<br/>  AND sg.grantee_id = :userId AND sg.status = 'active'<br/>WHERE cp.latest_tier = 'settled'<br/>  AND cp.latest_total >= 1000<br/>  AND cp.id > :cursor<br/>ORDER BY cp.latest_total DESC<br/>LIMIT 21
    DB-->>API: Consented + matching candidate rows (max 21 to detect hasNextPage)
    API->>API: Build CandidateSearchPageDTO<br/>(slice to 20; derive nextCursor from item 21 if present)
    API-->>FE: 200 OK { items, nextCursor, total }
    FE-->>ER: Render result list; enable Compare button when ≥ 2 selected
```

### 6.2 Side-by-Side Comparison Flow

```mermaid
sequenceDiagram
    participant ER as Employer / Recruiter
    participant FE as apps/web
    participant API as NestJS API<br/>(EmployerSearchModule)
    participant DB as PostgreSQL

    ER->>FE: Select 2–4 candidates → click "Compare"
    FE->>API: GET /api/v1/employer/candidates/compare?ids=a,b,c
    API->>API: Validate: 2 ≤ ids.length ≤ 4, all valid UUID v7
    loop For each profileId in ids
        API->>DB: SELECT sg.status FROM share_grants sg<br/>WHERE sg.profile_id = :profileId<br/>  AND sg.grantee_id = :userId AND sg.status = 'active'
        alt Active grant found
            API->>DB: SELECT latest ScoreRun breakdown + CandidateProfile fields
            DB-->>API: Profile + full breakdown (including employer-only parameters)
            API->>API: filterForAudience('employer') — all visibility levels included
            API->>API: Append ComparisonProfileDTO to result
        else No active grant
            API->>API: Append ConsentWithdrawnProfileDTO { profileId, consentWithdrawn: true }
        end
    end
    API-->>FE: 200 OK ComparisonDTO { profiles: [...] }
    FE-->>ER: Render comparison table; chart only consented candidates' datasets
```

### 6.3 Shortlist Add / Consent-Revocation Auto-Hide Flow

```mermaid
sequenceDiagram
    participant ER as Employer / Recruiter
    participant FE as apps/web
    participant API as NestJS API<br/>(EmployerSearchModule)
    participant DB as PostgreSQL

    ER->>FE: Add candidate to shortlist
    FE->>API: POST /api/v1/employer/shortlists/:id/entries { profileId }
    API->>API: ShortlistService: assert shortlist.ownerId === requestingUserId
    API->>DB: INSERT INTO shortlist_entries (shortlist_id, profile_id) ON CONFLICT DO NOTHING
    DB-->>API: Created / already exists
    API-->>FE: 201 Created

    Note over ER,DB: Later — candidate revokes consent

    ER->>FE: Open shortlist detail
    FE->>API: GET /api/v1/employer/shortlists/:id
    API->>DB: SELECT se.profile_id, se.added_at,<br/>  cp.display_name, cp.latest_total, cp.latest_tier, ...<br/>  sg.status AS grant_status<br/>FROM shortlist_entries se<br/>LEFT JOIN candidate_profiles cp ON cp.id = se.profile_id<br/>LEFT JOIN share_grants sg<br/>  ON sg.profile_id = se.profile_id<br/>  AND sg.grantee_id = :userId AND sg.status = 'active'<br/>WHERE se.shortlist_id = :shortlistId
    DB-->>API: Rows; revoked-consent candidate has NULL sg.status
    API->>API: For each row: if grant_status IS NULL → ConsentWithdrawnEntryDTO
    API-->>FE: ShortlistDetailDTO { entries: [...ConsentWithdrawnEntryDTO...] }
    FE-->>ER: Grayed-out "Consent withdrawn" row — no candidate data shown
```

---

## 7. Validation & Errors

All input is validated via shared Zod schemas from `packages/contracts` before reaching the service layer. Validation errors return `400 Bad Request` with RFC 9457 `application/problem+json` bodies.

### 7.1 Search query validation

```typescript
// packages/contracts/src/employer-search.ts
import { z } from 'zod';
import { TierEnum } from './scoring';

export const CandidateSearchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  mode: z.enum(['fresher', 'professional']).optional(),
  tier: TierEnum.optional(),
  minScore: z.coerce.number().int().min(0).max(1500).optional(),
  maxScore: z.coerce.number().int().min(0).max(1500).optional(),
  location: z.string().max(200).optional(),
  verified: z.coerce.boolean().optional(),
  willingToRelocate: z.coerce.boolean().optional(),
  sort: z.enum(['score', 'tier', 'name', 'submittedAt']).default('score'),
  order: z.enum(['asc', 'desc']).default('desc'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine(
  (data) => data.minScore === undefined || data.maxScore === undefined || data.minScore <= data.maxScore,
  { message: 'minScore must be ≤ maxScore', path: ['minScore'] }
);
```

### 7.2 Compare endpoint validation

```typescript
export const CompareIdsSchema = z.object({
  ids: z
    .string()
    .transform((s) => s.split(','))
    .pipe(
      z.array(z.string().uuid()).min(2, 'At least 2 candidate IDs required')
                                 .max(4, 'At most 4 candidates can be compared')
    ),
});
```

### 7.3 Shortlist mutations

```typescript
export const CreateShortlistSchema = z.object({
  name: z.string().min(1).max(80).trim(),
});

export const AddShortlistEntrySchema = z.object({
  profileId: z.string().uuid(),
});
```

### 7.4 Error table

| Scenario | HTTP status | `type` (RFC 9457) | Notes |
|----------|-------------|-------------------|-------|
| Caller is `candidate` role | `403 Forbidden` | `errors/forbidden` | RolesGuard fires before any data is read |
| Invalid `ids` count (compare) | `400 Bad Request` | `errors/validation` | Returned before any DB query |
| Invalid UUID in `ids` | `400 Bad Request` | `errors/validation` | — |
| `minScore > maxScore` | `400 Bad Request` | `errors/validation` | Cross-field Zod refinement |
| Shortlist not found | `404 Not Found` | `errors/not-found` | — |
| Shortlist not owned by requester | `403 Forbidden` | `errors/forbidden` | ShortlistService ownership check |
| Duplicate shortlist entry | `409 Conflict` | `errors/conflict` | Deduplication via `@@unique` constraint — surface gracefully |
| No candidates match filters | `200 OK` | — | Empty `items: []` array; not a 404 |
| All requested profiles have `consentWithdrawn: true` (compare) | `200 OK` | — | Returns `ComparisonDTO` with all slots as `ConsentWithdrawnProfileDTO`; frontend handles full empty state |

---

## 8. Security & Permissions

### 8.1 Consent-scoped result set — the invariant

**No response from this module ever contains data for a candidate who has not granted an active `ShareGrant` to the requesting employer or recruiter.** This invariant is enforced at the SQL layer:

- **Search:** the `CandidateSearchService` Prisma query INNER JOINs `ShareGrant` with `WHERE sg.grantee_id = :userId AND sg.status = 'active'`. A profile with a revoked, expired, or non-existent grant never appears in the result set.
- **Compare:** `ComparisonService` checks each `profileId` against an active `ShareGrant` query before fetching breakdown data. Profiles without an active grant return `ConsentWithdrawnProfileDTO` — no breakdown, no score, no name.
- **Shortlist detail:** `ShortlistService.getDetail` LEFT JOINs `ShareGrant` and maps any row with `sg.status IS NULL` (or not `'active'`) to `ConsentWithdrawnEntryDTO`. This runs on every shortlist detail fetch so revocations take effect immediately.

> This approach means consent enforcement is never dependent on application-layer logic that could be bypassed; the database query itself is the gate.

### 8.2 Audience visibility — employer-only fields

When `ComparisonService` assembles a `ComparisonProfileDTO`, it calls `filterForAudience(breakdown, 'employer')` from the shared report-assembly layer (owned by the `reports-pdf` module). This function retains `ParameterLineItem` entries with both `visibility = 'all'` and `visibility = 'employer-only'` (age, marital status — SCOPE §6.3, §4.4). Because these routes are guarded by `RolesGuard(['employer','recruiter'])`, a `candidate`-role JWT never reaches `filterForAudience` in this module.

### 8.3 Shortlist ownership isolation

Shortlists are scoped to their `ownerId`. `ShortlistService` always includes `WHERE shortlist.owner_id = :requestingUserId` on every read and mutation query. There is no cross-account shortlist sharing in Phase 4 (out of scope).

### 8.4 Audit logging

Every successful response from `GET /employer/candidates/compare` fires an `employer-only-param.accessed` audit event (via NestJS interceptor) that records `{ requestingUserId, profileIds, timestamp }`. This log is required for compliance review (see [architecture/05-security-privacy.md](../../architecture/05-security-privacy.md)).

### 8.5 Permissions summary

| Action | Allowed roles |
|--------|---------------|
| Search candidates | `employer`, `recruiter` |
| Compare candidates | `employer`, `recruiter` |
| Export comparison CSV | `employer`, `recruiter` |
| Create / manage shortlists | `employer`, `recruiter` (own shortlists only) |
| Read another user's shortlist | None — forbidden |
| Access any `/employer/*` route | Forbidden for `candidate`, `admin` without employer/recruiter role |

---

## 9. Phased Implementation

This module is entirely a **Phase 4** deliverable (SCOPE §9 — "Post-POC / later enhancements"). It has no Phase 1–3 sub-stages within the module itself, but it depends on Phase 1–3 being complete and stable.

| Milestone | Deliverable | Depends on |
|-----------|-------------|------------|
| **M4.6a** — Prisma models | `Shortlist`, `ShortlistEntry` models + migration; all performance indexes created | Phase 0 (monorepo, DB) |
| **M4.6b** — `CandidateSearchService` | Search, filter, sort, cursor-pagination with consent-join; unit-tested with mocked Prisma | Phase 1 (`ShareGrant` table from consent-sharing; `CandidateProfile` with latest-score columns) |
| **M4.6c** — `ComparisonService` | Full breakdown fetch for 2–4 profiles; `filterForAudience('employer')`; partial consent-withdrawn handling | Phase 1 (`ScoreRun`, `reports-pdf` filterForAudience); Phase 4 indexes from M4.6a |
| **M4.6d** — `ShortlistService` | CRUD + consent-revocation auto-hide; ownership enforcement | M4.6a (Shortlist models) |
| **M4.6e** — CSV export | `fast-csv` serialisation of comparison DTO | M4.6c |
| **M4.6f** — Integration tests | Consent enforcement tests, shortlist consent-withdrawal test (see §10) | M4.6b–d |
| **M4.7** — Frontend | Employer comparison dashboard (see [frontend/pages/employer-recruiter.md §5](../../frontend/pages/employer-recruiter.md)) | M4.6a–f |
| **M4.8** — Phase 4 QA | All Track 3 acceptance criteria met; performance validated at representative data volumes | M4.7 |

---

## 10. Testing

### 10.1 Unit tests (Vitest — mocked Prisma)

#### `CandidateSearchService`

```typescript
// apps/api/src/employer-search/candidate-search.service.spec.ts

describe('CandidateSearchService', () => {
  it('never returns a candidate without an active ShareGrant', async () => {
    // Seed: profile P1 with active grant; profile P2 with revoked grant
    // Assert: result contains only P1
  });

  it('filters by tier correctly', async () => {
    // Seed: P1 (tier: settled), P2 (tier: developing)
    // Query: { tier: 'settled' }
    // Assert: only P1 in result
  });

  it('filters by score range correctly', async () => {
    // Query: { minScore: 1000, maxScore: 1300 }
    // Assert: only profiles with latest_total in [1000, 1300] returned
  });

  it('cursor pagination returns correct next page', async () => {
    // Seed 25 consented profiles
    // First call: limit=20, cursor undefined → 20 results, nextCursor set
    // Second call: cursor=<nextCursor> → remaining 5 results, nextCursor null
  });

  it('returns empty items when no candidates match filters', async () => {
    // Assert: 200 OK, items: [], total: 0 — not a 404
  });
});
```

#### `ComparisonService`

```typescript
describe('ComparisonService', () => {
  it('returns ConsentWithdrawnProfileDTO for a revoked-grant profile', async () => {
    // P1: active grant; P2: revoked grant
    // Assert: result[0].consentWithdrawn = false (with data); result[1].consentWithdrawn = true (no data)
  });

  it('includes employer-only parameters (age, marital status) in breakdown', async () => {
    // Assert: breakdown contains a row with key='age' and visibility='employer-only'
  });

  it('does not expose employer-only fields when role is candidate', async () => {
    // This test is to document the guard contract — a candidate JWT returns 403
    // before ComparisonService is reached; the guard is tested separately
  });
});
```

#### `ShortlistService`

```typescript
describe('ShortlistService', () => {
  it('returns ConsentWithdrawnEntryDTO for a shortlist entry whose grant was revoked', async () => {
    // Seed: shortlist with entry for P1; revoke P1 grant
    // Assert: getDetail returns entry with consentWithdrawn: true, no name/score
  });

  it('rejects access to a shortlist owned by another user', async () => {
    // Assert: ShortlistService.getDetail throws ForbiddenException
  });

  it('deduplicates shortlist entries', async () => {
    // Add same profileId twice → second add returns 409 Conflict
  });
});
```

### 10.2 Integration tests (supertest + test DB)

```
MUST PASS before Phase 4 ships:

1. Search consent enforcement (critical)
   - Seed: 5 profiles with active grants for employer U1, 3 profiles with revoked/no grants
   - GET /api/v1/employer/candidates (authenticated as U1)
   - Assert: response contains exactly 5 profiles, none of the 3 non-consenting profiles
   - Assert: revoke one grant → re-query → 4 profiles

2. Compare partial consent withdrawal
   - Seed: P1 (active grant), P2 (revoke grant mid-session)
   - GET /employer/candidates/compare?ids=P1,P2
   - Assert: profiles[0] has full data (consentWithdrawn: false)
   - Assert: profiles[1] = { profileId: P2, consentWithdrawn: true } — no other fields

3. Shortlist consent-revocation auto-hide
   - Create shortlist; add P1 and P2 (both active grants)
   - Revoke P2's grant
   - GET /employer/shortlists/:id
   - Assert: P1 entry returns displayName + score; P2 entry returns consentWithdrawn: true

4. Role enforcement
   - All /api/v1/employer/* routes called with candidate-role JWT → 403 every time

5. CSV export
   - Compare P1, P2 → export CSV
   - Assert: valid CSV; one column per candidate; employer-only rows labelled [Employer-only]
```

### 10.3 End-to-end tests (Playwright)

```
1. Employer search and compare happy path
   - Log in as employer → navigate to /employer/candidates
   - Assert: only consented candidates visible
   - Apply tier=settled filter → results change
   - Select 2 candidates → click Compare → comparison panel renders
   - Verify employer-only rows (Age, Marital Status) appear in table

2. Consent enforcement in browser
   - Log in as employer → search results show candidate P1
   - In a separate session, revoke P1's consent
   - Employer refreshes search → P1 no longer appears

3. Shortlist management
   - Create shortlist "Test List"
   - Add candidate from search → shortlist badge shows count = 1
   - Navigate to shortlist detail → candidate row visible with score
   - Remove candidate → list empty
   - Delete shortlist → no longer appears in list
```

### 10.4 Security test (automated, runs in CI)

```typescript
// Verifies the consent-join invariant at the query level
it('SQL query for search always contains the ShareGrant join with status=active filter', () => {
  // Inspect the Prisma query log for the search endpoint
  // Assert: every executed SELECT includes a JOIN/WHERE referencing share_grants.status = 'active'
  // This is a belt-and-suspenders check — the unit tests above are the primary gate
});
```

---

## 11. Best Practices & Gotchas

### Consent join must be in SQL, never a post-filter

The pattern `fetch all profiles → filter out non-consenting` is **prohibited**. It loads PII into application memory before checking consent. The consent join must be part of the `WHERE` clause or a SQL `JOIN` condition. Code review should reject any PR that deviates from this.

### Cursor pagination over UUID v7 is safe for score-ordered results

When sorting by `score DESC` with cursor pagination, the cursor must encode both the `total` value and the `profileId` to handle ties (two candidates with identical scores). The cursor encodes `{ total, profileId }` and the WHERE clause is:

```sql
WHERE (cp.latest_total, cp.id) < (:cursorTotal, :cursorId)
ORDER BY cp.latest_total DESC, cp.id DESC
```

### Consent revocation takes effect on the next query — no cache grace period

Unlike some systems that allow a short cache window, Stabil's consent model requires that revocation is effective on the **next request**. TanStack Query on the frontend sets `staleTime: 0` on employer search and comparison queries (see [frontend/pages/employer-recruiter.md §9](../../frontend/pages/employer-recruiter.md)). The backend never caches ShareGrant status.

### The `latestTotal` / `latestTier` columns must be written atomically with each `ScoreRun`

The `scoring` module is responsible for keeping `CandidateProfile.latestTotal`, `latestTier`, and `latestScoreRunId` in sync. If the `scoring` module writes a new `ScoreRun` and fails to update these columns (e.g. due to a crash), employer search will show stale data. The update must be in the **same Prisma transaction** as the `ScoreRun` insert. Add a health-check assertion in CI that verifies `COUNT(*) WHERE latestScoreRunId IS NULL AND EXISTS (SELECT 1 FROM score_runs WHERE profile_id = cp.id)` returns 0 on the test DB after any scoring-related migration.

### Employer-only fields in CSV export must be labelled

Any export that includes `visibility = 'employer-only'` parameters must label them (e.g. `Age [Employer-only]`) so the exported file is unambiguous for compliance audits. Never strip these labels from the CSV or PDF.

### Comparison is limited to 4 candidates — enforce at the API, not just the UI

The 4-candidate limit exists to bound query cost and response size. The API must validate `ids.length ≤ 4` with a `400` response, not rely on the frontend to enforce it. Set a query timeout on the comparison query (e.g. 5 s) to prevent unbounded execution if indexes are missing.

### Shortlist entries for non-consenting candidates are retained, not deleted

When a candidate revokes consent, their `ShortlistEntry` rows are **not deleted** automatically. The employer sees a consent-withdrawn placeholder and can choose to remove the entry manually. This design preserves the employer's shortlist structure while hiding the candidate's data — deleting the entry automatically could surprise the employer with a silently shrinking shortlist.
