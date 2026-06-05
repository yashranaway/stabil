# Stabil — Stability Check Platform · Scope

> **Status:** Draft v0.3 — derived from the handwritten POC (`poc.png`), a clarifying Q&A, and a confirmed tech stack.
> **Date:** 2026-06-06
> **About this doc:** Shared understanding of the project before design/build. All major product decisions below are **confirmed** via Q&A. Remaining unknowns are **design-time calibration details** (exact weights, tier bands, tech stack) and are listed in §13.

---

## 1. Core Idea

**Stabil** scores how *stable* a person is, based on the information they provide. "Stability" is a composite, **role-agnostic** signal about a person — how settled, reliable, and likely-to-stay they are — expressed as a numeric score (**0–1500**) and a human-readable **category** (e.g. *Somewhat Stable*, *Settled*, *Stable*).

A person's information (resume + structured forms + optional supporting documents) is parsed, scored across weighted parameters, optionally boosted by verified-document bonus points, totalled, and mapped to a category. The result is rendered as an explainable **report**.

**Audiences (3):**
1. **Employers / hiring companies** — screening/decision aid.
2. **Recruiters / staffing agencies** — ranking/shortlisting candidates.
3. **Candidates themselves** — self-assessment and score improvement.

Because candidates see their own report, **explainability** and a **"how to improve your score"** view are first-class requirements. This is a standalone product — **not affiliated with TeacherOp**.

---

## 2. Confirmed Decisions (quick reference)

| # | Topic | Decision |
|---|-------|----------|
| 1 | Modes | **2** — Fresher, Working Professional |
| 2 | Mode selection | **User self-selects** their mode |
| 3 | Score scale | **0–1500**, shared scale across both modes |
| 4 | Score basis | **General / role-agnostic** (one score per person) |
| 5 | Scoring method | **Fixed expert-defined weights** (deterministic, explainable) |
| 6 | Score composition | Mode-specific block **+** common (cross-mode) block **+** verification bonus |
| 7 | Signal sources | **Mix per parameter** (forms / resume-parsing / assessment) |
| 8 | Languages | Fresher = **programming**; Professional = **spoken** |
| 9 | Sensitive attrs (age, marital) | **Kept in scoring, suppressed from candidate-facing report** (employer-only visibility) |
| 10 | Communication | **Self-rating + verifiable certs** now; richer AI analysis later |
| 11 | Skill tests | **Later phase** (design the score to accept a test sub-score) |
| 12 | Tiers | **5-tier ladder** (Unstable → Developing → Somewhat Stable → Settled → Stable), bands calibrated later |
| 13 | Verification | **Phased** — OCR + manual review now; third-party KYC/govt API later |
| 14 | Geo scope | **India + international** from the start |
| 15 | Who submits | **Both** — candidate-driven *and* employer-driven |
| 16 | Employer-submitted candidate | **Creates a claimable profile** |
| 17 | Accounts | **Yes**, with re-scoring over time (improvement loop) |
| 18 | Consent | **Explicit per-share consent** before any employer/recruiter sees a report |
| 19 | Data retention | **Keep while account active; delete on request** |
| 20 | AI processing | **Hosted/cloud LLM OK** (standard secure handling) for parsing/analysis |
| 21 | Platform | **Web app + mobile app** |
| 22 | Report delivery | **In-app dashboard + PDF export** |
| 23 | Employer multi-candidate view | **Phased** — single reports in POC; comparison/ranking dashboard later |
| 24 | Tech stack | **TypeScript monorepo** — Next.js (web) · Expo/React Native (mobile) · NestJS API · PostgreSQL + Prisma · Anthropic Claude for parsing (see §10) |

---

## 3. Modes (Person Types)

Two scoring profiles, **selected by the user** at the start of the flow.

| # | Mode | Description |
|---|------|-------------|
| 1 | **Fresher** | New graduate or ≤ ~1 year of experience. Scored mostly on potential signals. |
| 2 | **Working Professional** | Established professional with meaningful experience. Scored mostly on settledness/track-record signals. |

> **Modes vs. phases:** **Modes** = the two person-types above. **Phases** = the three delivery stages (§9).

---

## 4. Scoring Framework

### 4.1 Score composition
Every person's total is built from three blocks, summing to a **0–1500** score on a **shared scale** (so results are comparable across modes):

```
TOTAL (0–1500) =
    Mode-specific block      (Fresher OR Working Professional parameters)
  + Common block             (cross-mode parameters that apply to everyone)
  + Verification bonus       (points for documents validated as legitimate)
→ mapped to a Stability Tier (§7)
```

- **Fixed expert weights:** each parameter's point contribution is defined up front. Deterministic and explainable — no ML/learned weights in the POC.
- The **common block** is the "Mixed / Generic score" from the POC: a shared sub-score from parameters that apply to everyone, added on top of mode-specific points.
- The exact split of points across blocks/parameters and the final weights are a **calibration task** (§13).

### 4.2 Signal sources (mix per parameter)
Each parameter draws from the most appropriate source:
- **Self-reported forms:** relocation willingness, work-mode preference, flexibility, marital status, self-rated communication, AI familiarity.
- **Resume / document parsing (Phase 2):** total experience, tenure, projects, academics, skills.
- **Assessment:** communication (self-rating + verifiable certs now; richer AI analysis later); skill tests (later phase).

### 4.3 Fresher parameters (mode-specific)
| Parameter | What it captures | Source / notes |
|-----------|------------------|----------------|
| **Academics** | Grades / institution / consistency | Parsed + form |
| **Projects** | What they've built (quality/relevance) | Parsed + form |
| **Course / Certifications** | Structured learning completed | Form / parsed; verifiable for bonus |
| **AI familiarity** | Comfort with AI tools/concepts | Self-reported form |
| **Cloud exposure** | Cloud familiarity (Azure/AWS, etc.) | Self-reported / parsed |
| **Relocation willingness** | Can they relocate? | Self-reported form |
| **Flexibility** | Adaptable to role/conditions? | Self-reported form |
| **Work-mode preference** | Hybrid / On-site / Remote | Self-reported form |
| **Programming languages** | e.g. Java, Python | Parsed / form |

### 4.4 Working Professional parameters (mode-specific)
| Parameter | What it captures | Source / notes |
|-----------|------------------|----------------|
| **Total experience** | Years in the workforce | Parsed (primary settledness signal) |
| **Tenure** | Avg time per job (esp. tech roles) | Parsed (short hops ⇒ less stable) |
| **Spoken languages** | How many languages they speak | Form |
| **Marital status** | Married or not | Form. **Visibility: employer-only** (see §6/§8) |
| **Age** | Candidate age | Form/ID. **Visibility: employer-only** (see §6/§8) |

### 4.5 Common (cross-mode) parameters — the "Generic" block
Apply to everyone regardless of mode; their points are added on top of the mode-specific block.
| Parameter | What it captures | Source / notes |
|-----------|------------------|----------------|
| **Communication** | Communication ability | Self-rating + verifiable certs now; AI analysis later |
| **Location** | Where they're based | Form / parsed (stability/relocation implication) |
| **Verification status** | Whether claims are document-backed | Drives the verification bonus (§5) |

> Exact assignment of borderline parameters to "common" vs "mode-specific," and all weights, are finalized during calibration (§13).

---

## 5. Document Verification & Bonus Points

Beyond the base questionnaire, users can submit **supporting documents** to *prove* claims; validated claims earn **bonus points** and a **Verified User** flag.

- Example: a candidate's **age** can't be confirmed from a resume. If they submit a **government ID** — **Aadhaar/PAN (India)** or an **international equivalent** (passport, national ID) — and we validate it, the claim is confirmed → **bonus points**.
- **Geo scope:** India + international document types supported from the start.
- **Verification mechanism (phased):**
  - **Now (POC):** OCR field extraction + **manual review** to approve documents.
  - **Later:** integrate **third-party KYC / government APIs** (e.g. DigiLocker for India, passport/ID verification services internationally) for automated validation.
- **Graceful without docs:** a user who uploads nothing still gets a base score; documents only *add* points and trust.

---

## 6. Audiences, Submission & Report Views

### 6.1 Who submits (both)
- **Candidate-driven:** candidates create their own profile, get scored, and **choose to share** their report with employers/recruiters.
- **Employer-driven:** employers/recruiters can submit a candidate's resume/info. This **creates a claimable profile** the candidate can later claim, verify, and improve.

### 6.2 Consent
**Explicit per-share consent:** a candidate must explicitly approve before any employer/recruiter can view their report. Sensitive-data use is disclosed up front.

### 6.3 Differentiated report views
- **Employer / recruiter view:** full breakdown, **including** sensitive line-items (age, marital status).
- **Candidate view:** same overall score + category + improvement guidance, but **sensitive line-items are suppressed** and never itemized. Hidden factors still affect the total; they just aren't shown or attributed in the candidate's breakdown.

> **Design implication:** every parameter carries a **visibility level** (candidate-visible vs employer-only) so the report renderer can filter per audience. This is part of the parameter model from day one.

---

## 7. Stability Tiers

The total (0–1500) maps to a named category. **5-tier ladder** (bands are placeholders, calibrated once weights are set):

| Tier | Example range (of 1500) | Meaning |
|------|-------------------------|---------|
| Unstable | 0–500 | Limited evidence of stability |
| Developing | 500–800 | Some positive signals |
| Somewhat Stable | 800–1100 | Reasonably settled |
| Settled | 1100–1350 | Strong stability signals |
| Stable | 1350–1500 | Highest stability |

Anchors from the briefing: ~1000 ≈ *Somewhat Stable*, ~1500 ≈ *Stable*.

---

## 8. Output: The Report

Delivered as an **in-app dashboard (web + mobile) + downloadable PDF**, containing:
- **Overall score** (e.g. 1180 / 1500) and **category** (e.g. *Settled*).
- **Per-parameter breakdown** — which factors contributed how much (explainability), filtered by audience (§6.3).
- **Verification status** — Verified User badge + which documents were validated.
- **Improvement guidance** — concrete ways to raise the score (e.g. "Verify your ID for +X points"), shown to candidates.

---

## 9. Delivery Phases

- **Phase 1 — Core scoring engine + report:** Both modes (user self-selects), **form-based input**, mode-specific + common scoring blocks, fixed weights, 0–1500 scale, 5-tier mapping, accounts with re-scoring, candidate & employer report views (dashboard + PDF), explicit per-share consent.
- **Phase 2 — Resume & document parsing:** Automated extraction (hosted LLM) from resumes/documents to auto-fill and enrich parameters.
- **Phase 3 — Verification & bonus (Verified User):** Document validation (Aadhaar/PAN + international), trust flags, bonus points; OCR + manual review first, KYC/government APIs later.

**Post-POC / later enhancements** (designed-for now, built later): in-platform skill tests (e.g. Python test) feeding a test sub-score; richer AI-based communication assessment (written/spoken); employer/recruiter **multi-candidate comparison & ranking dashboard**.

---

## 10. Platform & Architecture (high level)

**Stack: a TypeScript-first monorepo** — one language across all clients, the API, and a shared scoring-engine package. Chosen so the deterministic scoring logic lives in a single isolated, unit-tested module reused by web, mobile, and the API.

| Layer | Choice | Why |
|-------|--------|-----|
| **Monorepo** | Turborepo + pnpm workspaces | Shared packages (types, scoring engine, API client, Zod schemas) across apps |
| **Web** | Next.js 15 (App Router, React 19, TS) + Tailwind + shadcn/ui | SSR, strong DX, mature ecosystem |
| **Mobile** | Expo / React Native + TS + NativeWind | Shares types & business logic with web; one team, one language |
| **API** | NestJS (TS) | Modular boundaries (scoring · parsing · verification · accounts · reports) match the phased build; serves both clients |
| **Scoring engine** | Standalone TS package (`packages/scoring`) | Pure, deterministic, heavily unit-tested; fixed-weight model lives here |
| **Database** | PostgreSQL + Prisma | Relational fit for profiles, parameters, scores, audit; data-driven parameter model maps to tables |
| **Auth** | Role-based (candidate / employer / recruiter / admin), JWT sessions for mobile | Drives differentiated views (§6.3) and per-share consent (§6.2) |
| **Storage** | S3-compatible (Cloudflare R2 / AWS S3) | Secure document uploads + generated PDFs |
| **AI parsing** | Anthropic **Claude API** (Phase 2) | LLM-driven parsing — no Python ML stack needed, keeps the codebase TS-only. Model chosen at build time for cost/quality |
| **Validation** | Zod (shared schemas) | One source of truth for form/API/parse shapes |
| **PDF** | `@react-pdf/renderer` | Report export (§8) |
| **Testing** | Vitest (unit, esp. scoring) + Playwright (web e2e) | Confidence in the deterministic engine and core flows |
| **Deploy** | Vercel (web) · Expo EAS (mobile) · container host + managed Postgres (API/DB) | Standard, low-ops for a POC |

- **Parameter model:** parameters are data-driven (weight, source, visibility level, mode applicability) so scoring is configurable and explainable.
- **AI processing:** hosted Claude API with standard secure data handling for candidate PII.

---

## 11. Data, Privacy & Retention

- **Accounts:** users register, save a profile, add info/documents over time, and **re-run their score** (the improvement loop).
- **Retention:** keep candidate data and documents **while the account is active**; candidates can **request deletion**.
- **PII:** Aadhaar/PAN/IDs are highly sensitive — secure storage, access control, and compliance (e.g. India DPDP Act and international equivalents) are required.
- **Consent:** explicit per-share consent (§6.2).

---

## 12. Risks & Things to Watch

- **Legal / fairness risk:** Scoring on **age, marital status,** and similar sensitive attributes can be unlawful in hiring in many jurisdictions. **Decision (v0.2):** kept in the model but **suppressed from the candidate-facing report** (employer-only). This reduces the candidate-complaint surface but does **not** remove the underlying legal risk, since employers still act on a score these attributes influenced. **Before production:** regional compliance review (India DPDP + employment law, plus per-market equivalents) and a defensible justification for each sensitive input.
- **Bias & transparency:** a stability score influencing hiring needs a defensible methodology and clear explainability.
- **PII security:** IDs and personal documents require strong protection and clear retention/deletion.
- **Calibration validity:** fixed expert weights are a starting point; they need review and, eventually, validation against outcomes.

---

## 13. Remaining Design-Time Items (not blockers)

These are resolved during design/calibration, not now:
1. **Parameter weights** — exact point values per parameter and per block (mode-specific vs common).
2. **Tier bands** — final numeric thresholds for the 5 tiers.
3. **Per-parameter rubrics** — e.g. how Academics maps to points (GPA/institution bands), how Projects are evaluated, how communication certs convert to points.
4. **Verification specifics** — which KYC/government APIs to integrate in the later automated phase, per region.
5. **Report UX** — exact layout of dashboard + PDF, and the candidate vs employer view differences.

---

## 14. Glossary

- **Mode / Person-type:** Which scoring profile applies (Fresher / Working Professional); user-selected.
- **Mode-specific block:** Points from parameters unique to a mode.
- **Common / Generic block:** Points from cross-mode parameters that apply to everyone.
- **Base score:** Mode-specific + common blocks, before verification bonus.
- **Verification bonus:** Extra points for documents validated as legitimate.
- **Verified User:** Trust flag earned when official documents are validated.
- **Stability tier / category:** Human-readable bucket the total score maps to.
- **Tenure:** Average time spent per job (a key stability signal for professionals).
- **Visibility level:** Whether a parameter's line-item is shown to candidates or only to employers/recruiters.
