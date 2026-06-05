# Phase 4 — Enhancements

> **Status:** Draft v0.1 · **Phase:** 4 · **Owner area:** frontend / backend / data
> **Related:** [phases/README.md](README.md) · [phases/phase-3-verification.md](phase-3-verification.md) · [architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md) · [backend/modules/employer-search.md](../backend/modules/employer-search.md) · [frontend/pages/employer-recruiter.md](../frontend/pages/employer-recruiter.md) · [SCOPE.md](../SCOPE.md)

Phase 4 delivers three independent enhancement tracks that were deliberately **designed-for now** but **deferred until after the POC is proven** (SCOPE §9 — "Post-POC / later enhancements"). Each track adds substantial product value without altering the invariants of the core scoring engine established in Phases 1–3. The tracks are:

1. **In-Platform Skill Tests** — scored assessments (e.g. the POC's "Python test 9/10") that feed a test sub-score into the existing engine via a new parameter placeholder.
2. **Richer Communication Assessment** — AI-scored written and/or spoken samples (via the provider-agnostic LLM adapter, default: OpenRouter) that augment or replace the self-rating from Phase 1.
3. **Employer/Recruiter Multi-Candidate Comparison & Ranking Dashboard** — search, filter, sort, side-by-side compare, and shortlisting across consented candidates.

All three tracks depend on Phases 1–3 being complete and deployed. They may be developed in parallel by separate sub-teams once Phases 0–3 are stable.

---

## Goal & outcomes

| Goal | Measurable outcome |
|------|--------------------|
| Objectify skill signals | At least one in-platform skill test type (e.g. Python MCQ) is deliverable, scored, and feeds the engine via the test sub-score parameter without changing core block math. |
| Reduce self-rating bias in Communication | Written and/or spoken communication samples replace or augment the Phase 1 self-rating; rubric-mapped fractions feed the existing `communication` parameter slot. |
| Enable multi-candidate employer workflows | Employers and recruiters can search, filter, sort by score/tier, compare candidates side-by-side, and maintain shortlists — with consent respected at every access point. |

---

## In scope / Out of scope

### In scope
- Skill test delivery (timed MCQ/coding), question bank management, anti-cheat measures, per-test scoring, mapping test score → normalized fraction → engine input.
- Communication sample submission (written text and/or audio upload), AI inference via the LLM adapter (default: OpenRouter), rubric evaluation, fraction output.
- Employer-side candidate search by score/tier/mode/location, filter/sort UI, side-by-side comparison panel, shortlist CRUD, consent-gated access enforcement.
- Backend modules: `employer-search` (search, filter, compare, shortlist logic) and test-delivery service.
- Frontend pages: employer/recruiter comparison dashboard, shortlist management view, test-taking flow (candidate-facing), communication sample submission UI.
- New parameter entries in `packages/scoring/src/config.ts` for `skillTest` (placeholder weight, block: `mode`, marked as placeholder) and updated `communication` parameter sourced from AI assessment.

### Out of scope
- Changing the fundamental three-block formula (`TOTAL = mode + common + verification`). The skill test is a **parameter inside the existing mode block**, not a new block.
- Third-party proctoring integrations (e.g. camera-based invigilation) — deferred beyond Phase 4.
- Commercially licensed question banks — all content in Phase 4 is internally authored or open-licensed.
- Switching from OpenRouter to a specific commercial provider for communication assessment — the default adapter (OpenRouter) already provides access to many models; a self-hosted adapter can be substituted via the DI interface.
- Native mobile test-taking (mobile-parity is a later concern; web-first for Phase 4 test delivery).

---

## Track 1 — In-Platform Skill Tests

### Overview

The POC briefing references a "Python test 9/10" as an example of an objective, verifiable skill signal. Phase 4 implements a full test-delivery sub-system that produces a `testScore` fraction in `[0,1]`, which the scoring engine consumes as a parameter value for the `skillTest` slot in the mode-specific block. The core math is unchanged; the weight is a calibration placeholder.

### Scoring integration (how the test feeds the engine without changing core math)

The `@stabil/scoring` engine consumes `ParameterValues = Record<string, number>` — normalized fractions in `[0,1]` per parameter key (AGENTS.md §4). Adding a skill test requires:

1. Adding a `skillTest` entry to `packages/scoring/src/config.ts` inside the `mode` block with a `max` of **0 (placeholder)** until weights are calibrated. Mark it with a `// PLACEHOLDER — calibrate in §13` comment. The "maxes sum to 1500 per mode" invariant is preserved because the placeholder starts at 0.
2. Once calibrated, the weight is raised and points shift within the mode block (other parameters' `max` values decrease proportionally so the block total stays constant). This is a data-driven edit to `config.ts`, not a formula change.
3. The **rubric layer** (`packages/core`) maps the raw test result (e.g. `9/10` or `72%`) to a fraction: `fraction = rawScore / maxPossibleRawScore`. For a 10-question test, `9/10 → 0.9`.
4. The API passes `{ skillTest: 0.9 }` into `ParameterValues` alongside all other parameters; the engine handles it identically to any other parameter.

```typescript
// packages/scoring/src/config.ts  (illustrative addition)
{
  key: "skillTest",
  label: "Skill Test",
  appliesTo: "both",          // available to both modes; test catalogue differs
  block: "mode",
  max: 0,                     // PLACEHOLDER — calibrate in §13; raise once weighted
  visibility: "all",          // score and result visible to candidate and employer
}
```

```typescript
// packages/core/src/rubrics/skillTest.ts
export function skillTestFraction(rawScore: number, maxScore: number): number {
  if (maxScore <= 0) return 0;
  return Math.min(1, rawScore / maxScore);
}
```

Cross-reference: [architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md) — extensibility section for how new parameters slot into the engine without formula changes.

### Sub-track scope

#### Test delivery
- Timed MCQ (multiple-choice questions) in-browser. Timer enforced server-side (attempt recorded at `startedAt`; submissions after `deadline = startedAt + durationSeconds` are rejected).
- Coding challenge delivery (optional, Phase 4b): sandboxed execution via an open-source judge (e.g. Judge0 self-hosted). Phase 4 baseline is MCQ only.
- Test attempt is a single session: once started, the clock runs. Candidates cannot pause.

#### Question bank
- Internal CMS-style admin interface (admin role, SCOPE §10 auth model) for authoring questions.
- Question entity: `id`, `body` (Markdown), `type` (`mcq` | `coding`), `difficulty` (`easy` | `medium` | `hard`), `correctAnswer`/`testCases`, `subject` (e.g. `python`, `javascript`, `aptitude`), `language` tag.
- A test *template* assembles questions by subject + difficulty distribution. Each attempt gets a shuffled question set drawn from the bank.
- Correct answers are **never transmitted to the frontend** — only question bodies and answer choices. Scoring happens exclusively server-side.

#### Anti-cheat measures

| Measure | Implementation |
|---------|----------------|
| Server-side timer | `startedAt` persisted in DB; deadline enforced at submission; late submissions score 0 for unsubmitted questions |
| Answer-choice shuffle | Question options shuffled per attempt (deterministic seed per `attemptId`) so copied answer keys don't transfer |
| Single active attempt | API rejects a second `POST /tests/:templateId/start` while an attempt is `in_progress` |
| Focus-loss detection | Frontend fires a `blur` event log; excessive focus losses are recorded (flag for human review, no automatic penalty in Phase 4) |
| No answer transmission | `GET /tests/:attemptId/questions` returns questions only; answer keys never leave the server |
| Rate limiting | `POST /tests/:attemptId/submit` is rate-limited per `userId` to prevent brute-force answer probing |

#### Scoring mapping (score → fraction)

```
rawScore   = count of correctly answered questions
maxScore   = total questions in the attempt
fraction   = skillTestFraction(rawScore, maxScore)   // from packages/core
             = rawScore / maxScore  (clamped to [0,1])
```

The fraction is then passed as `{ skillTest: fraction }` into the rubric layer's assembled `ParameterValues` before calling `computeScore`. The `ScoreResult.breakdown` will show the `skillTest` parameter row with `award = Math.round(fraction * max)` — which is 0 while the placeholder weight is 0, and non-zero after calibration.

### Data model additions (Track 1)

```prisma
model TestTemplate {
  id              String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  subject         String        // "python" | "javascript" | "aptitude" | ...
  title           String
  durationSeconds Int
  questionCount   Int
  difficultyDist  Json          // { easy: 3, medium: 5, hard: 2 }
  isActive        Boolean       @default(true)
  createdAt       DateTime      @default(now())
  attempts        TestAttempt[]
  questions       TestTemplateQuestion[]
}

model Question {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  subject        String
  type           String   // "mcq" | "coding"
  difficulty     String   // "easy" | "medium" | "hard"
  body           String   // Markdown
  choices        Json?    // [{ id, text }] for MCQ
  correctChoice  String?  // choice id — never returned to FE
  createdAt      DateTime @default(now())
  templates      TestTemplateQuestion[]
}

model TestTemplateQuestion {
  templateId  String        @db.Uuid
  questionId  String        @db.Uuid
  template    TestTemplate  @relation(fields: [templateId], references: [id])
  question    Question      @relation(fields: [questionId], references: [id])
  @@id([templateId, questionId])
}

model TestAttempt {
  id           String       @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  candidateId  String       @db.Uuid
  templateId   String       @db.Uuid
  template     TestTemplate @relation(fields: [templateId], references: [id])
  status       String       // "in_progress" | "submitted" | "expired"
  startedAt    DateTime     @default(now())
  submittedAt  DateTime?
  deadline     DateTime     // startedAt + durationSeconds
  rawScore     Int?
  maxScore     Int?
  fraction     Float?       // rubric-computed after submission
  answers      Json         // { questionId: choiceId } — stored after submission only
  focusLossLog Json         @default("[]")
  createdAt    DateTime     @default(now())
}
```

### API endpoints (Track 1)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/v1/tests/templates` | List available test templates for a mode/subject | candidate |
| `POST` | `/api/v1/tests/:templateId/start` | Start an attempt; returns attempt ID + shuffled questions (no answers) | candidate |
| `GET` | `/api/v1/tests/attempts/:attemptId` | Get current attempt state (time remaining, questions) | candidate (owner) |
| `POST` | `/api/v1/tests/attempts/:attemptId/submit` | Submit answers; triggers server-side scoring → fraction | candidate (owner) |
| `GET` | `/api/v1/tests/attempts/:attemptId/result` | Attempt result (score, fraction, subject) | candidate (owner) |
| `GET` | `/api/v1/admin/tests/questions` | Question bank list + filter | admin |
| `POST` | `/api/v1/admin/tests/questions` | Create question | admin |
| `POST` | `/api/v1/admin/tests/templates` | Create test template | admin |

### Task checklist — Track 1

#### Data / Prisma
- [ ] Add `TestTemplate`, `Question`, `TestTemplateQuestion`, `TestAttempt` models to Prisma schema
- [ ] Write and run migration
- [ ] Seed dev DB with a sample Python MCQ template (10 questions, 600s)

#### `packages/scoring` (engine)
- [ ] Add `skillTest` parameter definition to `config.ts` with `max: 0` and a `// PLACEHOLDER` comment
- [ ] Confirm "maxes sum to 1500 per mode" unit tests still pass with `max: 0` entry

#### `packages/core` (rubric)
- [ ] Implement `skillTestFraction(rawScore, maxScore): number` in `packages/core/src/rubrics/skillTest.ts`
- [ ] Unit-test edge cases: `rawScore = 0`, `rawScore = maxScore`, `maxScore = 0`

#### Backend — `apps/api`
- [ ] Create `TestsModule` with `TestTemplateService`, `TestAttemptService`, `QuestionBankService`
- [ ] Implement server-side timer enforcement in `TestAttemptService.submit()`
- [ ] Implement answer-choice shuffle (`seededShuffle(choices, attemptId)`)
- [ ] Implement server-side scoring: count correct answers → call `skillTestFraction` → persist `fraction`
- [ ] Integrate `fraction` into the profile's `ParameterValues` when `computeScore` is triggered
- [ ] Implement admin question-bank CRUD endpoints guarded by `AdminGuard`
- [ ] Rate-limit `POST /attempts/:id/submit` (e.g. 5 req/min per user via `@nestjs/throttler`)

#### Frontend — `apps/web` (candidate-facing)
- [ ] Test catalogue page: list available tests by subject/mode
- [ ] Test-start confirmation modal (shows duration, rules, anti-cheat notice)
- [ ] Test-taking UI: question cards, timer countdown (synced from server `deadline`), radio/option selection
- [ ] Submit flow: confirm dialog → POST → result screen (score + fraction + impact on stability score)
- [ ] Focus-loss event logger (fires on `window.blur`; sends batch log on submit)
- [ ] Show `skillTest` parameter row in candidate report breakdown once weight > 0

---

## Track 2 — Richer Communication Assessment

### Overview

Phase 1 collects a self-reported communication rating (1–5 scale) and optional verifiable certificates as a proxy for communication ability (SCOPE §2 decision 10, §4.2, §4.5). Phase 4 replaces or augments this with AI-scored written and/or spoken samples, keeping the same `communication` parameter key and fraction interface. No engine changes are required — only the rubric mapping and data sources change.

This track uses the same **provider-agnostic LLM adapter** established in Phase 2 (default: OpenRouter). Communication sample text (which may contain personal information) is sent to OpenRouter; choose a model with a **no-training / zero-retention** policy. The adapter interface allows substituting a self-hosted model if stricter data residency is required.

### Signal sources

| Sample type | Input | Self-hosted model | Output |
|-------------|-------|-------------------|--------|
| Written sample | Free-text response to a prompt (e.g. "Describe a challenge you overcame professionally") | LLM adapter (default: OpenRouter, e.g. `openai/gpt-4o-mini`) | Rubric dimension scores → aggregate fraction |
| Spoken sample | Audio upload (WAV/M4A/MP3, ≤ 2 min) | Whisper (speech-to-text, self-hosted via `whisper.cpp`) → transcript → same LLM adapter | Same rubric dimension scores |

Both sample types produce the **same rubric output format**; the distinction is only in how the text was obtained.

### Rubric

The rubric evaluates the text along five dimensions. Each dimension is scored 1–4 by the model, then normalized to `[0,1]`.

| Dimension | Weight in composite | What is assessed |
|-----------|--------------------|------------------|
| **Clarity** | 25% | Ideas expressed unambiguously; logical sentence structure |
| **Coherence** | 20% | Argument flows; transitions between ideas |
| **Vocabulary** | 20% | Range and appropriateness of word choice |
| **Grammar & mechanics** | 20% | Grammatical correctness, punctuation, spelling |
| **Relevance** | 15% | Response addresses the prompt; stays on-topic |

```typescript
// packages/core/src/rubrics/communication.ts (illustrative)
export interface CommunicationDimensions {
  clarity: number;       // 1–4
  coherence: number;     // 1–4
  vocabulary: number;    // 1–4
  grammar: number;       // 1–4
  relevance: number;     // 1–4
}

const WEIGHTS = { clarity: 0.25, coherence: 0.20, vocabulary: 0.20, grammar: 0.20, relevance: 0.15 };

export function communicationFraction(dims: CommunicationDimensions): number {
  const weighted =
    (dims.clarity * WEIGHTS.clarity) +
    (dims.coherence * WEIGHTS.coherence) +
    (dims.vocabulary * WEIGHTS.vocabulary) +
    (dims.grammar * WEIGHTS.grammar) +
    (dims.relevance * WEIGHTS.relevance);
  // weighted is in [1,4]; normalize to [0,1]
  return (weighted - 1) / 3;
}
```

### Model prompt contract

The LLM adapter (OpenRouter by default) call uses a **structured evaluation prompt** that:
1. Provides the rubric dimensions and their 1–4 scale definitions.
2. Provides the candidate's text (transcript or written sample) as the evaluated artifact.
3. Instructs the model to return a **JSON object only**, with no prose before or after.
4. Example expected response: `{"clarity":3,"coherence":3,"vocabulary":2,"grammar":3,"relevance":4}`.

Parsing is strict: if the model response is not valid JSON or contains out-of-range values, the assessment is flagged `status: "failed"` and the system falls back to the Phase 1 self-rating fraction. The fallback prevents a model inference failure from zeroing out a candidate's communication score.

### Fairness notes

- **Prompt neutrality:** The evaluation prompt must not reference the candidate's name, nationality, or any demographic signal. Only the text content is evaluated.
- **Language scope:** Phase 4 assesses English-language samples only. Non-English samples should be detected (language detection via `franc` or similar) and gracefully rejected with a user-facing message rather than evaluated with a lower score.
- **Inter-rater calibration:** Periodically sample a fixed set of labeled texts, run them through the model, and compare model scores to human-rated ground truth. Log drift. Recalibrate the prompt or rubric weights if systematic bias is detected.
- **Fallback visibility:** If the assessment falls back to the self-rating, the candidate report breakdown notes "Communication: self-reported" rather than "AI-assessed" so the source is transparent.
- **No adverse-action sole reliance:** The communication fraction is one parameter among many. The explainability UI must make clear that the AI assessment is one contributing factor, not a standalone hiring determination.

### Scoring mapping (Phase 4 vs Phase 1)

| Phase | Source | Fraction derivation |
|-------|--------|---------------------|
| 1 | Self-rating (1–5) + cert bonus | `(selfRating - 1) / 4` + cert top-up |
| 4 (AI sample present) | AI-scored rubric dimensions | `communicationFraction(dims)` |
| 4 (AI sample failed / absent) | Fall back to Phase 1 self-rating | Phase 1 formula — no score regression |

When a Phase 4 AI assessment is present, it **replaces** the self-rating fraction (the self-rating field from Phase 1 is still persisted for audit; it just does not drive the fraction). Verifiable communication certificates from Phase 1 may be retained as a **bonus top-up** (up to a capped fraction increment, e.g. `+0.1`, calibrated in §13).

### Data model additions (Track 2)

```prisma
model CommunicationAssessment {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  profileId        String   @db.Uuid
  sampleType       String   // "written" | "spoken"
  prompt           String   // the evaluation prompt shown to the candidate
  rawText          String?  // written sample or Whisper transcript
  audioStorageKey  String?  // MinIO key for original audio file (spoken samples)
  modelId          String   // e.g. "openai/gpt-4o-mini" — which model (via OpenRouter) scored this
  dimensionScores  Json?    // { clarity, coherence, vocabulary, grammar, relevance }
  fraction         Float?   // communicationFraction output
  status           String   // "pending" | "scored" | "failed"
  failureReason    String?
  createdAt        DateTime @default(now())
  scoredAt         DateTime?
}
```

### API endpoints (Track 2)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `POST` | `/api/v1/profiles/:id/communication/written` | Submit written sample; enqueues AI scoring job | candidate (owner) |
| `POST` | `/api/v1/profiles/:id/communication/spoken` | Upload audio file (multipart); enqueues transcription + scoring | candidate (owner) |
| `GET` | `/api/v1/profiles/:id/communication/assessment` | Get latest assessment result + status | candidate (owner), employer/recruiter (consented) |

Audio transcription and AI scoring are **async** (NestJS queue via BullMQ or similar): the POST returns `202 Accepted` with `{ assessmentId }`, and the client polls or receives a push notification when scoring is complete.

### Task checklist — Track 2

#### Data / Prisma
- [ ] Add `CommunicationAssessment` model to Prisma schema
- [ ] Write and run migration
- [ ] Index on `(profileId, status)` for fast pending-assessment lookups

#### `packages/core` (rubric)
- [ ] Implement `communicationFraction(dims: CommunicationDimensions): number`
- [ ] Implement language detection helper (`isSupportedLanguage(text): boolean`)
- [ ] Unit-test rubric: min dims (all 1s) → 0.0, max dims (all 4s) → 1.0, mixed → expected composite

#### Backend — `apps/api`
- [ ] `CommunicationModule`: `WrittenAssessmentService`, `SpokenAssessmentService`, `LlmEvaluationService`
- [ ] `LlmEvaluationService`: reuses the `LlmAdapter` interface from Phase 2 (default: `OpenRouterAdapter`); structured prompt builder, JSON response parser with strict validation, retry logic (up to 3 attempts with exponential backoff)
- [ ] Whisper transcription service (self-hosted `whisper.cpp` sidecar): receives audio `storageKey`, returns transcript text
- [ ] Async job queue for transcription + evaluation (BullMQ worker, Redis-backed)
- [ ] Fallback logic: if `status = "failed"`, use Phase 1 self-rating fraction; log fallback event
- [ ] Integrate AI-assessed fraction into score computation: supersedes self-rating when `status = "scored"`
- [ ] Audio upload: accept via MinIO-backed upload (same pattern as documents from Phase 3); enforce 2 min / 10 MB limits
- [ ] Language detection pre-check before queuing AI evaluation

#### Frontend — `apps/web` (candidate-facing)
- [ ] Communication sample submission UI in the profile/forms flow:
  - Mode toggle: "Written sample" vs "Spoken sample"
  - Written: `<textarea>` with prompt, character count (min 100, max 800 words), submit button
  - Spoken: audio recorder (MediaRecorder API) or file upload; playback preview before submit
- [ ] Async status indicator: "Assessment in progress…" → polling → result display
- [ ] Candidate report: show "Communication" parameter row with source label ("AI-assessed" / "self-reported")
- [ ] Fallback notice when assessment failed: "AI scoring unavailable — using self-rating"

---

## Track 3 — Employer/Recruiter Multi-Candidate Comparison & Ranking Dashboard

### Overview

Phase 1 delivers single-candidate report views for employers and recruiters (SCOPE §2 decision 23 — "single reports in POC; comparison/ranking dashboard later"). Phase 4 builds the full multi-candidate workflow: search a pool of consented candidates, filter and sort by score/tier/mode/location, compare up to N candidates side-by-side, and maintain named shortlists. This track directly implements the functionality documented in [backend/modules/employer-search.md](../backend/modules/employer-search.md) and [frontend/pages/employer-recruiter.md](../frontend/pages/employer-recruiter.md).

**Consent and visibility rules are unchanged and non-negotiable.** Every query, every comparison, and every shortlist entry is restricted to candidates who have given explicit per-share consent (SCOPE §6.2). Sensitive attributes (age, marital status) remain visible to employers/recruiters but are hidden from candidate-facing views (SCOPE §6.3). These invariants are enforced at the API layer, not just the UI.

### Functional scope

#### Search & filter
- Full-text search over candidate name (employer-visible), skills declared, location, and job title.
- Filters: mode (`fresher` | `professional`), stability tier, score range (min–max), location (city/state/country), verification status (`verified` | `any`), availability to relocate.
- Pagination: cursor-based (UUID v7 ordering for consistency).
- Results include: candidate `displayName`, score, tier, mode, location, verified badge, `profileId`.

#### Sort
- Sort by: `score` (desc default), `tier` (desc), `name` (asc/desc), `submittedAt` (newest/oldest).

#### Side-by-side comparison
- Select 2–4 candidates from the search results or a shortlist.
- Comparison panel shows parameters side-by-side in a table: each row = a parameter, each column = a candidate. Employer-only parameters (age, marital status) are shown. Candidate-only-suppressed items are shown at full detail.
- Breakdown bars visualize each candidate's fraction per parameter (Chart.js horizontal bar).
- Export comparison as PDF or CSV.

#### Shortlists
- Employer/recruiter can create named shortlists (e.g. "Q3 Python Hires").
- Add/remove candidates from a shortlist by `profileId`.
- Shortlists are scoped to the employer/recruiter's account; not shared cross-account without an explicit team-sharing feature (out of scope for Phase 4).
- A shortlisted candidate whose consent is later revoked is automatically hidden (their row shows a "consent withdrawn" placeholder, not their data).

#### Consent enforcement (architecture)

Every query in the employer-search module joins against the `ConsentGrant` table (from Phase 1's consent-sharing module). Only profiles with `status = "active"` and `audienceType IN ("employer", "recruiter")` matching the requesting user's role are returned. This join is in the SQL query itself — not a post-filter — ensuring no revoked-consent data is ever loaded into application memory.

```mermaid
sequenceDiagram
  participant ER as Employer/Recruiter
  participant FE as apps/web
  participant API as NestJS API (EmployerSearchModule)
  participant DB as PostgreSQL

  ER->>FE: Search candidates (filters, sort, page)
  FE->>API: GET /api/v1/employer/candidates?tier=settled&mode=professional&sort=score
  API->>API: Extract userId + role from JWT; assert role is employer|recruiter
  API->>DB: SELECT profiles JOIN consent_grants ON profiles.id = cg.profile_id\n  WHERE cg.grantee_id = :userId\n  AND cg.status = 'active'\n  AND filters apply
  DB-->>API: Consented, matching candidate rows
  API->>API: filterForAudience(result, "employer") for each profile
  API-->>FE: Paginated list (score, tier, breakdown, verified badge)
  FE-->>ER: Search results page
```

### Backend module: `employer-search`

Full module spec lives at [backend/modules/employer-search.md](../backend/modules/employer-search.md). Phase 4 implements it end-to-end.

**Key services:**

| Service | Responsibility |
|---------|----------------|
| `CandidateSearchService` | Query builder: applies filters, joins consent grants, paginates |
| `ComparisonService` | Assembles side-by-side comparison payload for 2–4 profiles |
| `ShortlistService` | CRUD for shortlists + shortlist entries; enforces consent revocation |

**Indexing requirements (Postgres):**

```sql
-- Score and tier are the most-filtered columns
CREATE INDEX idx_score_runs_total ON score_runs(total DESC);
CREATE INDEX idx_score_runs_tier  ON score_runs(tier);
CREATE INDEX idx_consent_grants_active ON consent_grants(grantee_id, profile_id, status)
  WHERE status = 'active';
CREATE INDEX idx_profiles_location ON profiles USING GIN(to_tsvector('english', location));
```

### API endpoints (Track 3)

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/v1/employer/candidates` | Search/filter/sort consented candidates | employer, recruiter |
| `GET` | `/api/v1/employer/candidates/compare` | Side-by-side comparison (`?ids=a,b,c`) | employer, recruiter |
| `GET` | `/api/v1/employer/shortlists` | List shortlists for the requesting user | employer, recruiter |
| `POST` | `/api/v1/employer/shortlists` | Create shortlist | employer, recruiter |
| `GET` | `/api/v1/employer/shortlists/:id` | Get shortlist + entries | employer, recruiter |
| `POST` | `/api/v1/employer/shortlists/:id/entries` | Add candidate to shortlist | employer, recruiter |
| `DELETE` | `/api/v1/employer/shortlists/:id/entries/:profileId` | Remove candidate from shortlist | employer, recruiter |
| `DELETE` | `/api/v1/employer/shortlists/:id` | Delete shortlist | employer, recruiter |
| `GET` | `/api/v1/employer/candidates/compare/export` | Export comparison as CSV | employer, recruiter |

### Data model additions (Track 3)

```prisma
model Shortlist {
  id          String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  ownerId     String          @db.Uuid   // employer or recruiter userId
  name        String
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
  entries     ShortlistEntry[]
}

model ShortlistEntry {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  shortlistId  String    @db.Uuid
  profileId    String    @db.Uuid
  addedAt      DateTime  @default(now())
  shortlist    Shortlist @relation(fields: [shortlistId], references: [id])
  @@unique([shortlistId, profileId])
}
```

### Frontend page: employer/recruiter comparison dashboard

Full page spec lives at [frontend/pages/employer-recruiter.md](../frontend/pages/employer-recruiter.md). Phase 4 implements it end-to-end.

**Page layout (ASCII wireframe — desktop):**

```
┌──────────────────────────────────────────────────────────────────────┐
│  STABIL  [Employer Dashboard]                    [Account] [Shortlists]│
├──────────────────────────────────────────────────────────────────────┤
│  Search: [___________________________] [Search]                        │
│  Filters: Mode[v]  Tier[v]  Score[___–___]  Location[v]  Verified[v]  │
│  Sort: Score ▼                                          [Compare (2)]  │
├──────────────────────────────────────────────────────────────────────┤
│  [ ] Candidate A  ████████████ 1240/1500  Settled  ✓ Verified  Pune  │
│  [ ] Candidate B  ██████████── 1105/1500  Settled        Mumbai       │
│  [ ] Candidate C  ████████──── 980/1500   Somewhat Stable  Delhi      │
│      ...                                          [Load more]          │
├──────────────────────────────────────────────────────────────────────┤
│  SHORTLISTS                                                            │
│  [+ New shortlist]  Q3 Python Hires (4)  Senior Backend (2)           │
└──────────────────────────────────────────────────────────────────────┘
```

**Side-by-side comparison panel (activated on "Compare (N)"):**

```
┌──────────────────────────────────────────────────────────────────────┐
│  Comparing: Candidate A vs Candidate B                   [Export CSV]  │
├────────────────────────┬──────────────────┬──────────────────────────┤
│  Parameter             │  Candidate A     │  Candidate B             │
├────────────────────────┼──────────────────┼──────────────────────────┤
│  Total Score           │  1240 / 1500     │  1105 / 1500             │
│  Tier                  │  Settled         │  Settled                 │
│  Mode                  │  Professional    │  Professional            │
│  Total Experience      │  ████████░░ 8/10 │  ██████░░░░ 6/10        │
│  Tenure                │  █████████░ 9/10 │  ████████░░ 8/10        │
│  Communication         │  ███████░░░ 7/10 │  █████░░░░░ 5/10        │
│  Skill Test (Python)   │  █████████░ 9/10 │  ████████░░ 8/10        │
│  Age                   │  32              │  28                      │
│  Marital Status        │  Married         │  Single                  │
│  Verified              │  ✓               │  ✗                       │
│  ...                   │  ...             │  ...                     │
└────────────────────────┴──────────────────┴──────────────────────────┘
```

Employer-only fields (Age, Marital Status) appear in the employer/recruiter comparison view and are never shown to candidates (SCOPE §6.3, `Visibility = "employer-only"`). The breakdown bars use Chart.js horizontal bar charts (`Bar` component from `react-chartjs-2`).

### Task checklist — Track 3

#### Data / Prisma
- [ ] Add `Shortlist` and `ShortlistEntry` models to Prisma schema
- [ ] Write and run migration
- [ ] Add performance indexes: `score_runs(total DESC)`, `score_runs(tier)`, `consent_grants(grantee_id, profile_id, status)`, GIN index on `profiles.location`

#### Backend — `apps/api`
- [ ] Create `EmployerSearchModule` per spec at [backend/modules/employer-search.md](../backend/modules/employer-search.md)
- [ ] `CandidateSearchService`: Prisma query builder with consent-join, filters, cursor pagination, sort
- [ ] `ComparisonService`: fetch 2–4 profiles + their latest score runs; apply `filterForAudience("employer")` per profile; assemble comparison DTO
- [ ] `ShortlistService`: CRUD + consent-revocation auto-hide (query shortlist entries joined against active consent grants)
- [ ] CSV export service: serialize comparison DTO to CSV using `fast-csv` or equivalent
- [ ] Guards: `EmployerRecruiterGuard` (asserts `role IN ("employer", "recruiter")`) on all `/employer/*` routes
- [ ] Unit tests for `CandidateSearchService` consent-join logic (mock DB; assert revoked-consent profiles never appear)
- [ ] Integration test: shortlist entry for a candidate who revokes consent → entry returns `{ consentWithdrawn: true }`, not profile data

#### Frontend — `apps/web` (employer/recruiter-facing)
- [ ] Candidate search page per spec at [frontend/pages/employer-recruiter.md](../frontend/pages/employer-recruiter.md)
- [ ] Search bar + filter panel (shadcn/ui `Select`, `Slider`, `Checkbox` components)
- [ ] Results list: sortable table with score bar (Chart.js `Bar`), tier badge, verified badge, checkbox for comparison selection
- [ ] "Compare (N)" button activates once ≥ 2 candidates are selected (max 4)
- [ ] Comparison panel/modal: parameter table with horizontal bar charts per parameter per candidate
- [ ] Shortlist sidebar/drawer: list shortlists, create new, add/remove candidates via drag or button
- [ ] Consent-withdrawn state: grayed-out row with "Consent withdrawn" label, no data shown
- [ ] CSV export button in comparison panel
- [ ] Mobile-responsive: search/filter collapses to drawer; comparison limited to 2 candidates on mobile

---

## Deliverables

### Track 1 — In-Platform Skill Tests
- `packages/scoring/src/config.ts` with `skillTest` placeholder parameter entry.
- `packages/core/src/rubrics/skillTest.ts` with `skillTestFraction`.
- `TestsModule` in `apps/api` with full test-delivery, scoring, and admin CMS endpoints.
- Candidate test-taking UI in `apps/web`.
- Prisma migration: `TestTemplate`, `Question`, `TestTemplateQuestion`, `TestAttempt`.
- Unit tests: rubric, engine invariant (sums to 1500), attempt expiry, answer-not-transmitted.

### Track 2 — Richer Communication Assessment
- `packages/core/src/rubrics/communication.ts` with `communicationFraction`.
- `CommunicationModule` in `apps/api` with LLM evaluation service (written + spoken, via OpenRouter adapter), Whisper transcription, async job queue, fallback logic.
- Prisma migration: `CommunicationAssessment`.
- Candidate communication sample submission UI in `apps/web`.
- Rubric unit tests + model prompt contract tests (mock LLM adapter / `StubLlmAdapter`).

### Track 3 — Employer/Recruiter Comparison Dashboard
- `EmployerSearchModule` in `apps/api` with search, compare, shortlist, and CSV export services.
- Prisma migration: `Shortlist`, `ShortlistEntry` + performance indexes.
- Employer/recruiter search, comparison, and shortlist UI in `apps/web`.
- Consent-enforcement unit tests and integration tests.

---

## Acceptance criteria (Definition of Done)

### Track 1 acceptance criteria
- [ ] A candidate can browse available test templates, start a timed attempt, and submit answers within the deadline.
- [ ] Submitting after the deadline returns HTTP 400; any unsubmitted answers score 0.
- [ ] The server never returns correct answers in any API response to the candidate client.
- [ ] Answer choices are visibly shuffled between two fresh attempts of the same template.
- [ ] `skillTest` parameter appears in the engine config; the "maxes sum to 1500" test passes without modification after the placeholder (`max: 0`) is added.
- [ ] A completed attempt's fraction (`rawScore / maxScore`) is stored in `TestAttempt.fraction` and flows into `ParameterValues` on the next score computation.
- [ ] Admin can create, list, and deactivate questions and templates via authenticated API.
- [ ] Focus-loss events are logged and retrievable but do not automatically penalize the score.

### Track 2 acceptance criteria
- [ ] A candidate can submit a written sample (100–800 word range enforced) and receive an AI-assessed fraction within 60 seconds under typical load.
- [ ] A candidate can upload an audio file (≤ 10 MB, ≤ 2 min); it is transcribed by the self-hosted `whisper.cpp` service and evaluated by the same LLM rubric pipeline.
- [ ] Non-English text is detected and rejected with a user-facing error before being sent to the evaluation model.
- [ ] If the LLM adapter (OpenRouter) returns invalid JSON or out-of-range scores, `status` is set to `"failed"` and the Phase 1 self-rating fraction is used without any score regression.
- [ ] The candidate report breakdown labels the communication parameter "AI-assessed" when a scored assessment is present, and "self-reported" when falling back.
- [ ] Audio files are stored in MinIO; the raw audio is not returned in any API response (only the transcript and assessment result are returned).
- [ ] `communicationFraction` with all dimensions = 1 → 0.0; all dimensions = 4 → 1.0 (unit test passes).

### Track 3 acceptance criteria
- [ ] An employer/recruiter can search the candidate pool and see only candidates who have given them explicit per-share consent.
- [ ] A candidate who revokes consent disappears from search results on the next query (no stale cache serves their data beyond 60 seconds).
- [ ] An employer can filter by tier, score range, mode, location, and verified status; results are correctly restricted to those criteria.
- [ ] Selecting 2–4 candidates and opening the comparison panel shows a parameter-by-parameter table with correct scores and employer-only fields (age, marital status) visible.
- [ ] Candidate-view suppressed fields (age, marital status) do not appear if the API is called with a candidate-role JWT.
- [ ] Shortlist CRUD is fully functional: create, rename (if applicable), add candidate, remove candidate, delete shortlist.
- [ ] A shortlist entry for a candidate who subsequently revokes consent renders a consent-withdrawn placeholder — no candidate data is returned.
- [ ] CSV export from the comparison panel produces a valid, parseable CSV with one column per candidate and one row per parameter.
- [ ] All `/api/v1/employer/*` routes return HTTP 403 for any JWT with `role = "candidate"`.

---

## Test strategy

### Unit tests (Vitest)
- `packages/scoring`: confirm `skillTest` placeholder does not break the 1500-max invariant; once weight > 0, confirm `Math.round(fraction * max)` award is correct.
- `packages/core/rubrics/skillTest`: edge cases for `skillTestFraction`.
- `packages/core/rubrics/communication`: dimension extremes, weighted composite formula.
- `CandidateSearchService` (mocked Prisma): consent-join excludes revoked grants; filter combinations produce correct WHERE clauses.
- `ShortlistService`: revoked consent auto-hide logic.

### Integration tests (supertest + test DB)
- Full test attempt lifecycle: start → fetch questions (assert no `correctChoice` in response) → submit on time → fraction persisted → score recomputed.
- Communication pipeline: submit written sample → `StubLlmAdapter` returns valid JSON → fraction stored → score reflects new fraction.
- Communication fallback: `StubLlmAdapter` returns garbage → `status = "failed"` → score uses Phase 1 self-rating, no regression.
- Employer search: seed profiles with and without active consent grants; assert only consented profiles returned.
- Shortlist entry consent withdrawal: revoke consent mid-test; assert shortlist entry returns placeholder.

### End-to-end tests (Playwright)
- Candidate test-taking happy path: start test → answer all questions → submit → see result.
- Timer expiry: manipulate `deadline` in test DB to past; assert expired message on test page load.
- Employer search and compare: log in as employer → search → apply tier filter → select 2 candidates → open comparison panel → verify parameter table renders.

---

## Dependencies

| Dependency | Source | Notes |
|------------|--------|-------|
| Phase 0 — Foundations | [phase-0-foundations.md](phase-0-foundations.md) | Monorepo, CI, shared packages, auth shell must be in place |
| Phase 1 — Core scoring + report | [phase-1-core-scoring.md](phase-1-core-scoring.md) | `@stabil/scoring` engine, `packages/core` rubric layer, consent-sharing module, employer/recruiter accounts and report views |
| Phase 2 — Parsing | [phase-2-parsing.md](phase-2-parsing.md) | OpenRouter adapter and provider-agnostic LLM infrastructure reused for Track 2 communication assessment |
| Phase 3 — Verification | [phase-3-verification.md](phase-3-verification.md) | `ConsentGrant` table + consent-sharing module required for Track 3 search consent-join |
| `packages/scoring` extensibility | [architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md) | Engine must accept new parameter keys without formula change (data-driven config) |
| OpenRouter API key | `OPENROUTER_API_KEY` env var | Track 2 evaluation calls the same `LlmAdapter` as Phase 2; ensure the model selected has a no-training / zero-retention policy |
| Whisper (Track 2) | Self-hosted `whisper.cpp` sidecar | Required for spoken sample transcription; runs in-process, no external calls |
| MinIO (Track 2) | Phase 0 / [CLOUD.md](../CLOUD.md) | Audio file storage |
| BullMQ + Redis (Track 2) | New infra dependency | Async job queue for AI evaluation jobs |
| PostgreSQL indexes (Track 3) | Phase 0 / [architecture/02-data-model.md](../architecture/02-data-model.md) | Performance indexes must be created before enabling employer search in production |

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Skill test placeholder weight (max: 0) causes confusing "0 points" display** | High (guaranteed until calibrated) | Low | Suppress `skillTest` parameter row from all report views while `max = 0`; add a `hidden: true` flag to the parameter definition checked by the report renderer |
| **LLM evaluation model produces inconsistent scores** | Medium | High (score unfairness) | Implement inter-rater calibration against labeled ground-truth samples; if model consistency falls below threshold (e.g. Pearson r < 0.8 vs human raters), fall back to self-rating system-wide until model is improved |
| **Whisper transcription accuracy varies by accent/audio quality** | Medium | Medium | Set minimum audio quality floor (SNR check via a lightweight utility); reject very low-quality recordings before transcription; communicate clearly that "clear audio in a quiet environment" is required |
| **Communication AI assessment introduces bias** | Medium | High (legal/fairness) | Blind prompt (no demographic info); English-only scope with explicit language detection; periodic human-review sample of assessments; maintain audit log of all assessments |
| **Consent enforcement gap in employer search** | Low | Critical | Consent join is in SQL, not a post-filter; reviewed in code review; integration test asserts revoked profiles never appear |
| **MinIO storage costs for audio files** | Low (self-hosted) | Low | Enforce per-candidate audio file count limit (e.g. keep latest 3 assessments); delete audio after successful transcription (transcript is the durable artifact) |
| **BullMQ/Redis adds operational complexity** | Medium | Medium | Use a lightweight Redis (single-instance, no cluster) for Phase 4; document in [CLOUD.md](../CLOUD.md); if Redis is unacceptable, implement a simple DB-polling queue as fallback |
| **Test question bank quality** | Medium | Medium | Admin review workflow: questions are not surfaced in tests until an admin marks them `isActive = true`; seed a minimal reviewed bank before launch |
| **Engine weight calibration lag (skill test stays at 0)** | High | Low | Document clearly in release notes and in the parameter config that `skillTest` weight is a placeholder; set a calibration milestone in the project roadmap |
| **Multi-candidate comparison performance at scale** | Medium | Medium | Limit comparison to 4 candidates per request; eager-load only the latest `score_run` per profile; use the performance indexes defined above; add query timeout at the Prisma client level |

---

## Milestones

| Milestone | Tracks | Deliverable |
|-----------|--------|-------------|
| **M4.0 — Engine placeholder** | 1 | `skillTest` parameter added to `config.ts` with `max: 0`; unit tests pass; PR merged |
| **M4.1 — Rubric layer complete** | 1, 2 | `skillTestFraction` and `communicationFraction` implemented, unit-tested, and merged into `packages/core` |
| **M4.2 — Test delivery backend** | 1 | `TestsModule` complete with delivery, scoring, and admin endpoints; integration tests passing |
| **M4.3 — Test-taking UI** | 1 | Candidate can take a full timed MCQ test in-browser; result flows into score |
| **M4.4 — Communication backend** | 2 | `CommunicationModule` complete; LLM evaluation (via OpenRouter adapter) + Whisper transcription + fallback logic; integration tests passing |
| **M4.5 — Communication UI** | 2 | Written and spoken sample submission flows in-browser; async result display |
| **M4.6 — Employer search backend** | 3 | `EmployerSearchModule` complete; consent-join search, comparison, shortlist, CSV export; integration and consent-enforcement tests passing |
| **M4.7 — Employer comparison UI** | 3 | Full employer/recruiter dashboard: search, filter, sort, compare panel, shortlist management; e2e tests passing |
| **M4.8 — Phase 4 QA & calibration handoff** | All | All acceptance criteria met; `skillTest` weight calibration task logged for §13 follow-up; performance tested; documentation updated |
