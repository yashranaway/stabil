# Phase 1 — Core Scoring & Report (Form Input Only)

> **Status:** Draft v0.1 · **Phase:** 1 · **Owner area:** frontend / backend / data / infra
> **Related:**
> - [SCOPE.md](../SCOPE.md) — authoritative decisions (§2, §4, §6, §7, §8, §9)
> - [architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md) — engine design, parameter model, rubric layer
> - [frontend/pages/onboarding-auth.md](../frontend/pages/onboarding-auth.md)
> - [frontend/pages/mode-selection-and-forms.md](../frontend/pages/mode-selection-and-forms.md)
> - [frontend/pages/candidate-report.md](../frontend/pages/candidate-report.md)
> - [frontend/pages/employer-recruiter.md](../frontend/pages/employer-recruiter.md)
> - [frontend/pages/account-consent-settings.md](../frontend/pages/account-consent-settings.md)
> - [backend/modules/auth-accounts.md](../backend/modules/auth-accounts.md)
> - [backend/modules/profiles.md](../backend/modules/profiles.md)
> - [backend/modules/scoring.md](../backend/modules/scoring.md)
> - [backend/modules/reports-pdf.md](../backend/modules/reports-pdf.md)
> - [backend/modules/consent-sharing.md](../backend/modules/consent-sharing.md)
> - [phases/phase-0-foundations.md](./phase-0-foundations.md) — prerequisite

Phase 1 delivers the end-to-end path from a user opening Stabil for the first time to receiving a fully explainable stability score and report — without any resume parsing or document verification. Every signal comes from forms. The phase is complete when a candidate can self-onboard, choose a mode, complete the wizard, view a 0–1500 score in an in-app dashboard and download a PDF, manage consent before sharing, and an employer can view a differentiated report or submit a candidate who receives a claimable-profile invite.

---

## Goal & Outcomes

| Outcome | Measurable signal |
|---------|-------------------|
| User self-selects a scoring mode | Mode is recorded on every `ScoreRun`; the correct parameter set activates |
| Multi-step forms capture all Phase 1 parameters | All required fields for both `fresher` and `professional` modes validated before submission |
| Deterministic 0–1500 score + tier | Same inputs always produce the same total and tier (seeded tests, no randomness) |
| Explainable per-parameter breakdown | `ScoreResult.breakdown` persisted; rendered per audience in dashboard + PDF |
| Candidate report hides sensitive line-items | `age` + `maritalStatus` never appear in candidate-facing UI or PDF; total is unaffected |
| Employer report shows full breakdown | Employer/recruiter roles see all `ParameterScore` rows including `employer-only` items |
| PDF download | Report PDF generated server-side via `@react-pdf/renderer`, stored in MinIO, downloadable via presigned URL |
| Accounts + re-scoring | Users can log in again, update answers, trigger a new `ScoreRun`; history is preserved |
| Explicit per-share consent | `ShareGrant` record required before any employer/recruiter sees a report |
| Employer-submitted claimable profile | Employer submits candidate info → `CandidateProfile` with `status = claimable` created → invite email sent |

---

## In Scope

- User registration, login, and role-based sessions (candidate / employer / recruiter) — auth shell from Phase 0 hardened with profile flows
- Mode selection screen (Fresher / Working Professional)
- Multi-step form wizards for both modes using `react-hook-form` + Zod shared schemas
- `packages/core` rubric layer: mapping raw form answers → normalized fractions `[0, 1]` per parameter key
- NestJS scoring module wrapping `@stabil/scoring` (`computeScore`, `filterForAudience`, `mapTier`)
- `ScoreRun` persistence with full breakdown stored as JSON
- Candidate report dashboard (Chart.js bar chart per block, radar of parameters, improvement guidance)
- Employer/recruiter report view (same score + full breakdown including employer-only fields)
- PDF report generation via `@react-pdf/renderer`; stored in MinIO; delivered via presigned URL
- Explicit per-share consent flow (`ShareGrant` table, consent UI, revocation)
- Employer-driven submission → claimable `CandidateProfile` → claim invite
- Account management: re-score (creates new `ScoreRun`, preserves history), data-deletion request
- Tier bands: placeholder thresholds from `tier.ts` (`unstable` 0–499 / `developing` 500–799 / `somewhat-stable` 800–1099 / `settled` 1100–1349 / `stable` 1350–1500) — **calibration pending** (SCOPE §13)

## Out of Scope (Phase 1)

- Resume / document parsing (Phase 2) — form answers only; `source = form` on every parameter
- Document upload and verification bonus (Phase 3) — `verifiedDocuments` parameter scores 0 throughout Phase 1
- Skill tests (Phase 4)
- AI-based communication assessment (Phase 4)
- Multi-candidate comparison / ranking dashboard for employers (Phase 4)
- Mobile app (Expo/RN) — web-only in Phase 1; mobile parity follows in parallel
- Third-party KYC / government APIs

---

## Workstreams

### WORKSTREAM A — FRONTEND

Covers the Next.js 15 (App Router) web application. All pages use Tailwind + shadcn/ui. Forms use `react-hook-form` + Zod. Charts use `react-chartjs-2`. See [frontend/pages/README.md](../frontend/pages/README.md) for the full routing map.

**Relevant page docs:**

| Page doc | Coverage |
|----------|----------|
| [onboarding-auth.md](../frontend/pages/onboarding-auth.md) | Sign-up / sign-in, role selection, claim-profile flow |
| [mode-selection-and-forms.md](../frontend/pages/mode-selection-and-forms.md) | Mode picker, fresher wizard, professional wizard |
| [candidate-report.md](../frontend/pages/candidate-report.md) | Candidate dashboard, Chart.js charts, improvement guidance, PDF download |
| [employer-recruiter.md](../frontend/pages/employer-recruiter.md) | Employer report view, employer submission flow |
| [account-consent-settings.md](../frontend/pages/account-consent-settings.md) | Profile, consent management, re-score trigger, deletion request |

### WORKSTREAM B — BACKEND

NestJS API at `/api/v1`. All modules are NestJS feature modules. Auth guard enforces roles per route. See [backend/modules/README.md](../backend/modules/README.md).

**Relevant module docs:**

| Module doc | Responsibility |
|------------|----------------|
| [auth-accounts.md](../backend/modules/auth-accounts.md) | Users, roles, JWT sessions, password hashing |
| [profiles.md](../backend/modules/profiles.md) | `CandidateProfile` CRUD, claimable profiles, re-score orchestration |
| [scoring.md](../backend/modules/scoring.md) | Wraps `@stabil/scoring`; rubric layer; `ScoreRun` persistence |
| [reports-pdf.md](../backend/modules/reports-pdf.md) | Report assembly, `@react-pdf/renderer`, MinIO upload, presigned URL |
| [consent-sharing.md](../backend/modules/consent-sharing.md) | `ShareGrant` lifecycle, per-share consent, audience-filtered views |

### WORKSTREAM C — DATA

Prisma schema additions for Phase 1. Migrations are additive (no destructive changes to Phase 0 tables).

### WORKSTREAM D — INFRA

Deployment of the web app and API; Postgres database; MinIO for PDF storage. See [CLOUD.md](../CLOUD.md).

---

## Data Model

### Entity overview

```
User (Phase 0, extended)
  ├── CandidateProfile (1:1 for candidates)
  │     ├── FormSubmission (1:many — one per wizard completion)
  │     └── ScoreRun (1:many — one per score computation)
  │           └── ReportArtifact (1:1 or 1:many — PDF per run)
  └── ShareGrant (1:many — one per consent-share action)
```

### Prisma models

```prisma
// ─── User (extends Phase 0 shell) ───────────────────────────────────────────
model User {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email         String   @unique
  passwordHash  String
  role          Role     // candidate | employer | recruiter | admin
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  profile       CandidateProfile?
  shareGrants   ShareGrant[]

  @@map("users")
}

enum Role {
  candidate
  employer
  recruiter
  admin
}

// ─── CandidateProfile ────────────────────────────────────────────────────────
// One profile per candidate (or claimable profile before claim).
model CandidateProfile {
  id            String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId        String?         @unique @db.Uuid   // null until claimed
  user          User?           @relation(fields: [userId], references: [id])
  status        ProfileStatus   // active | claimable | deleted
  claimToken    String?         @unique            // non-null when status=claimable
  claimEmail    String?                            // invited email for claim
  submittedBy   String?         @db.Uuid           // employer userId who created it

  createdAt     DateTime        @default(now())
  updatedAt     DateTime        @updatedAt

  submissions   FormSubmission[]
  scoreRuns     ScoreRun[]

  @@map("candidate_profiles")
}

enum ProfileStatus {
  active
  claimable
  deleted
}

// ─── FormSubmission ───────────────────────────────────────────────────────────
// Snapshot of raw form answers at submission time (pre-rubric).
// answers is a JSON blob keyed by parameter key, values are raw (strings, numbers, booleans).
model FormSubmission {
  id          String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  profileId   String           @db.Uuid
  profile     CandidateProfile @relation(fields: [profileId], references: [id])
  mode        Mode             // fresher | professional
  answers     Json             // raw form answers, keyed by field name
  submittedAt DateTime         @default(now())

  scoreRuns   ScoreRun[]

  @@map("form_submissions")
}

enum Mode {
  fresher
  professional
}

// ─── ScoreRun ─────────────────────────────────────────────────────────────────
// Immutable record of one score computation. Never mutated after creation.
model ScoreRun {
  id              String           @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  profileId       String           @db.Uuid
  profile         CandidateProfile @relation(fields: [profileId], references: [id])
  submissionId    String           @db.Uuid
  submission      FormSubmission   @relation(fields: [submissionId], references: [id])

  mode            Mode
  total           Int              // 0–1500, integer (Math.round)
  tier            Tier
  breakdown       Json             // serialized ParameterScore[] from @stabil/scoring
  byBlock         Json             // serialized BlockTotals

  scoredAt        DateTime         @default(now())

  artifacts       ReportArtifact[]
  shareGrants     ShareGrant[]

  @@map("score_runs")
}

enum Tier {
  unstable
  developing
  somewhat_stable  @map("somewhat-stable")
  settled
  stable
}

// ─── ShareGrant ───────────────────────────────────────────────────────────────
// Explicit per-share consent record (SCOPE §6.2).
// Created when a candidate approves sharing with a specific employer/recruiter.
model ShareGrant {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  candidateId   String    @db.Uuid          // User.id of the candidate
  candidate     User      @relation(fields: [candidateId], references: [id])
  scoreRunId    String    @db.Uuid
  scoreRun      ScoreRun  @relation(fields: [scoreRunId], references: [id])
  grantedTo     String                      // employer/recruiter userId or email
  audience      Audience                   // employer | recruiter
  revokedAt     DateTime?                  // null = active
  createdAt     DateTime  @default(now())

  @@map("share_grants")
}

enum Audience {
  candidate
  employer
  recruiter
}

// ─── ReportArtifact ──────────────────────────────────────────────────────────
// One PDF report per ScoreRun per audience type (candidate PDF vs employer PDF).
model ReportArtifact {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  scoreRunId    String    @db.Uuid
  scoreRun      ScoreRun  @relation(fields: [scoreRunId], references: [id])
  audience      Audience
  storageKey    String    // MinIO object key, e.g. "reports/{profileId}/{runId}/candidate.pdf"
  generatedAt   DateTime  @default(now())

  @@unique([scoreRunId, audience])
  @@map("report_artifacts")
}
```

### Key design notes

- `ScoreRun` is **append-only**. Re-scoring creates a new row; older runs are never deleted or overwritten, preserving the improvement loop history (SCOPE §2 decision 17).
- `breakdown` and `byBlock` are stored as JSON snapshots of the engine output types (`ParameterScore[]` and `BlockTotals` from `@stabil/scoring`). This means the report always reflects the weights that were active **at scoring time**, even if weights are recalibrated later.
- `claimToken` on `CandidateProfile` is a cryptographically random token (e.g. 32-byte hex); it is single-use and should expire after 7 days.
- All primary keys are UUID v7 (per conventions in README.md).

---

## Detailed Task Checklist

Checkboxes are ordered by dependency within each sub-module. A task may not begin until all tasks it depends on are checked.

### A1 · Onboarding & Auth (Frontend)

> See [frontend/pages/onboarding-auth.md](../frontend/pages/onboarding-auth.md)

- [ ] **A1.1** Scaffold `/app/(auth)/register/page.tsx` — email + password + role selector (candidate / employer / recruiter); Zod schema `RegisterSchema`; POST `/api/v1/auth/register`
- [ ] **A1.2** Scaffold `/app/(auth)/login/page.tsx` — email + password; POST `/api/v1/auth/login`; store JWT in httpOnly cookie (web) or secure storage (mobile); redirect to dashboard
- [ ] **A1.3** Auth context (`app/providers/auth-provider.tsx`) exposing `useAuth()` — current user, role, loading state; wraps all protected routes
- [ ] **A1.4** Protected route middleware (`middleware.ts`) — redirect unauthenticated users to `/login`; redirect employer/recruiter away from candidate-only routes
- [ ] **A1.5** Claim-profile flow: `/app/(auth)/claim/[token]/page.tsx` — validates token via GET `/api/v1/profiles/claim/:token`, then shows register form pre-filled with claimEmail; on submit calls POST `/api/v1/profiles/claim/:token/accept`
- [ ] **A1.6** Unit tests: Zod schemas for register + login (Vitest); Playwright happy path: register → login → land on mode-selection

---

### A2 · Mode Selection (Frontend)

> See [frontend/pages/mode-selection-and-forms.md](../frontend/pages/mode-selection-and-forms.md)

- [ ] **A2.1** `/app/(candidate)/mode/page.tsx` — two card components (Fresher / Working Professional) with icons, brief description, and CTA; writes selected mode to wizard state (Zustand or URL param)
- [ ] **A2.2** Guard: if profile already has a `ScoreRun`, show "Change mode?" confirmation dialog warning that changing mode resets answers
- [ ] **A2.3** Playwright: select Fresher → lands on fresher wizard; select Professional → lands on professional wizard

---

### A3 · Fresher Multi-Step Wizard (Frontend)

> See [frontend/pages/mode-selection-and-forms.md](../frontend/pages/mode-selection-and-forms.md)

The wizard is a multi-step form using `react-hook-form` with `useFormContext` + Zod schemas from `packages/shared/schemas/fresher.ts`. Steps persist to session state between steps but are only submitted at the final step.

| Step | Fields |
|------|--------|
| 1 · Academics | Degree type, institution tier, GPA / percentage band, consistency flag |
| 2 · Projects | Count of personal/academic projects, relevance rating (self-rated 1–5) |
| 3 · Courses & Certs | Number of completed courses, verified cert count |
| 4 · Technical skills | Programming languages (multi-select from enum list), AI familiarity (1–5 scale), cloud platform familiarity (1–5 scale) |
| 5 · Personal factors | Relocation willingness (yes/conditional/no), flexibility (1–5), work-mode preference (hybrid/remote/onsite) |
| 6 · Common block | Communication self-rating (1–5), spoken + written language proficiency, location (city/country) |
| 7 · Review & Submit | Read-only summary of all answers; submit button triggers API call |

- [ ] **A3.1** Define `FresherFormSchema` in `packages/shared/src/schemas/fresher.ts` using Zod; export inferred type `FresherFormValues`
- [ ] **A3.2** Wizard shell component `FresherWizard` — step progress indicator (shadcn/ui `Steps`), back/next navigation, step validation on next (trigger Zod parse for current step fields only)
- [ ] **A3.3** Implement Step 1 (Academics) component with all fields, error messages, and field-level hints
- [ ] **A3.4** Implement Step 2 (Projects)
- [ ] **A3.5** Implement Step 3 (Courses & Certs)
- [ ] **A3.6** Implement Step 4 (Technical Skills) — multi-select for programming languages (combobox, shadcn/ui)
- [ ] **A3.7** Implement Step 5 (Personal Factors)
- [ ] **A3.8** Implement Step 6 (Common block)
- [ ] **A3.9** Implement Step 7 (Review & Submit) — POST to `/api/v1/submissions` with `{mode: "fresher", answers}`; on success redirect to `/report/[runId]`
- [ ] **A3.10** Draft-save: on each step advance, PATCH `/api/v1/profiles/me/draft` so partial answers survive reload
- [ ] **A3.11** Vitest: `FresherFormSchema` accepts valid payloads and rejects missing required fields; Playwright: complete all 7 steps, verify redirect to report page

---

### A4 · Professional Multi-Step Wizard (Frontend)

> See [frontend/pages/mode-selection-and-forms.md](../frontend/pages/mode-selection-and-forms.md)

| Step | Fields |
|------|--------|
| 1 · Experience | Total years of experience (numeric), current employment status |
| 2 · Tenure | Number of jobs held, duration of each (entered as year ranges or average months/job) |
| 3 · Languages | Spoken languages (multi-select + proficiency per language) |
| 4 · Personal (sensitive) | Age (numeric, years), marital status (single/married/other) — with disclosure notice: *"These fields are used in scoring. They are never shown in your report but are visible to employers who receive your shared report."* |
| 5 · Common block | Communication self-rating (1–5), location (city/country) |
| 6 · Review & Submit | Read-only summary; submit button |

- [ ] **A4.1** Define `ProfessionalFormSchema` in `packages/shared/src/schemas/professional.ts`
- [ ] **A4.2** Wizard shell `ProfessionalWizard` — same step/progress pattern as fresher wizard
- [ ] **A4.3** Implement Step 1 (Experience)
- [ ] **A4.4** Implement Step 2 (Tenure) — dynamic repeater: user adds rows (job start/end); compute average tenure client-side and display as preview
- [ ] **A4.5** Implement Step 3 (Languages) — multi-select combobox + per-language proficiency dropdown
- [ ] **A4.6** Implement Step 4 (Sensitive) — disclosure banner must be confirmed (checkbox) before fields are enabled; fields are rendered but with a distinct visual treatment (muted label, info tooltip repeating employer-only caveat)
- [ ] **A4.7** Implement Step 5 (Common block)
- [ ] **A4.8** Implement Step 6 (Review & Submit) — same POST pattern as A3.9
- [ ] **A4.9** Draft-save same as A3.10
- [ ] **A4.10** Playwright: professional wizard end-to-end; verify sensitive-field disclosure gate; verify redirect to report

---

### A5 · Candidate Report Dashboard (Frontend)

> See [frontend/pages/candidate-report.md](../frontend/pages/candidate-report.md)

- [ ] **A5.1** Route `/app/(candidate)/report/[runId]/page.tsx` — fetch `GET /api/v1/reports/:runId?audience=candidate`; render `AudienceScoreResult`
- [ ] **A5.2** Score hero component: large numeric display (`total / 1500`), tier badge with color-coded severity (shadcn/ui `Badge`), mode label
- [ ] **A5.3** Block summary: three `Card` components (mode block / common block / verification block) each showing `awarded / max` with a mini progress bar
- [ ] **A5.4** Parameter breakdown bar chart: `react-chartjs-2` horizontal `Bar` chart — X axis = awarded points, Y axis = parameter label; color-coded by block; candidate-view: `employer-only` parameters are absent from both the chart data and chart legend (they must not appear even as empty bars)
- [ ] **A5.5** Parameter radar chart: `react-chartjs-2` `Radar` — normalized to percentage per parameter; same filtering as A5.4
- [ ] **A5.6** `hiddenParameterCount` notice: if `hiddenParameterCount > 0`, render a subdued info card — *"N factor(s) used in your score are visible only to employers. They do not appear in this breakdown."* Do **not** name the factors.
- [ ] **A5.7** Improvement guidance section: for each parameter where `awarded < max`, render a `Tip` card with a human-readable action (e.g. "Consider adding a verified certification to boost your Courses & Certifications score"). Tips are generated from a static lookup table keyed by `parameter.key`; never mention sensitive fields in tips.
- [ ] **A5.8** PDF download button: `POST /api/v1/reports/:runId/pdf?audience=candidate` → returns `{ url: string }` presigned URL; button opens URL in new tab
- [ ] **A5.9** Score history component: list of prior `ScoreRun`s for the same profile (fetch `GET /api/v1/profiles/me/score-runs`); each row shows date, total, tier; click navigates to that run's report
- [ ] **A5.10** "Re-score" button — navigates to `/mode` to restart the wizard; existing answers pre-populate from last `FormSubmission` (PATCH draft endpoint)
- [ ] **A5.11** Playwright: complete wizard → land on report → verify score displayed, charts rendered, sensitive parameters absent, PDF download link present, history shows one entry; re-score → history shows two entries

---

### A6 · Employer Report View (Frontend)

> See [frontend/pages/employer-recruiter.md](../frontend/pages/employer-recruiter.md)

- [ ] **A6.1** Route `/app/(employer)/reports/[grantId]/page.tsx` — employer/recruiter guard; fetch `GET /api/v1/share/:grantId/report`; render `AudienceScoreResult` with `audience = employer`
- [ ] **A6.2** Full parameter breakdown: same bar chart as A5.4 but includes all parameters (including `employer-only`); sensitive parameters rendered with a distinct visual label ("Employer-only field") and subtle icon
- [ ] **A6.3** Employer-only section: a separate collapsible panel listing only `employer-only` parameters with their awarded and max points, and a compliance note: *"These factors are visible only to employers. Candidates do not see them in their own report."*
- [ ] **A6.4** Employer-driven submission form at `/app/(employer)/submit/page.tsx`: fields for candidate name, email (required for invite), mode, and the same form fields that an employer-submitted profile would capture; POST `/api/v1/submissions/employer`
- [ ] **A6.5** Submission success state: display claim-invite confirmation (email sent to candidate), show the created `CandidateProfile` summary
- [ ] **A6.6** Playwright: employer login → open a share link → verify sensitive fields present → verify candidate-only tip section absent; employer submission → verify success + claimable profile created

---

### A7 · Consent UI (Frontend)

> See [frontend/pages/account-consent-settings.md](../frontend/pages/account-consent-settings.md)

- [ ] **A7.1** Consent grant modal — triggered when candidate clicks "Share report with employer"; inputs: employer email or name, which `ScoreRun` to share; POST `/api/v1/share`; displays the employer-only disclosure before confirm
- [ ] **A7.2** Active grants list at `/app/(candidate)/settings/consent/page.tsx` — `GET /api/v1/share`; each row shows grantedTo, score run date, status (active/revoked); "Revoke" button → DELETE `/api/v1/share/:id`
- [ ] **A7.3** Playwright: grant consent → share appears in list; revoke → status becomes revoked; employer can no longer access the report after revocation (API returns 403)

---

### A8 · Account & Data Deletion (Frontend)

> See [frontend/pages/account-consent-settings.md](../frontend/pages/account-consent-settings.md)

- [ ] **A8.1** Profile settings page `/app/(candidate)/settings/page.tsx` — display name, email, account creation date; PATCH `/api/v1/users/me`
- [ ] **A8.2** "Request account deletion" flow — confirmation dialog with typed "DELETE" acknowledgment; POST `/api/v1/users/me/delete-request`; sets `ProfileStatus = deleted`, soft-deletes records, queues hard-delete job (SCOPE §11)
- [ ] **A8.3** Playwright: submit deletion request → profile marked deleted → subsequent login returns 403

---

### B1 · Auth & Accounts Module (Backend)

> See [backend/modules/auth-accounts.md](../backend/modules/auth-accounts.md)

- [ ] **B1.1** `POST /api/v1/auth/register` — validate `RegisterDto` (Zod-backed `class-validator`); hash password (bcrypt, cost 12); create `User`; issue JWT (`role` claim in payload); return `{ token, user: { id, email, role } }`
- [ ] **B1.2** `POST /api/v1/auth/login` — validate credentials; issue JWT; return same shape
- [ ] **B1.3** `GET /api/v1/auth/me` — JWT guard; return current user
- [ ] **B1.4** JWT strategy (Passport `passport-jwt`); `JwtAuthGuard` and `RolesGuard` as global guards; `@Roles()` decorator
- [ ] **B1.5** `PATCH /api/v1/users/me` — update name, email (unique check); re-issue token on email change
- [ ] **B1.6** `POST /api/v1/users/me/delete-request` — soft-delete: set `ProfileStatus = deleted`, nullify `passwordHash`, revoke all active `ShareGrant`s, schedule hard delete (cron or queue job, 30-day grace period)
- [ ] **B1.7** Supertest e2e: register → login → me → patch → delete-request

---

### B2 · Profiles Module (Backend)

> See [backend/modules/profiles.md](../backend/modules/profiles.md)

- [ ] **B2.1** `GET /api/v1/profiles/me` — return own `CandidateProfile` with latest `ScoreRun` summary
- [ ] **B2.2** `GET /api/v1/profiles/me/score-runs` — paginated list of all `ScoreRun`s for own profile (newest first)
- [ ] **B2.3** `PATCH /api/v1/profiles/me/draft` — upsert draft form answers (stored on profile or in a dedicated `ProfileDraft` JSON column); answers are not scored until explicit submit
- [ ] **B2.4** Employer submission: `POST /api/v1/submissions/employer` — `@Roles(employer, recruiter)`; validate `EmployerSubmissionDto`; create `CandidateProfile` with `status = claimable`, generate `claimToken` (32-byte crypto random hex), set `claimEmail`; create `FormSubmission`; trigger scoring (B3); send claim invite email (B2.5)
- [ ] **B2.5** Claim invite email — use a transactional mailer (Nodemailer + local SMTP for dev, configurable SMTP for prod); template includes claim link `/claim/{token}`
- [ ] **B2.6** `GET /api/v1/profiles/claim/:token` — validate token (exists, not expired, not already claimed); return `{ claimEmail, profileSummary }`; 404 on invalid/expired
- [ ] **B2.7** `POST /api/v1/profiles/claim/:token/accept` — register or link existing user; set `CandidateProfile.userId`, `status = active`, clear `claimToken`; issue JWT for new session
- [ ] **B2.8** Supertest e2e: employer submit → claim invite created → GET claim/:token → POST claim/accept → profile active

---

### B3 · Scoring Module (Backend)

> See [backend/modules/scoring.md](../backend/modules/scoring.md) and [architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md)

The scoring module is responsible for two distinct sub-layers:

**Rubric layer** (`packages/core/src/rubric/`) — maps raw form answers (strings, numbers, booleans) to normalized fractions `[0,1]` per parameter key. This layer is separate from `@stabil/scoring` (which only consumes already-normalized fractions). Keeping this boundary crisp means the engine can be unit-tested without form-answer concerns.

**Engine wrapper** — calls `computeScore(input, stabilConfig)` from `@stabil/scoring`, then `filterForAudience(result, audience)`, persists the `ScoreRun`.

| Sub-layer | Package | Responsibility |
|-----------|---------|----------------|
| Rubric layer | `packages/core` | Raw answers → `ParameterValues` (normalized fractions) |
| Engine | `packages/scoring` | `ParameterValues` + `ScoringConfig` → `ScoreResult` |
| Audience filter | `packages/scoring` | `ScoreResult` + `Audience` → `AudienceScoreResult` |
| Persistence | NestJS `ScoringModule` | Persist `ScoreRun` + `FormSubmission` to Postgres |

- [ ] **B3.1** Define rubric functions in `packages/core/src/rubric/fresher.ts` and `packages/core/src/rubric/professional.ts` and `packages/core/src/rubric/common.ts` — one pure function per parameter, signature: `(raw: unknown) => number` returning `[0,1]`
- [ ] **B3.2** Rubric registry: `packages/core/src/rubric/index.ts` exports `applyRubrics(mode: Mode, answers: Record<string, unknown>): ParameterValues` — calls all applicable rubric functions, returns map of fractions
- [ ] **B3.3** NestJS `ScoringModule` with `ScoringService.scoreSubmission(submissionId: string): Promise<ScoreRun>`:
  1. Load `FormSubmission` by ID
  2. Call `applyRubrics(mode, answers)` → `ParameterValues`
  3. Call `computeScore({ mode, values }, stabilConfig)` → `ScoreResult`
  4. Persist `ScoreRun` (JSON fields for `breakdown` + `byBlock`)
  5. Return the saved `ScoreRun`
- [ ] **B3.4** `POST /api/v1/submissions` — `@Roles(candidate)`; validate `SubmissionDto { mode, answers }`; upsert `FormSubmission`; call `ScoringService.scoreSubmission`; trigger PDF generation (async, non-blocking); return `{ scoreRunId }`
- [ ] **B3.5** `GET /api/v1/reports/:runId` — JWT guard; load `ScoreRun`; call `filterForAudience(result, audienceFromRole(user.role))`; return `AudienceScoreResult`; 403 if candidate requests another candidate's run
- [ ] **B3.6** Re-score path: candidate PATCHes `/api/v1/profiles/me/draft` with new answers, then POSTs `/api/v1/submissions` again — creates a new `FormSubmission` and a new `ScoreRun`; previous runs unchanged
- [ ] **B3.7** Vitest — rubric layer:
  - Each rubric function covers known input bands (see rubric table below)
  - `applyRubrics` returns all expected keys
  - Zero-input professional scores 0 on all mode parameters
- [ ] **B3.8** Vitest — engine integration:
  - Same input always produces same `ScoreRun.total` (determinism)
  - Professional candidate with `totalExperience=1, tenure=1, spokenLanguages=0.5, age=0.8, maritalStatus=1, communication=0.8, location=0.5, verifiedDocuments=0` → computed total matches hand-calculated expected value (document the expected value as a constant in the test)
  - `filterForAudience(result, "candidate")` excludes `age` + `maritalStatus` from breakdown; total unchanged
- [ ] **B3.9** Supertest e2e: POST submission → 201 with `scoreRunId`; GET report (candidate role) → breakdown excludes sensitive; GET report (employer role via share grant) → breakdown includes sensitive

#### Rubric reference table (Phase 1 placeholder mappings)

> **CALIBRATION PENDING** — the numeric bands below are illustrative starting points only. They must be reviewed and approved before Phase 1 ships. See SCOPE §13 item 3.

| Parameter key | Mode | Raw answer type | Rubric mapping (placeholder) |
|---------------|------|-----------------|------------------------------|
| `academics` | fresher | `{ degreeType, institutionTier, gpaBand }` | Weighted combination: degreeType (0.3) + institutionTier (0.4) + gpaBand (0.3); each mapped to 0/0.5/1.0 bands |
| `projects` | fresher | `{ count: number, relevance: 1–5 }` | `(clamp(count, 0, 5) / 5 * 0.4) + (relevance / 5 * 0.6)` |
| `courseCerts` | fresher | `{ courses: number, certs: number }` | `clamp((courses * 0.3 + certs * 0.7) / 10, 0, 1)` |
| `programmingLanguages` | fresher | `string[]` (enum values) | `clamp(count / 5, 0, 1)` |
| `aiFamiliarity` | fresher | `1–5` | `(value - 1) / 4` |
| `cloud` | fresher | `1–5` | `(value - 1) / 4` |
| `relocation` | fresher | `"yes"\|"conditional"\|"no"` | yes → 1.0, conditional → 0.5, no → 0 |
| `flexibility` | fresher | `1–5` | `(value - 1) / 4` |
| `workMode` | fresher | `"hybrid"\|"remote"\|"onsite"` | hybrid → 1.0, onsite → 0.75, remote → 0.5 |
| `totalExperience` | professional | `number` (years) | `clamp(years / 15, 0, 1)` |
| `tenure` | professional | `number` (average months per job) | `clamp((months - 6) / 54, 0, 1)` (6 mo min, 60 mo = 1.0) |
| `spokenLanguages` | professional | `number` (count) | `clamp((count - 1) / 4, 0, 1)` |
| `age` | professional | `number` (years) | `clamp((age - 22) / 18, 0, 1)` (22–40 range) — **employer-only** |
| `maritalStatus` | professional | `"single"\|"married"\|"other"` | married → 1.0, other → 0.5, single → 0 — **employer-only** |
| `communication` | both | `1–5` | `(value - 1) / 4` |
| `location` | both | `{ city, country }` | Heuristic: known metro → 1.0, tier-2 → 0.75, rural → 0.5, unknown → 0.5 — **PLACEHOLDER** |
| `verifiedDocuments` | both | n/a (Phase 1) | Always 0 in Phase 1; no documents yet |

---

### B4 · Reports & PDF Module (Backend)

> See [backend/modules/reports-pdf.md](../backend/modules/reports-pdf.md)

- [ ] **B4.1** `ReportService.assembleReport(scoreRunId, audience): AudienceScoreResult` — loads `ScoreRun`, calls `filterForAudience`; this is the same data returned by `GET /api/v1/reports/:runId`
- [ ] **B4.2** PDF template in `packages/pdf/src/templates/StabilReport.tsx` using `@react-pdf/renderer` — renders: header (Stabil logo placeholder, score, tier badge), block summary table, per-parameter breakdown table (audience-filtered), improvement tips section (candidate PDF only), footer (run ID, date, confidentiality notice)
- [ ] **B4.3** Employer PDF template — same structure but includes sensitive parameters section; replace improvement tips with employer compliance note
- [ ] **B4.4** `ReportService.generatePdf(scoreRunId, audience): Promise<Buffer>` — renders the React PDF to a buffer using `@react-pdf/renderer`'s `renderToBuffer`
- [ ] **B4.5** `ReportService.uploadPdf(scoreRunId, audience, buffer): Promise<string>` — upload to MinIO bucket `stabil-reports`; object key: `reports/{profileId}/{runId}/{audience}.pdf`; return object key
- [ ] **B4.6** `ReportArtifact` upsert after upload — `@@unique([scoreRunId, audience])` ensures idempotent re-generation
- [ ] **B4.7** `POST /api/v1/reports/:runId/pdf` — `@Roles(candidate, employer, recruiter)`; validate audience (candidate can only request `candidate` PDF; employer/recruiter can request `employer` PDF if they hold a valid `ShareGrant`); generate if not cached, else load from `ReportArtifact`; return presigned MinIO URL (24-hour expiry)
- [ ] **B4.8** PDF generation is triggered asynchronously after scoring (fire-and-forget for candidate PDF; employer PDF on first access)
- [ ] **B4.9** Vitest: render PDF template for a known `AudienceScoreResult` → buffer is non-empty; candidate template does not include "age" or "Marital" text

---

### B5 · Consent & Sharing Module (Backend)

> See [backend/modules/consent-sharing.md](../backend/modules/consent-sharing.md)

- [ ] **B5.1** `POST /api/v1/share` — `@Roles(candidate)`; body: `{ scoreRunId, grantedTo: string, audience: "employer"|"recruiter" }`; validate that `scoreRunId` belongs to requester's profile; create `ShareGrant`; return grant ID + share link
- [ ] **B5.2** `GET /api/v1/share` — `@Roles(candidate)`; list all own `ShareGrant`s; include `revokedAt` status
- [ ] **B5.3** `DELETE /api/v1/share/:id` — `@Roles(candidate)`; set `revokedAt = now()`; does not delete the record (audit trail)
- [ ] **B5.4** `GET /api/v1/share/:grantId/report` — `@Roles(employer, recruiter)`; validate grant (exists, not revoked, `grantedTo` matches requester's userId or email); load `ScoreRun`; call `filterForAudience(result, grant.audience)`; return `AudienceScoreResult`; log access event
- [ ] **B5.5** Access logging: on each employer report access, record `{ grantId, accessorId, accessedAt }` (can be a JSON column on `ShareGrant` or a separate `ShareAccessLog` table — Phase 1: JSON append)
- [ ] **B5.6** Supertest e2e: create grant → employer GET report → verify full breakdown; revoke → employer GET → 403; candidate cannot GET share/:grantId/report

---

### C1 · Data Migrations

- [ ] **C1.1** Prisma migration `0001_phase1_core_schema` — add all Phase 1 models (`CandidateProfile`, `FormSubmission`, `ScoreRun`, `ShareGrant`, `ReportArtifact`) and enums
- [ ] **C1.2** Indexes: `candidate_profiles(userId)`, `score_runs(profileId, scoredAt DESC)`, `share_grants(candidateId)`, `share_grants(grantedTo)`, `share_grants(scoreRunId)`
- [ ] **C1.3** Seed script `prisma/seed.ts` — creates one candidate (fresher), one professional, one employer; runs fresher and professional scoring; creates one `ShareGrant`; useful for local dev and Playwright fixtures
- [ ] **C1.4** Verify migrations are idempotent (`prisma migrate deploy` on clean DB and on already-migrated DB)

---

### D1 · Infrastructure

> See [CLOUD.md](../CLOUD.md)

- [ ] **D1.1** Vercel project for Next.js web app; `NEXT_PUBLIC_API_URL` env var; configure preview + production environments
- [ ] **D1.2** Container deployment for NestJS API (Docker image; `Dockerfile` at `apps/api/`); host on chosen container platform (Fly.io / Railway / Render); configure `DATABASE_URL`, `JWT_SECRET`, `MINIO_*` env vars
- [ ] **D1.3** Managed Postgres (Neon / Supabase / Railway Postgres); run `prisma migrate deploy` on startup
- [ ] **D1.4** MinIO instance (Docker container or hosted MinIO); bucket `stabil-reports` with private ACL; configure CORS for presigned URL downloads from web origin
- [ ] **D1.5** Local dev: `docker-compose.yml` at repo root with services `postgres`, `minio`; `minio-init` one-shot container that creates the bucket; `minio/mc` client for local inspection
- [ ] **D1.6** CI: GitHub Actions workflow `phase-1-ci.yml` — install, type-check, `vitest run`, `playwright test` (against dev server + local Postgres + MinIO via docker-compose)

---

## Deliverables

| # | Deliverable | Location |
|---|-------------|----------|
| 1 | `packages/core/src/rubric/` — rubric layer functions + `applyRubrics` | `packages/core/` |
| 2 | Fresher + Professional multi-step wizard pages | `apps/web/app/(candidate)/` |
| 3 | Candidate report dashboard with Chart.js charts | `apps/web/app/(candidate)/report/` |
| 4 | Employer report view + employer submission form | `apps/web/app/(employer)/` |
| 5 | Consent grant + management UI | `apps/web/app/(candidate)/settings/consent/` |
| 6 | Account settings + deletion request | `apps/web/app/(candidate)/settings/` |
| 7 | Claim-profile page | `apps/web/app/(auth)/claim/` |
| 8 | NestJS `AuthModule`, `ProfilesModule`, `ScoringModule`, `ReportsModule`, `ConsentModule` | `apps/api/src/modules/` |
| 9 | PDF templates (candidate + employer) | `packages/pdf/src/templates/` |
| 10 | Prisma migration `0001_phase1_core_schema` | `prisma/migrations/` |
| 11 | Seed script with fresher, professional, employer fixtures | `prisma/seed.ts` |
| 12 | `docker-compose.yml` with Postgres + MinIO | repo root |
| 13 | CI workflow `phase-1-ci.yml` | `.github/workflows/` |

---

## Acceptance Criteria (Definition of Done)

All criteria must be met for Phase 1 to be considered complete. They are written as concrete, testable statements.

### Scoring correctness

1. **Determinism:** Given a professional candidate with `totalExperience = 10 years, tenure = 36 months average, spokenLanguages = 2, age = 30, maritalStatus = "married", communication = 4/5, location = "Bangalore" (metro), verifiedDocuments = 0`, the same total score is returned on every invocation of `computeScore` with the same rubric output (no randomness, no timestamp dependency).

2. **Mode isolation:** A fresher submission never activates `totalExperience`, `tenure`, `age`, or `maritalStatus` parameters. A professional submission never activates `academics`, `projects`, `programmingLanguages`, `aiFamiliarity`, `cloud`, `courseCerts`, `relocation`, `flexibility`, or `workMode`.

3. **Perfect score:** A candidate who provides the maximum answer for every applicable parameter in either mode scores exactly 1500 (validated by the existing `config.test.ts` invariant, now also tested via the API e2e path).

4. **Tier mapping:** Scores at the tier boundaries score the correct tier: total 0 → `unstable`, total 500 → `developing`, total 800 → `somewhat-stable`, total 1100 → `settled`, total 1350 → `stable`. Boundaries are **inclusive lower bound** as per `tier.ts`.

5. **Re-score preserves history:** After a candidate re-scores, the new `ScoreRun` has a different `id` and `scoredAt` timestamp; the previous `ScoreRun` is unchanged in the database. `GET /api/v1/profiles/me/score-runs` returns both records.

### Report views

6. **Candidate report excludes sensitive fields:** A candidate's `AudienceScoreResult` (from API or PDF) contains zero line-items with `visibility = "employer-only"`. The words "age", "Age", "Marital", "marital" do not appear in the candidate PDF. The `total` in the candidate view equals the `total` in the employer view for the same `ScoreRun`.

7. **Employer report includes sensitive fields:** An employer accessing a report via a valid `ShareGrant` receives an `AudienceScoreResult` that includes both `age` and `maritalStatus` line-items with their awarded and max points.

8. **`hiddenParameterCount` is correct:** For a professional candidate, the candidate `AudienceScoreResult.hiddenParameterCount` equals 2 (age + maritalStatus). For a fresher candidate it equals 0.

### PDF

9. **PDF downloads:** `POST /api/v1/reports/:runId/pdf?audience=candidate` returns a presigned URL; fetching that URL returns a PDF with `Content-Type: application/pdf` and size > 0.

10. **Candidate PDF is clean:** The rendered candidate PDF does not contain the text "age", "Age", "Marital status", or "maritalStatus" anywhere in its content.

### Consent & sharing

11. **Consent required:** An employer who does not hold a valid, non-revoked `ShareGrant` for a `ScoreRun` receives HTTP 403 on `GET /api/v1/share/:grantId/report`.

12. **Revocation is immediate:** After `DELETE /api/v1/share/:id`, subsequent employer requests for that grant return 403 within the same test run (no caching grace period).

### Claimable profile

13. **Employer-submitted profile is claimable:** After an employer POSTs to `/api/v1/submissions/employer`, a `CandidateProfile` with `status = claimable` and a non-null `claimToken` exists in the database. An email is sent to `claimEmail`.

14. **Claim flow succeeds:** `GET /api/v1/profiles/claim/:token` returns 200 with the profile summary. `POST /api/v1/profiles/claim/:token/accept` with valid registration data sets `status = active`, clears `claimToken`, and returns a valid JWT.

15. **Expired token is rejected:** A `claimToken` older than 7 days returns 404 (or 410) on the claim endpoint.

### Accounts

16. **Deletion request soft-deletes:** After `POST /api/v1/users/me/delete-request`, the user's subsequent login attempts return 403. All active `ShareGrant`s for that user have `revokedAt` set.

---

## Test Strategy

### Unit tests (Vitest)

| Suite | File | What it tests |
|-------|------|---------------|
| Engine — existing | `packages/scoring/src/score.test.ts` | `computeScore` correctness, clamping, mode isolation |
| Engine — existing | `packages/scoring/src/config.test.ts` | `stabilConfig` invariants (scale, uniqueness, sensitive visibility) |
| Engine — existing | `packages/scoring/src/tier.test.ts` | `mapTier` boundary values |
| Engine — existing | `packages/scoring/src/audience.test.ts` | `filterForAudience` suppression |
| Rubric layer — new | `packages/core/src/rubric/*.test.ts` | Each rubric function: known inputs → expected fraction; edge cases (min, max, boundary); missing/null inputs default to 0 |
| PDF template — new | `packages/pdf/src/templates/StabilReport.test.tsx` | Render to buffer succeeds; candidate template text does not include "age" or "Marital" |
| Zod schemas — new | `packages/shared/src/schemas/*.test.ts` | FresherFormSchema and ProfessionalFormSchema accept valid and reject invalid payloads |

**Rubric test coverage requirement:** every parameter rubric must cover at minimum: the zero input, a mid-range input, and the maximum input, plus any important discrete values (e.g. enum cases for `relocation`, `maritalStatus`, `workMode`).

### API / integration tests (supertest + Vitest)

Run against an in-process NestJS app connected to a test Postgres database (seeded per-suite via `prisma migrate reset --force`).

| Suite | Scenarios |
|-------|-----------|
| Auth | Register → login → me; duplicate email → 409; wrong password → 401 |
| Profiles | PATCH draft → submit → score run created; re-submit → second score run; GET score-runs returns both |
| Scoring | POST submission (fresher) → score run total in expected range; POST submission (professional) → sensitive params in run breakdown; GET report (candidate) → sensitive absent; GET report (employer via grant) → sensitive present |
| Reports PDF | POST pdf → presigned URL returned; URL is fetchable; candidate PDF does not contain sensitive text |
| Consent | POST share → GET share/:id/report by employer → 200; DELETE share → employer GET → 403 |
| Claimable profile | Employer POST submission → profile claimable; GET claim/:token → 200; POST claim/accept → profile active; token reuse → 404 |
| Deletion | POST delete-request → login → 403; grants revoked |

### End-to-end tests (Playwright)

Run against the full stack (Next.js dev server + NestJS dev server + local Postgres + MinIO via docker-compose).

| Test | Steps | Assertions |
|------|-------|------------|
| Fresher happy path | Register (candidate) → select Fresher → complete all 7 wizard steps → submit → land on report | Score displayed, tier badge visible, no sensitive params in chart, PDF download link works, history shows 1 run |
| Professional happy path | Register (candidate) → select Professional → complete wizard (including sensitive disclosure gate) → submit → report | Score displayed, `hiddenParameterCount` notice shown, re-score button works |
| Re-score | Complete professional wizard → report → re-score → change 1 answer → submit → new report | New score may differ; history shows 2 runs; old run accessible by direct URL |
| Consent & employer view | Candidate grants consent → employer logs in → opens share link → sees full breakdown with sensitive fields | Sensitive section present; tip section absent |
| Employer submission | Employer logs in → submit candidate form → success page → email shown | Database has `claimable` profile; claim link visits claim page |
| Claim profile | Open claim link from employer submission → register → land on report | Profile status = active; existing score run visible |
| Revoke consent | Candidate grants → employer views → candidate revokes → employer re-visits | 403 page rendered for employer |
| Account deletion | Candidate requests deletion → logout → attempt login | Login returns error or redirects to deleted-account page |

---

## Dependencies

### Requires Phase 0

Phase 1 cannot begin until all Phase 0 deliverables exist:

| Phase 0 item | Needed for |
|--------------|-----------|
| Turborepo + pnpm monorepo scaffolded | All packages and apps exist |
| `packages/scoring` built and tested | Rubric layer can import from `@stabil/scoring` |
| NestJS app shell at `apps/api` | B1–B5 modules are added to an existing app |
| Next.js app shell at `apps/web` | A1–A8 pages are added to an existing app |
| Phase 0 auth shell (JWT strategy, guards) | B1 hardens the shell; A1 consumes the endpoints |
| CI pipeline (lint, type-check, Vitest) | Phase 1 tests run in the same pipeline |
| Postgres schema + Prisma client | Phase 1 migrations are applied on top of Phase 0 schema |

### External / tooling dependencies

| Dependency | Version constraint | Used by |
|------------|-------------------|---------|
| `@react-pdf/renderer` | `^4.x` | B4, PDF package |
| `react-chartjs-2` + `chart.js` | `^5.x` + `^4.x` | A5, A6 report charts |
| `react-hook-form` | `^7.x` | A3, A4 wizards |
| `@hookform/resolvers` | `^3.x` | Zod resolver for react-hook-form |
| `zod` | `^3.x` | Shared schemas |
| `bcrypt` | `^5.x` | B1 password hashing |
| `passport-jwt` | `^4.x` | B1 JWT strategy |
| `nodemailer` | `^6.x` | B2 claim invite email |
| `minio` (JS SDK) | `^8.x` | B4 MinIO upload + presigned URL |

---

## Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Weights uncalibrated** — The numeric weights in `stabilConfig` and the rubric bands in the table above are placeholders (SCOPE §13). A score produced in Phase 1 may not reflect real-world stability. | High (product validity) | Mark all weights and rubric bands as `PLACEHOLDER` in code comments and in the config file header. Add a `CALIBRATION_STATUS = "placeholder"` export from `packages/core`. Do not use Phase 1 scores for real hiring decisions until calibration is complete. |
| **Tier bands not calibrated** — The 5-tier boundary values in `tier.ts` are from the SCOPE §7 example ranges, not from validated data. | High (product validity) | Same as above; display a "Scores are in beta — bands are subject to change" banner in the dashboard until calibration. |
| **Legal / fairness risk** — Scoring on age and marital status may be unlawful in some hiring jurisdictions (SCOPE §12). | Critical | Implement the candidate-suppression correctly (AC #6, #10). Add a legal disclaimer to the employer report view and PDF. Before any real-world rollout, conduct a regional compliance review. |
| **PDF rendering performance** — `@react-pdf/renderer` runs synchronously in Node.js and can be slow for complex templates. | Medium | Generate PDFs asynchronously after scoring (fire-and-forget); serve cached `ReportArtifact` on subsequent requests. Monitor generation latency and add a job queue (BullMQ) if needed. |
| **Claim token security** — A guessable or reusable claim token lets an attacker claim another person's profile. | High | Use `crypto.randomBytes(32).toString('hex')` (256-bit entropy); token is single-use (cleared on accept); expires 7 days after creation. Enforce expiry and single-use in the claim endpoint. |
| **Drift between rubric and form schema** — If a new form field is added without a corresponding rubric function, the parameter scores 0 silently. | Medium | `applyRubrics` logs a warning (non-throwing) for any parameter key in `stabilConfig` that has no rubric function. A Vitest test asserts that every `stabilConfig` parameter key has a registered rubric. |
| **MinIO unavailability** — PDF download fails if MinIO is down. | Low (dev phase) | PDF download failure is surfaced as a non-blocking error (toast notification); scoring and report dashboard still work. MinIO health check is part of the API startup readiness probe. |

---

## Milestones

| Milestone | Contents | Gate |
|-----------|----------|------|
| **M1 · Scoring pipeline green** | B3 rubric layer + engine wrapper; B3 Vitest suites pass; `POST /api/v1/submissions` returns a valid `ScoreRun` | All rubric unit tests pass; determinism test passes |
| **M2 · Forms complete** | A3 fresher wizard + A4 professional wizard end-to-end; A2 mode selection; draft save working | Playwright fresher + professional happy paths pass |
| **M3 · Reports live** | A5 candidate dashboard (charts + tips); B4 PDF generation; PDF download working | AC #6, #9, #10 pass; candidate report Playwright test passes |
| **M4 · Employer view & consent** | A6 employer view; A7 consent UI; B5 consent module | AC #7, #11, #12 pass; employer view Playwright test passes |
| **M5 · Accounts & claimable profiles** | A1 auth hardened; A8 account settings; B2 claimable profile + claim flow; B1 deletion | AC #13, #14, #15, #16 pass; claim flow Playwright test passes |
| **M6 · Phase 1 complete** | All acceptance criteria pass; CI green; seed script works; docker-compose runs the full stack locally | All Playwright suites pass against local docker-compose stack; `vitest run` green; Prisma migration runs cleanly on fresh DB |
