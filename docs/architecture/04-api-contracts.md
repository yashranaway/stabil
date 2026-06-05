# REST API Contracts

> **Status:** Draft v0.1 · **Phase:** cross-cutting · **Owner area:** backend
> **Related:** [01-overview.md](./01-overview.md), [02-data-model.md](./02-data-model.md), [03-scoring-engine.md](./03-scoring-engine.md), [05-security-privacy.md](./05-security-privacy.md), [../backend/api-conventions.md](../backend/api-conventions.md), [../backend/modules/README.md](../backend/modules/README.md)

This document is the authoritative HTTP contract for the Stabil NestJS API. It defines the URL conventions, auth model, error envelope, pagination, idempotency, and every endpoint grouped by resource — with method, path, required roles, request/response DTO types (TypeScript), status codes, and example payloads. It stays 100% consistent with [SCOPE.md](../SCOPE.md) and the canonical facts in [../README.md](../README.md). Every endpoint maps to a NestJS module under [../backend/modules/](../backend/modules/README.md).

---

## 1. Conventions

### 1.1 Base, versioning, content type

- **Base URL:** all endpoints are prefixed `/api/v1`. Breaking changes ship under a new prefix (`/api/v2`); additive fields are non-breaking.
- **Content type:** `application/json; charset=utf-8` for request and response bodies, except presigned binary uploads (sent **directly to MinIO**, not the API — see [§9](#9-documents)).
- **IDs:** UUID **v7** primary keys everywhere (time-sortable; see [../README.md](../README.md) cheat-sheet). All `id` path params and DTO id fields are UUID v7 strings.
- **Timestamps:** ISO‑8601 UTC strings (`2026-06-06T12:34:56.000Z`).
- **Points/scores:** integers (`Math.round`); score scale is fixed `0–1500` (SCOPE §4.1).
- **Enums** (shared with `@stabil/scoring`, see [domain.ts](../../packages/scoring/src/domain.ts)):
  `Mode = fresher|professional`, `Block = mode|common|verification`,
  `Visibility = all|employer-only`, `Audience = candidate|employer|recruiter`,
  `Tier = unstable|developing|somewhat-stable|settled|stable`,
  `Role = candidate|employer|recruiter|admin`.

### 1.2 DTOs, validation & OpenAPI generation

Every request/response shape is defined once as a **Zod schema** in `packages/contracts` (shared by API, web, and mobile — SCOPE §10 "Validation"). NestJS validates incoming bodies/queries/params with a Zod pipe; on failure it emits a `422` problem+json (see [§1.5](#15-error-model-rfc-9457)). The TypeScript `type` shown for each endpoint is `z.infer<typeof Schema>`.

```ts
// packages/contracts/src/common.ts
import { z } from "zod";

export const Mode = z.enum(["fresher", "professional"]);
export const Block = z.enum(["mode", "common", "verification"]);
export const Visibility = z.enum(["all", "employer-only"]);
export const Audience = z.enum(["candidate", "employer", "recruiter"]);
export const Tier = z.enum(["unstable", "developing", "somewhat-stable", "settled", "stable"]);
export const Role = z.enum(["candidate", "employer", "recruiter", "admin"]);
export const Uuid = z.string().uuid(); // v7, validated for shape
```

**OpenAPI:** the spec at `GET /api/v1/openapi.json` (and Swagger UI at `/api/v1/docs`, non-prod only) is **generated from the Zod schemas** via `@anatine/zod-openapi` + `@nestjs/swagger`. The Zod schemas are the single source of truth — the OpenAPI document is a build artifact, never hand-edited. Generated TS clients for web/mobile are produced from this spec.

### 1.3 Auth: JWT access + refresh

Auth is role-based (candidate / employer / recruiter / admin) with **JWT access + refresh** tokens (SCOPE §10 "Auth"). See [05-security-privacy.md](./05-security-privacy.md) for token storage, rotation, and threat model, and [../backend/modules/auth-accounts.md](../backend/modules/auth-accounts.md) for the module internals.

| Token | Lifetime | Carries | Sent as |
|-------|----------|---------|---------|
| **Access** | 15 min | `sub` (userId), `role`, `email`, `jti` | `Authorization: Bearer <access>` |
| **Refresh** | 30 days, rotating | `sub`, `jti`, `family` | request body to `/auth/refresh` (mobile) **or** `HttpOnly` cookie (web) |

- Access-token claims (`AccessClaims`):

```ts
export interface AccessClaims {
  sub: string;        // user id (UUID v7)
  role: "candidate" | "employer" | "recruiter" | "admin";
  email: string;
  jti: string;        // token id
  iat: number;
  exp: number;
}
```

- **Guards:** a global `JwtAuthGuard` protects everything except endpoints marked `@Public()` (the AUTH group below). A `@Roles(...)` decorator + `RolesGuard` enforces role membership; ownership (e.g. "this profile is mine") is checked in the resource service. Insufficient role → `403`; missing/expired token → `401`.
- Refresh tokens **rotate** on every use; replaying a consumed refresh token revokes the whole token family (`401`, type `token-reuse-detected`).

### 1.4 Standard headers

| Header | Direction | Purpose |
|--------|-----------|---------|
| `Authorization: Bearer <jwt>` | request | Access token (all non-public endpoints). |
| `Idempotency-Key: <uuid>` | request | Required on `POST /scoring/runs`; optional/recommended on other unsafe POSTs (see [§1.6](#16-idempotency)). |
| `X-Request-Id` | both | Correlation id; echoed back, generated if absent. |
| `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` | response | Rate-limit state (see [§1.7](#17-rate-limiting)). |
| `Retry-After` | response | On `429` / `503`, seconds to wait. |

### 1.5 Error model (RFC 9457)

All errors use **`application/problem+json`** (RFC 9457). Shape:

```ts
export interface ProblemDetails {
  type: string;        // URN-ish slug: "https://stabil.app/problems/<slug>"
  title: string;       // short human summary
  status: number;      // HTTP status, mirrors response code
  detail?: string;     // human-readable specifics
  instance?: string;   // request path that produced the error
  requestId?: string;  // X-Request-Id for support correlation
  errors?: FieldError[]; // present on 422 validation failures
}
export interface FieldError {
  path: string;        // e.g. "answers.totalExperienceYears"
  message: string;     // Zod message
  code: string;        // Zod issue code, e.g. "too_small"
}
```

Example `422`:

```json
{
  "type": "https://stabil.app/problems/validation-failed",
  "title": "Request validation failed",
  "status": 422,
  "detail": "1 field is invalid.",
  "instance": "/api/v1/submissions/professional",
  "requestId": "req_01HZ...",
  "errors": [
    { "path": "answers.totalExperienceYears", "message": "Number must be >= 0", "code": "too_small" }
  ]
}
```

**Common problem types** (slug → status): `validation-failed` (422), `unauthenticated` (401), `token-reuse-detected` (401), `forbidden` (403), `not-found` (404), `conflict` (409), `idempotency-key-conflict` (409), `consent-required` (403), `share-expired` (410), `rate-limited` (429), `payload-too-large` (413), `unsupported-media-type` (415), `internal` (500), `upstream-unavailable` (503).

### 1.6 Idempotency

Unsafe POSTs that create side-effects accept an **`Idempotency-Key`** header (client-generated UUID). It is **required** for `POST /scoring/runs` (a score run is expensive and re-scoring must be safe to retry; SCOPE §11 "improvement loop") and recommended for share creation and PDF requests.

Semantics:
- Key + userId + endpoint + request-body-hash are stored for 24h.
- **Same key + same body** → the original response is replayed (same status, body, and a `Idempotency-Replayed: true` header).
- **Same key + different body** → `409 idempotency-key-conflict`.
- Missing key on `POST /scoring/runs` → `400` (`idempotency-key-required`).

### 1.7 Rate limiting

Token-bucket per user (or per IP for public auth endpoints). Exceeding a bucket → `429 rate-limited` with `Retry-After`. Indicative buckets:

| Bucket | Endpoints | Limit |
|--------|-----------|-------|
| `auth` | `/auth/login`, `/auth/register`, `/auth/refresh` | 10 / min / IP |
| `scoring` | `POST /scoring/runs` | 20 / hour / user |
| `uploads` | `POST /documents/upload-url`, `/documents/confirm` | 60 / hour / user |
| `default` | everything else | 300 / min / user |

### 1.8 Cursor pagination

List endpoints use **opaque cursor pagination** (not offset). Query params: `?limit=<1..100, default 20>&cursor=<opaque>`. Response envelope:

```ts
export interface Paginated<T> {
  data: T[];
  page: {
    nextCursor: string | null;   // null = last page
    limit: number;
  };
}
```

The cursor encodes `(createdAt, id)` of the last item (base64url). Results are ordered by `createdAt DESC, id DESC` unless an endpoint states otherwise.

### 1.9 Audience-aware responses

Some responses (most importantly the **report**, [§13](#13-reports)) are filtered by the **caller's relationship to the profile**. A candidate viewing their own report sees `audience: "candidate"` with **sensitive line-items suppressed** (age, marital status — SCOPE §6.3 / §8). An employer/recruiter who has been granted a share sees `audience: "employer"|"recruiter"` with the **full** breakdown. The **total and tier are identical** across audiences; only the itemized `breakdown` differs. This is enforced server-side using the `Visibility` field on each parameter (see [domain.ts](../../packages/scoring/src/domain.ts) `AudienceScoreResult`) — never by the client.

---

## 2. Endpoint index

| Group | Endpoints | Module |
|-------|-----------|--------|
| [Auth](#3-auth) | register · login · refresh · logout | [auth-accounts.md](../backend/modules/auth-accounts.md) |
| [Profiles](#4-profiles) | create · get · list mine · employer-submit · claim | [profiles.md](../backend/modules/profiles.md) |
| [Submissions](#5-submissions) | save/replace answers · get current | [profiles.md](../backend/modules/profiles.md) |
| [Scoring](#6-scoring) | run (idempotent) · get run · history | [scoring.md](../backend/modules/scoring.md) |
| [Documents](#9-documents) | upload-url · confirm · list · delete | [documents-storage.md](../backend/modules/documents-storage.md) |
| [Verification](#10-verification) | submit · status · admin approve/reject | [verification.md](../backend/modules/verification.md) |
| [Consent / Shares](#11-consentshares) | create · list · revoke · accept | [consent-sharing.md](../backend/modules/consent-sharing.md) |
| [Reports](#13-reports) | get (audience-aware) · request PDF · download | [reports-pdf.md](../backend/modules/reports-pdf.md) |
| [Employer search/compare](#14-employer-searchcompare-phase-4) | search · compare · shortlist CRUD | [employer-search.md](../backend/modules/employer-search.md) |
| [Account](#15-account) | update · request-data-deletion | [auth-accounts.md](../backend/modules/auth-accounts.md) |
| [Notifications](#16-notifications) | list · mark read | [notifications.md](../backend/modules/notifications.md) |

---

## 3. Auth

Module: [auth-accounts.md](../backend/modules/auth-accounts.md). All endpoints here are `@Public()` (no access token required) **except** `/auth/logout`.

### `POST /auth/register`

Create a user account and return tokens. `role` is restricted to self-serve roles; `admin` is provisioned out-of-band.

- **Auth:** public · **Rate bucket:** `auth`

```ts
export type RegisterRequest = {
  email: string;            // z.string().email()
  password: string;         // z.string().min(10)
  displayName: string;      // z.string().min(1).max(120)
  role: "candidate" | "employer" | "recruiter"; // not "admin"
  organizationName?: string; // required when role ∈ {employer, recruiter}
};

export type AuthResponse = {
  user: { id: string; email: string; displayName: string; role: Role };
  accessToken: string;      // JWT, 15 min
  refreshToken: string;     // JWT, 30 days (mobile); web also gets HttpOnly cookie
  expiresIn: number;        // access token TTL seconds (900)
};
```

- **Status:** `201` created · `409 conflict` (email taken) · `422` validation.

Example request / response:

```json
// POST /api/v1/auth/register
{ "email": "asha@example.com", "password": "correct-horse-battery", "displayName": "Asha R", "role": "candidate" }
```
```json
// 201 Created
{
  "user": { "id": "0190a1...", "email": "asha@example.com", "displayName": "Asha R", "role": "candidate" },
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "eyJhbGciOi...",
  "expiresIn": 900
}
```

### `POST /auth/login`

- **Auth:** public · **Rate bucket:** `auth`

```ts
export type LoginRequest = { email: string; password: string };
// → AuthResponse
```

- **Status:** `200` · `401 unauthenticated` (bad credentials — generic message, no user enumeration) · `422`.

### `POST /auth/refresh`

Exchange a valid (un-consumed) refresh token for a new access+refresh pair (rotation).

- **Auth:** public (presents refresh token) · **Rate bucket:** `auth`

```ts
export type RefreshRequest = { refreshToken?: string }; // omit when using HttpOnly cookie (web)
// → AuthResponse
```

- **Status:** `200` · `401 unauthenticated` (expired/invalid) · `401 token-reuse-detected` (replayed → family revoked).

### `POST /auth/logout`

Revoke the current refresh-token family and clear the web cookie.

- **Auth:** required (Bearer access token)

```ts
export type LogoutRequest = { refreshToken?: string };
// → 204 No Content
```

- **Status:** `204` · `401`.

---

## 4. Profiles

Module: [profiles.md](../backend/modules/profiles.md). A **profile** is the scored entity. A candidate owns one (or more, in the employer-submitted case) profiles; employers/recruiters can create **claimable** profiles on behalf of a candidate (SCOPE §6.1 / §16).

```ts
export type ProfileStatus = "draft" | "scored" | "claimable" | "claimed";

export type Profile = {
  id: string;
  ownerUserId: string | null;   // null while claimable & unclaimed
  mode: Mode | null;            // chosen at first submission
  status: ProfileStatus;
  fullName: string;
  headline: string | null;
  location: string | null;      // common-block parameter (SCOPE §4.5)
  isVerifiedUser: boolean;      // Verified User flag (SCOPE §5)
  createdByRole: Role;          // who created it (candidate vs employer/recruiter)
  latestScoreRunId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

### `POST /profiles`

Create my own profile (candidate self-onboarding).

- **Auth:** required · **Roles:** `candidate`

```ts
export type CreateProfileRequest = {
  fullName: string;
  headline?: string;
  location?: string;
  mode?: Mode;          // may be set now or at first submission
};
// → Profile
```

- **Status:** `201` · `403` (non-candidate role) · `422`.

### `GET /profiles/:id`

Fetch a single profile.

- **Auth:** required · **Roles:** `candidate` (owner only) · `employer`/`recruiter` (only via an **accepted** share — see [§11](#11-consentshares)) · `admin`.
- **Status:** `200` · `403 consent-required` (employer/recruiter without an accepted share) · `404`.

### `GET /profiles/mine`

List the profiles I own (or, for an unclaimed claimable profile created for my email before I registered, the ones eligible to claim are surfaced separately via [§4 claim](#post-profilesidclaim)).

- **Auth:** required · **Roles:** `candidate`
- **Query:** `?limit&cursor` (cursor pagination, [§1.8](#18-cursor-pagination))
- **Response:** `Paginated<Profile>`
- **Status:** `200`.

### `POST /profiles/employer-submit`

Employer/recruiter submits a candidate's info → **creates a claimable profile** (SCOPE §16). The candidate can later claim it. A claim invite notification is enqueued (see [§16](#16-notifications)).

- **Auth:** required · **Roles:** `employer`, `recruiter`

```ts
export type EmployerSubmitCandidateRequest = {
  fullName: string;
  candidateEmail: string;      // used to match/invite the candidate to claim
  mode?: Mode;
  headline?: string;
  location?: string;
  initialAnswers?: SubmissionAnswers; // optional pre-fill (see §5)
};

export type EmployerSubmitCandidateResponse = {
  profile: Profile;            // status: "claimable", ownerUserId: null
  claimToken: string;          // single-use token embedded in the invite link
  inviteSentTo: string;        // candidateEmail
};
```

- **Status:** `201` · `403` · `409 conflict` (a claimed profile already exists for that email) · `422`.

Example:

```json
// 201 Created
{
  "profile": { "id": "0190b2...", "ownerUserId": null, "status": "claimable", "fullName": "Ravi K", "mode": "professional", "isVerifiedUser": false, "createdByRole": "recruiter", "latestScoreRunId": null, "createdAt": "2026-06-06T10:00:00.000Z", "updatedAt": "2026-06-06T10:00:00.000Z" },
  "claimToken": "clm_01HZ...",
  "inviteSentTo": "ravi@example.com"
}
```

### `POST /profiles/:id/claim`

A candidate claims a claimable profile, becoming its owner. Requires the `claimToken` (or, if logged in with the matching email, an automatic match).

- **Auth:** required · **Roles:** `candidate`

```ts
export type ClaimProfileRequest = { claimToken: string };
// → Profile  (status → "claimed", ownerUserId → me)
```

- **Status:** `200` · `403` (token belongs to a different email) · `404` (profile/token unknown) · `409 conflict` (already claimed) · `410 share-expired` (token expired).

---

## 5. Submissions

Module: [profiles.md](../backend/modules/profiles.md). A **submission** holds the candidate's answers for a profile, keyed by **mode**. Saving is **replace-the-whole-set for that mode** (idempotent PUT-like semantics; the latest submission feeds the rubric layer → scoring). Answers map to SCOPE §4.3–§4.5 parameters; raw answers are converted to normalized `[0,1]` fractions by `packages/core` (the rubric layer) before reaching `@stabil/scoring` (see [03-scoring-engine.md](./03-scoring-engine.md) and the **engine boundary** in [../README.md](../README.md)).

```ts
// Raw, human-meaningful answers (NOT the engine's [0,1] fractions).
export type SubmissionAnswers = {
  // Common block (SCOPE §4.5)
  location?: string;
  communicationSelfRating?: number;      // 1..5
  // Fresher block (SCOPE §4.3)
  academics?: { degree: string; gpa?: number; institution?: string };
  projectsCount?: number;
  certifications?: string[];
  aiFamiliarity?: number;                // 1..5
  cloudExposure?: number;                // 1..5
  relocationWilling?: boolean;
  flexibility?: number;                  // 1..5
  workModePreference?: "remote" | "hybrid" | "onsite";
  programmingLanguages?: string[];
  // Professional block (SCOPE §4.4)
  totalExperienceYears?: number;
  averageTenureYears?: number;
  spokenLanguages?: string[];
  maritalStatus?: "single" | "married" | "other"; // employer-only visibility (SCOPE §9 line item)
  age?: number;                                    // employer-only visibility
};

export type Submission = {
  id: string;
  profileId: string;
  mode: Mode;
  answers: SubmissionAnswers;
  version: number;              // increments on each replace
  createdAt: string;
  updatedAt: string;
};
```

### `PUT /profiles/:profileId/submissions/:mode`

Save (create or fully replace) the answers for a given mode of a profile. `:mode ∈ {fresher, professional}`.

- **Auth:** required · **Roles:** `candidate` (owner) · `employer`/`recruiter` (only for a claimable profile **they** created, before it is claimed).

```ts
export type SaveSubmissionRequest = { answers: SubmissionAnswers };
// → Submission   (version bumped)
```

- **Status:** `200` (replaced) · `201` (first save) · `403` · `404` · `422`.

Example:

```json
// PUT /api/v1/profiles/0190b2.../submissions/professional
{ "answers": { "totalExperienceYears": 7, "averageTenureYears": 2.8, "spokenLanguages": ["en","hi"], "communicationSelfRating": 4, "location": "Pune, IN", "age": 31, "maritalStatus": "married" } }
```

### `GET /profiles/:profileId/submissions/current`

Return the current (latest) submission for the profile's active mode.

- **Auth:** required · **Roles:** `candidate` (owner) · `admin`. Employers/recruiters do **not** see raw answers (only the rendered report, [§13](#13-reports)).
- **Query:** `?mode=<fresher|professional>` (optional; defaults to the profile's active mode)
- **Response:** `Submission`
- **Status:** `200` · `403` · `404` (no submission yet).

---

## 6. Scoring

Module: [scoring.md](../backend/modules/scoring.md), wrapping `@stabil/scoring`. A **score run** computes a `ScoreResult` (see [domain.ts](../../packages/scoring/src/domain.ts)) from the current submission, persists it, and updates `Profile.latestScoreRunId`. Re-scoring is the improvement loop (SCOPE §11).

```ts
export type ScoreRun = {
  id: string;
  profileId: string;
  submissionId: string;          // submission scored
  mode: Mode;
  total: number;                 // 0..1500
  maxTotal: number;              // 1500
  tier: Tier;
  byBlock: Record<Block, { awarded: number; max: number }>;
  // Full breakdown (server-stored, unfiltered). Audience filtering happens at /reports.
  breakdown: Array<{
    key: string; label: string; block: Block;
    visibility: Visibility; awarded: number; max: number;
  }>;
  createdAt: string;
};
```

### `POST /scoring/runs`  — **idempotent**

Run (or re-run) the score for a profile. **`Idempotency-Key` header is required** ([§1.6](#16-idempotency)): retries with the same key + body replay the original run instead of creating a duplicate.

- **Auth:** required · **Roles:** `candidate` (owner) · `employer`/`recruiter` (for their own unclaimed claimable profile) · `admin`. · **Rate bucket:** `scoring`

```ts
export type CreateScoreRunRequest = {
  profileId: string;
  // Optional override of which submission to score; defaults to current.
  submissionId?: string;
};
// → ScoreRun
```

- **Status:** `201` (new run) · `200` with `Idempotency-Replayed: true` (replayed) · `400 idempotency-key-required` · `403` · `404` (no submission to score) · `409 idempotency-key-conflict` · `422` (submission incomplete for the mode) · `429`.

Example:

```json
// POST /api/v1/scoring/runs
// Headers: Idempotency-Key: 9f1c...   Authorization: Bearer ...
{ "profileId": "0190b2..." }
```
```json
// 201 Created
{
  "id": "0190c3...", "profileId": "0190b2...", "submissionId": "0190b9...", "mode": "professional",
  "total": 1180, "maxTotal": 1500, "tier": "settled",
  "byBlock": { "mode": { "awarded": 620, "max": 800 }, "common": { "awarded": 460, "max": 600 }, "verification": { "awarded": 100, "max": 100 } },
  "breakdown": [
    { "key": "totalExperience", "label": "Total experience", "block": "mode", "visibility": "all", "awarded": 240, "max": 300 },
    { "key": "tenure", "label": "Tenure", "block": "mode", "visibility": "all", "awarded": 180, "max": 220 },
    { "key": "age", "label": "Age", "block": "mode", "visibility": "employer-only", "awarded": 60, "max": 80 },
    { "key": "maritalStatus", "label": "Marital status", "block": "mode", "visibility": "employer-only", "awarded": 40, "max": 40 }
  ],
  "createdAt": "2026-06-06T11:00:00.000Z"
}
```

> **Note:** weights/max values above are illustrative — exact point splits and tier bands are a calibration task (SCOPE §13). See [03-scoring-engine.md](./03-scoring-engine.md).

### `GET /scoring/runs/:id`

Fetch a single score run (raw, unfiltered breakdown).

- **Auth:** required · **Roles:** `candidate` (owner of the run's profile) · `admin`. (Employers/recruiters consume scores via the audience-filtered [report](#13-reports), not this raw run.)
- **Response:** `ScoreRun`
- **Status:** `200` · `403` · `404`.

### `GET /scoring/runs?profileId=:id`  — history

List score runs for a profile, newest first (the re-scoring/improvement history).

- **Auth:** required · **Roles:** `candidate` (owner) · `admin`.
- **Query:** `?profileId=<uuid>` (required) `&limit&cursor`
- **Response:** `Paginated<ScoreRun>`
- **Status:** `200` · `403` · `404` (unknown profile).

---

## 9. Documents

Module: [documents-storage.md](../backend/modules/documents-storage.md). Binary uploads go **directly to MinIO** via a presigned URL — the API never proxies file bytes (SCOPE §10 "Storage"). Flow: (1) request a presigned PUT URL, (2) `PUT` the bytes straight to MinIO, (3) confirm to register the object. Sensitive ID documents (Aadhaar/PAN/passport) are handled per [05-security-privacy.md](./05-security-privacy.md).

```ts
export type DocumentKind =
  | "resume" | "certificate" | "gov-id" | "transcript" | "other";

export type DocumentStatus = "pending-upload" | "uploaded" | "scanning" | "ready" | "rejected";

export type DocumentMeta = {
  id: string;
  profileId: string;
  kind: DocumentKind;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;     // known after confirm
  status: DocumentStatus;
  createdAt: string;
};
```

### `POST /documents/upload-url`

Request a short-lived presigned PUT URL for MinIO. Returns the object key and the URL the client uploads to.

- **Auth:** required · **Roles:** `candidate` (owner) · `employer`/`recruiter` (own claimable profile) · **Rate bucket:** `uploads`

```ts
export type RequestUploadUrlRequest = {
  profileId: string;
  kind: DocumentKind;
  fileName: string;
  contentType: string;          // allow-listed (pdf, png, jpeg)
  sizeBytes: number;            // for max-size enforcement
};

export type RequestUploadUrlResponse = {
  documentId: string;           // DocumentMeta.id, status: "pending-upload"
  uploadUrl: string;            // presigned MinIO PUT URL (expires ~5 min)
  objectKey: string;
  expiresAt: string;
  requiredHeaders: Record<string, string>; // e.g. { "Content-Type": "application/pdf" }
};
```

- **Status:** `201` · `403` · `413 payload-too-large` (sizeBytes over limit) · `415 unsupported-media-type` · `422`.

### `POST /documents/:id/confirm`

Confirm the client finished the MinIO upload; the API verifies the object exists, records size, and (Phase 2+) enqueues virus scan / OCR.

- **Auth:** required · **Roles:** owner / creator
- **Body:** `{}` (empty) · **Response:** `DocumentMeta` (status → `uploaded` then async `scanning`/`ready`)
- **Status:** `200` · `404` (object not found in MinIO) · `409` (already confirmed).

### `GET /documents?profileId=:id`

List documents for a profile.

- **Auth:** required · **Roles:** `candidate` (owner) · `admin`. (Employers see verification *status*, not the documents.)
- **Query:** `?profileId=<uuid>&kind=<DocumentKind>&limit&cursor`
- **Response:** `Paginated<DocumentMeta>`
- **Status:** `200` · `403`.

### `DELETE /documents/:id`

Delete a document (removes the MinIO object and metadata). Part of data-minimization (SCOPE §11).

- **Auth:** required · **Roles:** owner / `admin`
- **Status:** `204` · `403` · `404` · `409` (document is locked to an in-review verification — reject the verification first).

---

## 10. Verification

Module: [verification.md](../backend/modules/verification.md). A candidate submits an uploaded document for verification; **Phase 3** is OCR + **manual admin review** (SCOPE §5 / §13). Approval awards the verification bonus and sets the **Verified User** flag (SCOPE §5).

```ts
export type VerificationStatus = "submitted" | "in-review" | "approved" | "rejected";

export type VerificationRequest = {
  id: string;
  profileId: string;
  documentId: string;
  claimType: "age" | "identity" | "certification" | "education";
  status: VerificationStatus;
  reviewerUserId: string | null;
  decisionReason: string | null;   // set on approve/reject
  bonusPointsAwarded: number | null;
  createdAt: string;
  decidedAt: string | null;
};
```

### `POST /verification`

Submit a document for verification.

- **Auth:** required · **Roles:** `candidate` (owner)

```ts
export type SubmitVerificationRequest = {
  profileId: string;
  documentId: string;             // must be a "ready" gov-id/certificate/transcript
  claimType: "age" | "identity" | "certification" | "education";
};
// → VerificationRequest  (status: "submitted")
```

- **Status:** `201` · `403` · `404` (unknown document) · `409` (an active request already exists for that document) · `422`.

### `GET /verification?profileId=:id`

Get verification status/history for a profile.

- **Auth:** required · **Roles:** `candidate` (owner) · `admin`.
- **Query:** `?profileId=<uuid>&limit&cursor`
- **Response:** `Paginated<VerificationRequest>`
- **Status:** `200` · `403`.

### `POST /verification/:id/approve` — admin

Approve a verification; awards bonus points and (re)sets the Verified User flag. A subsequent score run reflects the bonus.

- **Auth:** required · **Roles:** `admin`

```ts
export type ApproveVerificationRequest = { bonusPoints: number; note?: string };
// → VerificationRequest  (status: "approved", bonusPointsAwarded set)
```

- **Status:** `200` · `403` · `404` · `409` (already decided) · `422`.

### `POST /verification/:id/reject` — admin

- **Auth:** required · **Roles:** `admin`

```ts
export type RejectVerificationRequest = { reason: string };
// → VerificationRequest  (status: "rejected")
```

- **Status:** `200` · `403` · `404` · `409` · `422`.

---

## 11. Consent / Shares

Module: [consent-sharing.md](../backend/modules/consent-sharing.md). **Explicit per-share consent** (SCOPE §6.2 / §18): a candidate creates a **share grant** to a specific employer/recruiter, scoped and time-boxed. No employer/recruiter can view a report until a grant exists and is **accepted**. See [05-security-privacy.md](./05-security-privacy.md) for the consent/audit model.

```ts
export type ShareScope = "report-summary" | "report-full";
export type ShareStatus = "pending" | "accepted" | "revoked" | "expired";

export type ShareGrant = {
  id: string;
  profileId: string;
  grantedByUserId: string;       // the candidate
  grantedToEmail: string;        // employer/recruiter recipient
  grantedToUserId: string | null;// resolved when recipient accepts
  scope: ShareScope;
  status: ShareStatus;
  expiresAt: string;             // hard expiry
  acceptedAt: string | null;
  createdAt: string;
};
```

### `POST /consent/shares`

Candidate creates a share grant (scope + expiry) for an employer/recruiter. Sends a notification to the recipient.

- **Auth:** required · **Roles:** `candidate` (owner of the profile)

```ts
export type CreateShareRequest = {
  profileId: string;
  grantedToEmail: string;
  scope: ShareScope;            // "report-summary" = total+tier only; "report-full" = full audience view
  expiresInDays: number;        // 1..90
};
// → ShareGrant   (status: "pending")
```

- **Status:** `201` · `403` · `404` · `422`.

Example:

```json
// POST /api/v1/consent/shares
{ "profileId": "0190b2...", "grantedToEmail": "hr@acme.com", "scope": "report-full", "expiresInDays": 30 }
```

### `GET /consent/shares`

List share grants. A candidate sees grants **they created**; an employer/recruiter sees grants **directed to them**.

- **Auth:** required · **Roles:** `candidate`, `employer`, `recruiter`
- **Query:** `?profileId=<uuid>&status=<ShareStatus>&limit&cursor`
- **Response:** `Paginated<ShareGrant>`
- **Status:** `200`.

### `DELETE /consent/shares/:id` — revoke

Candidate revokes a grant (immediate). Revocation is logged for audit (SCOPE §11).

- **Auth:** required · **Roles:** `candidate` (grantor) · `admin`
- **Status:** `204` (status → `revoked`) · `403` · `404` · `409` (already revoked/expired).

### `POST /consent/shares/:id/accept`

Employer/recruiter accepts a grant directed at their email; this resolves `grantedToUserId` and unlocks the audience-filtered report.

- **Auth:** required · **Roles:** `employer`, `recruiter`
- **Body:** `{}` · **Response:** `ShareGrant` (status → `accepted`)
- **Status:** `200` · `403` (grant not addressed to this user) · `404` · `410 share-expired`.

---

## 13. Reports

Module: [reports-pdf.md](../backend/modules/reports-pdf.md). The report renders a score run **filtered by audience** (SCOPE §6.3 / §8). This is the canonical place where the **candidate view suppresses sensitive line-items** (age, marital status) while keeping the **same total and tier** as the employer/recruiter view.

The server determines `audience` from the caller:
- **Candidate** viewing **their own** profile → `audience: "candidate"` → `employer-only` parameters are **removed** from `breakdown`; their points still count toward `total` (so the number is unchanged), and `hiddenLineItemCount` reports how many were suppressed. Includes `improvementGuidance` (SCOPE §8).
- **Employer/recruiter** with an **accepted** share → `audience: "employer"|"recruiter"` → **full** `breakdown` including sensitive items. A `report-summary` scope returns only `total`, `tier`, `byBlock` (no per-parameter breakdown). No `improvementGuidance`.

```ts
export type ReportLineItem = {
  key: string;
  label: string;
  block: Block;
  visibility: Visibility;        // "all" | "employer-only"
  awarded: number;
  max: number;
};

export type ImprovementHint = {
  parameterKey: string;
  message: string;               // e.g. "Verify your ID for +80 points"
  potentialPoints: number;
};

// Common to all audiences — total & tier are IDENTICAL across views.
type ReportBase = {
  profileId: string;
  scoreRunId: string;
  mode: Mode;
  total: number;                 // same for everyone
  maxTotal: number;              // 1500
  tier: Tier;                    // same for everyone
  byBlock: Record<Block, { awarded: number; max: number }>;
  isVerifiedUser: boolean;
  generatedAt: string;
};

// Candidate view — sensitive line-items SUPPRESSED.
export type CandidateReport = ReportBase & {
  audience: "candidate";
  breakdown: ReportLineItem[];       // contains ONLY visibility === "all"
  hiddenLineItemCount: number;       // count of suppressed employer-only items
  improvementGuidance: ImprovementHint[];
};

// Employer/recruiter view — FULL breakdown incl. sensitive items.
export type EmployerReport = ReportBase & {
  audience: "employer" | "recruiter";
  breakdown: ReportLineItem[];       // ALL items, incl. visibility === "employer-only"
  // no improvementGuidance; no hiddenLineItemCount needed (nothing hidden)
};

export type Report = CandidateReport | EmployerReport;
```

### `GET /profiles/:profileId/report` — audience-aware

- **Auth:** required · **Roles:** `candidate` (owner → candidate view) · `employer`/`recruiter` (accepted share → employer view; scope `report-summary` omits `breakdown`) · `admin` (full view).
- **Response:** `Report` (discriminated by `audience`)
- **Status:** `200` · `403 consent-required` (employer/recruiter without an accepted share) · `404` (no score run yet) · `410 share-expired`.

**Same profile/run, two audiences — note identical `total`/`tier`, different `breakdown`:**

```jsonc
// Candidate view (GET as the profile owner) — age & maritalStatus REMOVED
{
  "audience": "candidate",
  "profileId": "0190b2...", "scoreRunId": "0190c3...", "mode": "professional",
  "total": 1180, "maxTotal": 1500, "tier": "settled",
  "byBlock": { "mode": {"awarded":620,"max":800}, "common": {"awarded":460,"max":600}, "verification": {"awarded":100,"max":100} },
  "isVerifiedUser": true,
  "breakdown": [
    { "key": "totalExperience", "label": "Total experience", "block": "mode", "visibility": "all", "awarded": 240, "max": 300 },
    { "key": "tenure", "label": "Tenure", "block": "mode", "visibility": "all", "awarded": 180, "max": 220 }
  ],
  "hiddenLineItemCount": 2,
  "improvementGuidance": [
    { "parameterKey": "communication", "message": "Upload a verifiable communication certificate for up to +60 points", "potentialPoints": 60 }
  ],
  "generatedAt": "2026-06-06T11:05:00.000Z"
}
```
```jsonc
// Employer view (GET via an accepted report-full share) — age & maritalStatus INCLUDED
{
  "audience": "employer",
  "profileId": "0190b2...", "scoreRunId": "0190c3...", "mode": "professional",
  "total": 1180, "maxTotal": 1500, "tier": "settled",   // ← identical total & tier
  "byBlock": { "mode": {"awarded":620,"max":800}, "common": {"awarded":460,"max":600}, "verification": {"awarded":100,"max":100} },
  "isVerifiedUser": true,
  "breakdown": [
    { "key": "totalExperience", "label": "Total experience", "block": "mode", "visibility": "all", "awarded": 240, "max": 300 },
    { "key": "tenure", "label": "Tenure", "block": "mode", "visibility": "all", "awarded": 180, "max": 220 },
    { "key": "age", "label": "Age", "block": "mode", "visibility": "employer-only", "awarded": 60, "max": 80 },
    { "key": "maritalStatus", "label": "Marital status", "block": "mode", "visibility": "employer-only", "awarded": 40, "max": 40 }
  ],
  "generatedAt": "2026-06-06T11:05:00.000Z"
}
```

> The filtering is enforced server-side from each parameter's `Visibility` (see [domain.ts](../../packages/scoring/src/domain.ts) `AudienceScoreResult.hiddenParameterCount`). The client **cannot** request hidden items — there is no query param to bypass it.

### `POST /profiles/:profileId/report/pdf`

Request a PDF render (`@react-pdf/renderer`, SCOPE §8). Async; returns a job whose download becomes available when `ready`. The PDF is rendered in the **caller's audience**, so a candidate's PDF also omits sensitive items. **Idempotency-Key** recommended.

- **Auth:** required · **Roles:** same as the report GET above.

```ts
export type RequestReportPdfResponse = {
  jobId: string;
  status: "queued" | "rendering" | "ready" | "failed";
  audience: Audience;
};
```

- **Status:** `202 Accepted` · `403 consent-required` · `404` · `410 share-expired`.

### `GET /profiles/:profileId/report/pdf/:jobId/download`

Download the rendered PDF (or its short-lived presigned URL).

- **Auth:** required · **Roles:** same as above.
- **Response:** `application/pdf` (binary) **or** `200 { "downloadUrl": "...", "expiresAt": "..." }` (presigned MinIO URL).
- **Status:** `200` · `404` (job unknown) · `409` (job not `ready` yet — `{ "status": "rendering" }`) · `410 share-expired`.

---

## 14. Employer search/compare (Phase 4)

Module: [employer-search.md](../backend/modules/employer-search.md). The multi-candidate **comparison/ranking dashboard** is a **later phase** (SCOPE §9 / canonical "Employer multi-candidate" = phased). Search/compare only ever return data for profiles the caller has an **accepted share** for; sensitive line-items remain governed by the same audience rules as [§13](#13-reports).

```ts
export type CandidateSearchHit = {
  profileId: string;
  fullName: string;
  headline: string | null;
  location: string | null;
  total: number;
  tier: Tier;
  isVerifiedUser: boolean;
};
```

### `GET /employer/search`

Search across candidates who have shared with the caller.

- **Auth:** required · **Roles:** `employer`, `recruiter`
- **Query:** `?q=<text>&tier=<Tier>&mode=<Mode>&minTotal=<int>&maxTotal=<int>&limit&cursor`
- **Response:** `Paginated<CandidateSearchHit>`
- **Status:** `200` · `403`.

### `POST /employer/compare`

Compare up to N shared candidates side by side (employer audience).

- **Auth:** required · **Roles:** `employer`, `recruiter`

```ts
export type CompareRequest = { profileIds: string[] }; // 2..10, each must be an accepted share
export type CompareResponse = { reports: EmployerReport[] }; // see §13
```

- **Status:** `200` · `403 consent-required` (any id without an accepted share) · `422`.

### Shortlist CRUD

A per-employer/recruiter named list of shared candidates.

```ts
export type Shortlist = { id: string; name: string; ownerUserId: string; profileIds: string[]; createdAt: string; updatedAt: string };
```

| Method | Path | Roles | Body | Response | Status |
|--------|------|-------|------|----------|--------|
| `POST` | `/employer/shortlists` | employer, recruiter | `{ name: string }` | `Shortlist` | `201`, `422` |
| `GET` | `/employer/shortlists` | employer, recruiter | — | `Paginated<Shortlist>` | `200` |
| `GET` | `/employer/shortlists/:id` | owner | — | `Shortlist` | `200`, `403`, `404` |
| `PATCH` | `/employer/shortlists/:id` | owner | `{ name?: string; addProfileIds?: string[]; removeProfileIds?: string[] }` | `Shortlist` | `200`, `403`, `404`, `422` |
| `DELETE` | `/employer/shortlists/:id` | owner | — | — | `204`, `403`, `404` |

Adding a profile to a shortlist requires an accepted share for it → otherwise `403 consent-required`.

---

## 15. Account

Module: [auth-accounts.md](../backend/modules/auth-accounts.md). Self-service account management and the **delete-on-request** path (SCOPE §11 / §19). See [05-security-privacy.md](./05-security-privacy.md) for the deletion/retention policy.

```ts
export type Account = {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  organizationName: string | null;
  createdAt: string;
};
```

### `PATCH /account`

Update my profile/account fields. Email and password changes go through dedicated verified flows (not this endpoint).

- **Auth:** required · **Roles:** any authenticated user

```ts
export type UpdateAccountRequest = {
  displayName?: string;
  organizationName?: string;   // employer/recruiter only
};
// → Account
```

- **Status:** `200` · `403` (e.g. candidate setting `organizationName`) · `422`.

### `POST /account/request-data-deletion`

Request deletion of my account and all associated data (profiles, submissions, documents, score runs). Honors SCOPE §11 "delete on request". Returns a deletion ticket; actual purge runs asynchronously after a short grace window.

- **Auth:** required · **Roles:** any authenticated user

```ts
export type RequestDataDeletionRequest = { confirmEmail: string; reason?: string };
export type RequestDataDeletionResponse = {
  ticketId: string;
  status: "scheduled";
  purgeAfter: string;          // end of grace window (ISO-8601)
};
```

- **Status:** `202 Accepted` · `403` (confirmEmail mismatch) · `409` (deletion already scheduled) · `422`.

---

## 16. Notifications

Module: [notifications.md](../backend/modules/notifications.md). In-app notifications for claim invites, "score ready", and consent asks (SCOPE — claimable profiles, improvement loop, consent).

```ts
export type NotificationType =
  | "claim-invite" | "score-ready" | "consent-request"
  | "consent-accepted" | "verification-decided";

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, string>; // e.g. { profileId, shareId }
  readAt: string | null;
  createdAt: string;
};
```

### `GET /notifications`

List my notifications (newest first).

- **Auth:** required · **Roles:** any authenticated user
- **Query:** `?unreadOnly=<bool>&limit&cursor`
- **Response:** `Paginated<Notification>`
- **Status:** `200`.

### `POST /notifications/:id/read`

Mark one notification read.

- **Auth:** required · **Roles:** owner
- **Body:** `{}` · **Response:** `Notification` (with `readAt` set)
- **Status:** `200` · `403` · `404`.

### `POST /notifications/read-all`

Mark all my notifications read.

- **Auth:** required · **Roles:** any authenticated user
- **Body:** `{}` · **Response:** `{ updated: number }`
- **Status:** `200`.

---

## 17. Status code summary

| Code | When |
|------|------|
| `200 OK` | Successful read / update / replayed idempotent run. |
| `201 Created` | Resource created (register, profile, submission first save, score run). |
| `202 Accepted` | Async accepted (PDF render, data-deletion request). |
| `204 No Content` | Successful delete / logout. |
| `400 Bad Request` | Malformed request (e.g. missing required `Idempotency-Key`). |
| `401 Unauthorized` | Missing/invalid/expired token; refresh reuse. |
| `403 Forbidden` | Wrong role, not owner, or `consent-required`. |
| `404 Not Found` | Unknown resource. |
| `409 Conflict` | Duplicate / already-decided / idempotency-key-conflict. |
| `410 Gone` | Expired share or claim token (`share-expired`). |
| `413 / 415` | Upload too large / unsupported media type. |
| `422 Unprocessable Entity` | Zod validation failure (`errors[]` populated). |
| `429 Too Many Requests` | Rate limit hit (`Retry-After`). |
| `500 / 503` | Internal error / upstream (MinIO, OpenRouter) unavailable. |

---

## 18. Acceptance criteria

- [ ] Every endpoint validates input via the shared Zod schema and returns `422` problem+json with `errors[]` on failure.
- [ ] `GET /profiles/:id/report` returns **identical `total` and `tier`** across candidate and employer audiences, with `employer-only` line-items present **only** in the employer/recruiter/admin view; candidate `hiddenLineItemCount` equals the number of suppressed items.
- [ ] No employer/recruiter can read a profile/report or add it to a shortlist without an **accepted** share grant (otherwise `403 consent-required`).
- [ ] `POST /scoring/runs` rejects a missing `Idempotency-Key` (`400`), replays on key+body match (`200` + `Idempotency-Replayed: true`), and conflicts on key+body mismatch (`409`).
- [ ] All errors conform to RFC 9457 (`application/problem+json`) with a `type`, `title`, `status`, and `requestId`.
- [ ] `GET /api/v1/openapi.json` is generated from the Zod contracts and matches the DTOs in this document.
- [ ] Document bytes never transit the API — only presigned MinIO URLs are issued/consumed.
