# Stabil — Documentation Hub

This is the index and **authoring contract** for all Stabil documentation. The project
scope is defined in **[SCOPE.md](SCOPE.md)** (authoritative). Everything here elaborates
that scope into an implementable, phased plan across frontend, backend, data, and cloud.

> If a detail here ever conflicts with `SCOPE.md`, `SCOPE.md` wins — open a PR to fix the drift.

---

## How to read these docs

1. **New to the project?** → `SCOPE.md` → `AGENTS.md` → `architecture/01-overview.md`.
2. **Building a feature?** → find its **phase** in `phases/`, then the relevant
   `frontend/pages/*` and `backend/modules/*` docs.
3. **Deploying / infra?** → `CLOUD.md`.

---

## Canonical facts (single source of truth — never contradict)

These are distilled from `SCOPE.md`. Every doc must stay consistent with them.

| Topic | Fact |
|-------|------|
| Product | Scores how **stable** a person is → number `0–1500` + a tier. Explainable report. |
| Audiences | **Employer**, **Recruiter**, **Candidate** (all three view reports). Not affiliated with TeacherOp. |
| Modes | **2**, user-selected: **Fresher**, **Working Professional**. |
| Score basis | **Role-agnostic** (one score per person). |
| Score scale | **0–1500**, shared across both modes. |
| Scoring method | **Fixed expert weights** (deterministic, explainable). No ML in POC. |
| Score composition | `TOTAL = mode-specific block + common block + verification bonus`. |
| Blocks | `mode` \| `common` \| `verification`. The "common" block = the POC's "Generic" score. |
| Signal sources | **Mix per parameter**: forms / resume-parsing / assessment. |
| Languages | Fresher = **programming**; Professional = **spoken**. |
| Sensitive attrs | **Age, marital status** are scored but **hidden from the candidate view** (employer-only `visibility`). |
| Communication | Self-rating + verifiable certs now; richer AI analysis later. |
| Skill tests | **Later phase** (engine designed to accept a test sub-score). |
| Tiers (5) | `unstable` → `developing` → `somewhat-stable` → `settled` → `stable` (bands TBD/calibrated). |
| Verification | **Phased**: OCR + manual review now → KYC/government APIs later. |
| Geo | **India + international** documents from the start. |
| Submission | **Both**: candidate self-onboards **and** employer submits → **claimable profile**. |
| Accounts | Yes; **re-scoring over time** (improvement loop). |
| Consent | **Explicit per-share consent** before any employer/recruiter view. |
| Retention | Keep while account active; **delete on request**. |
| Platforms | **Web app + mobile app**. |
| Report delivery | **In-app dashboard + PDF export**. |
| Employer multi-candidate | **Phased**: single reports first → comparison/ranking dashboard later. |

### Tech stack (free / self-hosted for now)

| Layer | Choice |
|-------|--------|
| Monorepo | **Turborepo + pnpm** (TypeScript everywhere) |
| Web | **Next.js 15** (App Router, React 19, TS) + Tailwind + shadcn/ui |
| Mobile | **Expo / React Native** + TS + NativeWind |
| API | **NestJS** (TS) |
| Scoring | `packages/scoring` — pure, deterministic, unit-tested (already built) |
| DB | **PostgreSQL + Prisma** |
| Auth | Role-based (candidate / employer / recruiter / admin), JWT for mobile |
| Storage | **MinIO** (self-hosted, S3-compatible); local disk for dev |
| AI parsing | **Provider-agnostic adapter; default = self-hosted Ollama** + **Tesseract** OCR. PII stays in-house. |
| Validation | **Zod** (shared schemas) |
| Charts (web) | **Chart.js** via **react-chartjs-2** |
| PDF | **@react-pdf/renderer** |
| Testing | **Vitest** (unit) + **Playwright** (web e2e) + supertest (API e2e) |
| Deploy | Vercel (web) · Expo EAS (mobile) · container host + managed Postgres (API) |

---

## Delivery phases (sequencing)

| Phase | Theme | Docs |
|-------|-------|------|
| **0** | Foundations (monorepo, CI, shared packages, auth shell) | `phases/phase-0-foundations.md` |
| **1** | Core scoring + report (forms, both modes, accounts, tiers, views) | `phases/phase-1-core-scoring.md` |
| **2** | Resume & document parsing (Ollama + OCR) | `phases/phase-2-parsing.md` |
| **3** | Verification & bonus (Verified User; OCR+manual → KYC) | `phases/phase-3-verification.md` |
| **4** | Enhancements (skill tests, richer comms, comparison dashboard) | `phases/phase-4-enhancements.md` |

Each later phase depends on the earlier ones. See `phases/README.md` for the dependency graph.

---

## Documentation map (file tree)

```
docs/
├── README.md                         # this file — index + authoring contract
├── SCOPE.md                          # authoritative project scope
├── poc.png                           # source POC sketch
├── AGENTS.md                         # architecture & contributor/AI guide
├── CLOUD.md                          # cloud, infra, environments, deploy, observability
│
├── architecture/
│   ├── 01-overview.md                # system architecture, monorepo, data flow, diagrams
│   ├── 02-data-model.md              # entities, Prisma schema, ERD, migrations strategy
│   ├── 03-scoring-engine.md          # DEEP: blocks, parameters, rubrics, calibration, formulas
│   ├── 04-api-contracts.md           # REST endpoints, DTOs, auth, error model, versioning
│   └── 05-security-privacy.md        # PII, consent, DPDP, sensitive-attr handling, retention
│
├── phases/
│   ├── README.md                     # roadmap, dependency graph, milestones
│   ├── phase-0-foundations.md
│   ├── phase-1-core-scoring.md
│   ├── phase-2-parsing.md
│   ├── phase-3-verification.md
│   └── phase-4-enhancements.md
│
├── frontend/
│   ├── README.md                     # FE architecture, structure, routing, conventions
│   ├── design-system.md              # tokens, theming, shadcn/ui, a11y
│   ├── charts.md                     # DEEP: Chart.js/react-chartjs-2, chart-per-metric, mobile charts
│   ├── state-and-forms.md            # TanStack Query, react-hook-form + Zod, multi-step wizards
│   ├── mobile.md                     # Expo/RN specifics, navigation, parity
│   ├── best-practices.md             # performance, a11y, testing, error UX
│   └── pages/
│       ├── README.md                 # page inventory + routing map + phase mapping
│       ├── onboarding-auth.md        # sign-up/in, role selection, claim-profile flow
│       ├── mode-selection-and-forms.md  # mode select + fresher & professional multi-step forms
│       ├── documents-and-verification.md # uploads, ID capture, verification status
│       ├── candidate-report.md       # candidate report dashboard (charts, improvement guidance)
│       ├── employer-recruiter.md     # employer report view + comparison/ranking dashboard
│       └── account-consent-settings.md   # profile, consent management, data deletion
│
└── backend/
    ├── README.md                     # BE architecture, NestJS module map, conventions
    ├── database-and-prisma.md        # schema mgmt, migrations, seeding, indexing
    ├── api-conventions.md            # REST, versioning, validation, errors, pagination, guards
    ├── testing.md                    # unit/integration/e2e, fixtures, CI
    ├── best-practices.md             # security, logging, config, performance
    └── modules/
        ├── README.md                 # module overview + phase mapping
        ├── auth-accounts.md          # users, roles, sessions, JWT
        ├── profiles.md               # candidate profiles, claimable profiles, re-scoring
        ├── scoring.md                # wraps @stabil/scoring; score runs, history
        ├── parsing.md                # resume/doc parsing orchestration (Ollama + OCR)
        ├── verification.md           # document verification, Verified User, bonus
        ├── documents-storage.md      # uploads, MinIO/S3, virus scan, lifecycle
        ├── reports-pdf.md            # report assembly + PDF export
        ├── consent-sharing.md        # per-share consent, share links, audience views
        ├── employer-search.md        # candidate search/compare/ranking (later phase)
        └── notifications.md          # email/push (claim invites, score ready, consent asks)
```

---

## Authoring contract (every doc MUST follow)

### Header block
Start every doc with:

```md
# <Title>

> **Status:** Draft v0.1 · **Phase:** <0–4 or "cross-cutting"> · **Owner area:** <frontend/backend/infra/data>
> **Related:** [Sibling Doc Title](../path/to/related-doc), [Another](../path/to/another)

<one-paragraph purpose>
```

### Style
- GitHub-flavored Markdown. Use **tables**, fenced **code blocks** (with language), and
  **Mermaid** diagrams (` ```mermaid `) for flows/sequences/ERDs.
- Be **deep and concrete**: real paths, real library names (+ versions where it matters),
  type/interface signatures, example payloads, edge cases, and **acceptance criteria**.
- Cross-link sibling docs by **relative path**. Reference `SCOPE.md` sections (e.g. "SCOPE §6.3").
- Call out **placeholders/calibration** items explicitly (weights, tier bands are TBD).
- Never weaken a `SCOPE.md` decision. Never add a `Co-Authored-By: Claude` trailer anywhere.

### Templates

**Phase doc** → sections: `Goal & outcomes` · `In scope / Out of scope` · `Workstreams
(frontend / backend / data / infra)` · `Detailed task breakdown` (checklist grouped by
sub-module/sub-stage) · `Deliverables` · `Acceptance criteria (DoD)` · `Test strategy` ·
`Dependencies` · `Risks & mitigations` · `Milestones`.

**Backend module doc** → `Responsibility (one purpose)` · `Public API` (endpoints + method
signatures) · `Data model touched` (Prisma models) · `Dependencies` · `Key flows` (Mermaid
sequence) · `Validation & errors` · `Security/permissions` · `Phased implementation`
(per-phase sub-stages) · `Testing` · `Best practices & gotchas`.

**Frontend page doc** → `Purpose & audience(s)` · `Route(s)` · `Phase` · `Layout/wireframe`
(ASCII ok) · `Sub-stages` (multi-step) · `Components` (design-system + chart components) ·
`Data needs` (queries/mutations → API endpoints) · `States` (loading/empty/error/success) ·
`Forms & validation` (Zod) · `Charts` (which charts + which Chart.js components) ·
`Accessibility` · `Acceptance criteria`.

---

## Conventions cheat-sheet

- **IDs:** UUID v7 primary keys.
- **Money/points:** integers (points are whole numbers, `Math.round`).
- **Enums:** `Mode = fresher|professional`, `Block = mode|common|verification`,
  `Visibility = all|employer-only`, `Audience = candidate|employer|recruiter`,
  `Tier = unstable|developing|somewhat-stable|settled|stable`.
- **Engine boundary:** `@stabil/scoring` consumes **normalized fractions `[0,1]` per
  parameter**. Mapping raw answers (GPA, years, etc.) → fractions is the **rubric layer**
  (`packages/core`), NOT the engine. Keep that boundary crisp everywhere.
- **API base:** `/api/v1`. JSON. Errors use RFC 9457 problem+json.
```
