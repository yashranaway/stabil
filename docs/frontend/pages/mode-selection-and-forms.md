# Mode Selection & Intake Forms

> **Status:** Draft v0.1 · **Phase:** 1 (core; Phase 2 adds resume pre-fill) · **Owner area:** frontend
> **Related:** [../state-and-forms.md](../state-and-forms.md) · [../../backend/modules/profiles.md](../../backend/modules/profiles.md) · [../../backend/modules/scoring.md](../../backend/modules/scoring.md) · [../../architecture/03-scoring-engine.md](../../architecture/03-scoring-engine.md) · [../../SCOPE.md](../../SCOPE.md)

This page group covers two sequential screens for a candidate's first scoring run: (1) **Mode Selection** — the user self-selects Fresher or Working Professional (SCOPE §3, decision #2); (2) a **multi-step intake wizard** tailored to the chosen mode, capturing every parameter the scoring engine needs (SCOPE §4). After completing the wizard the user hits a **Review** step and submits, which creates a `FormSubmission` and triggers a `ScoreRun`. The result redirects to the candidate report. Form state is auto-saved to resume across browser sessions.

> **Engine boundary:** Zod schemas here validate raw UI answers (e.g. years as a number, GPA as a percentage). Mapping those raw answers → normalized fractions `[0,1]` happens **server-side in the rubric layer** (`packages/core`). The frontend never computes fractions. See [../../architecture/03-scoring-engine.md](../../architecture/03-scoring-engine.md) §1 for the boundary definition.

---

## 1. Routes

| Route | Screen | Auth required |
|-------|--------|--------------|
| `/onboard/mode` | Mode Selection | Yes — candidate role |
| `/onboard/fresher/:step` | Fresher wizard step | Yes — candidate role |
| `/onboard/professional/:step` | Professional wizard step | Yes — candidate role |
| `/onboard/review` | Review & Submit (shared) | Yes — candidate role |

`:step` is a 1-based integer slug (e.g. `/onboard/fresher/1`). Navigating to a step ahead of the furthest-reached step is blocked client-side (redirect to `furthestStep`). Deep-linking into a specific step is supported for resumption — the wizard rehydrates from draft autosave.

**Re-scoring (improvement loop):** authenticated candidates who already have a profile reach these same routes via `/profile/rescore`. The wizard pre-fills from the latest `FormSubmission` (Phase 1) and, in Phase 2, from parsed resume data.

---

## 2. Phase mapping

| Phase | What changes on this page group |
|-------|----------------------------------|
| **Phase 1** | Form-only intake: all parameters are self-reported via the wizard. No document-parsing pre-fill. |
| **Phase 2** | A `REVIEW EXTRACTED DATA` pre-fill step is inserted **before** the mode-specific steps. The user sees auto-extracted fields from their uploaded resume (Ollama + Tesseract output), corrects errors, and confirms — these then seed the wizard fields. |
| **Phase 3** | Verification upsell banners added to relevant steps (e.g. "Upload a government ID after submit for +150 bonus points"). No structural wizard changes. |

---

## 3. Mode Selection screen

### 3.1 Purpose & audience

Presented to a candidate immediately after they complete registration (or when they choose to rescore). The candidate self-selects their person-type; this sets the `mode` on their `CandidateProfile` and determines which wizard is shown next.

### 3.2 Layout / wireframe

```
┌──────────────────────────────────────────────────────────────────┐
│  stabil                                           [Account menu] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│        How would you describe your professional status?          │
│                                                                  │
│   ┌─────────────────────────┐  ┌─────────────────────────┐      │
│   │                         │  │                         │      │
│   │  🎓  Fresher             │  │  💼  Working Professional│      │
│   │                         │  │                         │      │
│   │  New graduate or up to  │  │  Currently employed or  │      │
│   │  ~1 year of experience. │  │  with meaningful work   │      │
│   │  Scored on potential,   │  │  history. Scored on     │      │
│   │  academics & skills.    │  │  tenure, experience &   │      │
│   │                         │  │  settledness signals.   │      │
│   │      [ Select ]         │  │      [ Select ]         │      │
│   │                         │  │                         │      │
│   └─────────────────────────┘  └─────────────────────────┘      │
│                                                                  │
│   ℹ  Your mode affects which questions appear. You can change    │
│      your mind during this session before submitting.            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Both cards are keyboard-navigable and selectable with Enter/Space. Selecting one immediately navigates to step 1 of the corresponding wizard. If the user has previously started a draft (draft autosave hit), an inline banner offers "Resume where you left off" before revealing the two cards.

### 3.3 Data needs

- **Mutation:** `PATCH /api/v1/profiles/me` `{ mode }` — sets mode on the profile; idempotent on re-select.
- **Query:** `GET /api/v1/profiles/me` — checks for an existing draft (`latestFormSubmission.status === "draft"`); triggers the resume banner.

### 3.4 Components

| Component | Source | Notes |
|-----------|--------|-------|
| `ModeCard` | custom | Shadcn `Card` + `Button`. Renders mode label, description, and Select CTA. Accepts `selected: boolean` for ring highlight on re-visit. |
| `ResumeDraftBanner` | custom | `Alert` (shadcn). Shows only when a draft exists. "Resume" links to `/onboard/{mode}/{furthestStep}`. |

### 3.5 States

| State | Behaviour |
|-------|-----------|
| **Loading** | Skeleton of two `ModeCard` side-by-side. Shown while `GET /profiles/me` resolves (< 200 ms typically; use a 300 ms delay threshold before showing skeleton). |
| **Draft exists** | `ResumeDraftBanner` above the mode cards. |
| **Selection → navigate** | Optimistic: navigate immediately; `PATCH` fires in background. If `PATCH` fails, `toast.error` and revert navigation to `/onboard/mode`. |
| **Error fetching profile** | Full-page error boundary with "Retry" button. |

### 3.6 Zod schema

```ts
// packages/contracts/src/mode-selection.ts
import { z } from "zod";

export const ModeSelectionSchema = z.object({
  mode: z.enum(["fresher", "professional"]),
});

export type ModeSelection = z.infer<typeof ModeSelectionSchema>;
```

---

## 4. Multi-step Wizard — overview

### 4.1 Wizard shell

The wizard shell is a shared layout component wrapping both the Fresher and Professional paths. It provides:

- **Progress bar** — linear bar showing `currentStep / totalSteps` percentage, with step labels beneath.
- **Step indicator** — "Step N of M · Step Title" heading.
- **Back / Next navigation** — Back goes to the previous step (does not re-validate); Next validates the current step's Zod schema before advancing.
- **Save & exit** — persists the current draft and returns the candidate to their dashboard.
- **Auto-save** — debounced 1 500 ms after last field change; calls `PATCH /api/v1/form-submissions/:id/draft` with the partial payload. A subtle "Saved" indicator shows for 2 s after each auto-save.

```
┌──────────────────────────────────────────────────────────────────┐
│  stabil            Step 3 of 8 · Programming Languages           │
│  ████████████████░░░░░░░░░░░░░░░░  37%                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [  step content — see per-step wireframes below  ]              │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│  [Save & exit]                    [← Back]   [Next →]            │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 State management

The wizard uses **`react-hook-form`** (`useForm`) per step with **Zod resolvers** (`@hookform/resolvers/zod`), connected to a **TanStack Query** mutation for each `PATCH` (draft save) and the final `POST` (submit). See [../state-and-forms.md](../state-and-forms.md) for the shared multi-step wizard pattern.

Wizard-level state (current step, mode, draft submission ID) lives in a React context (`WizardContext`) wrapping the route segment. Persisted to `sessionStorage` as a serialized JSON object so Back-button + refresh don't lose position.

```ts
interface WizardContextValue {
  mode: "fresher" | "professional";
  submissionId: string | null;     // UUID v7; null until first auto-save creates the draft
  currentStep: number;
  furthestStep: number;
  totalSteps: number;
  answers: Partial<FresherAnswers | ProfessionalAnswers>;
  setStep: (step: number) => void;
  updateAnswers: (patch: Partial<FresherAnswers | ProfessionalAnswers>) => void;
}
```

### 4.3 Draft autosave & resume

1. On first field change in Step 1, `POST /api/v1/form-submissions` creates a `FormSubmission` with `status: "draft"`. The returned `id` is stored in `WizardContext.submissionId`.
2. Subsequent field changes trigger `PATCH /api/v1/form-submissions/:id/draft` (debounced 1 500 ms).
3. On page load, `GET /api/v1/profiles/me` returns `latestFormSubmission` if one exists with `status === "draft"`. The wizard rehydrates `answers` from `latestFormSubmission.answers` and sets `currentStep = furthestStep`.
4. Submitting via the Review step transitions `status: "draft" → "submitted"`.

### 4.4 Phase 2 — "Review extracted data" pre-fill step

When Phase 2 is enabled (feature flag `NEXT_PUBLIC_PHASE_2_PARSING=true`), a pre-fill step is inserted **before** the mode-specific steps (effectively Step 0 of the wizard).

```
[ Review extracted data ] → [ Step 1 ] → [ Step 2 ] → … → [ Review & Submit ]
```

The pre-fill step shows a two-column UI: left column = what the parser extracted from the uploaded resume; right column = editable form fields pre-populated with those values. The candidate confirms or corrects each field. On "Confirm & continue" the corrected values seed the wizard steps as defaults. Fields the parser could not extract are left blank and marked "Not found — please fill in".

---

## 5. Fresher wizard — steps

Total steps (Phase 1): **8** mode-specific + **2** common = **10**, plus the shared Review step.

> Step ordering below is recommended UX order. Common steps (communication, location) are placed last before Review as they apply to all modes.

### Step F1 — Academics

**Purpose:** Capture highest qualification, institution type, and grade.

```
┌──────────────────────────────────────────────────────────────────┐
│  Let's start with your academics                                  │
│                                                                   │
│  Highest qualification *                                          │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  [Dropdown: 10th / 12th / Diploma / Bachelor's / Master's / │  │
│  │            PhD / Other]                                     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  Institution type *                                               │
│  ○ Top-tier / highly ranked   ○ Mid-tier   ○ Unranked / Other    │
│                                                                   │
│  Score / grade *    Scale                                         │
│  ┌──────────┐       ┌────────────────────────────┐               │
│  │  e.g. 78 │  /    │  Percentage / GPA 4.0 / … │               │
│  └──────────┘       └────────────────────────────┘               │
│                                                                   │
│  ℹ Provide your cumulative aggregate for your highest degree.     │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
// packages/contracts/src/forms/fresher.ts
import { z } from "zod";

export const QualificationEnum = z.enum([
  "tenth", "twelfth", "diploma", "bachelors", "masters", "phd", "other",
]);

export const InstitutionTierEnum = z.enum(["top", "mid", "unranked"]);

export const GradeScaleEnum = z.enum(["percentage", "gpa_4", "gpa_10", "cgpa_10", "other"]);

export const AcademicsSchema = z.object({
  highestQualification: QualificationEnum,
  institutionTier: InstitutionTierEnum,
  score: z.number({ invalid_type_error: "Enter a number" })
    .positive("Score must be positive"),
  scoreScale: GradeScaleEnum,
});

export type Academics = z.infer<typeof AcademicsSchema>;
```

Raw `score` + `scoreScale` → fraction mapping is the rubric layer's responsibility (`academicsRubric` in `packages/core`). See [../../architecture/03-scoring-engine.md](../../architecture/03-scoring-engine.md) §5.2.

---

### Step F2 — Projects

**Purpose:** Capture the number of projects and a self-assessed quality/relevance rating for each.

```
┌──────────────────────────────────────────────────────────────────┐
│  Tell us about your projects                                      │
│                                                                   │
│  How many projects have you completed? *                          │
│  ┌───────────────────────────────┐                               │
│  │  [Stepper: 0 ──────────── 10+]│                               │
│  └───────────────────────────────┘                               │
│                                                                   │
│  For each project, how would you rate its quality / relevance?   │
│  (Add up to 4; extra projects beyond 4 still count)              │
│                                                                   │
│  Project 1 quality *   ○ Basic  ○ Intermediate  ○ Strong         │
│  Project 2 quality     ○ Basic  ○ Intermediate  ○ Strong         │
│  [ + Add another project ]                                        │
│                                                                   │
│  ℹ Include personal projects, internship projects, and           │
│    open-source contributions.                                     │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
export const ProjectQualityEnum = z.enum(["basic", "intermediate", "strong"]);

const QualityMap = { basic: 0.33, intermediate: 0.66, strong: 1.0 } as const;

export const SingleProjectSchema = z.object({
  quality: ProjectQualityEnum,
});

export const ProjectsSchema = z.object({
  count: z.number().int().min(0).max(50),
  // Up to 4 rated projects; extras beyond 4 are captured by `count`.
  ratedProjects: z.array(SingleProjectSchema).max(4),
});

export type Projects = z.infer<typeof ProjectsSchema>;
```

The array of `{ quality }` objects plus `count` feeds `projectsRubric` on the server. The UI renders one quality selector per rated entry; an "Add another" button appends a row up to 4 (further projects captured only in `count`).

---

### Step F3 — Courses & Certifications

**Purpose:** Capture structured online courses and professional certifications completed.

```
┌──────────────────────────────────────────────────────────────────┐
│  Courses & certifications                                         │
│                                                                   │
│  How many courses or certifications have you completed? *         │
│  ○ 0   ○ 1–2   ○ 3–5   ○ 6+                                     │
│                                                                   │
│  Are any of them from recognized providers?                       │
│  (e.g. Coursera, edX, AWS, Google, Microsoft, NPTEL)             │
│  ○ Yes — at least one   ○ No                                      │
│                                                                   │
│  Do you hold any professional certifications? (e.g. AWS Certified,│
│  Google Cloud Associate, Azure Fundamentals)                      │
│  ○ Yes   ○ No                                                     │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
export const CourseCertCountEnum = z.enum(["zero", "one_two", "three_five", "six_plus"]);

export const CourseCertsSchema = z.object({
  countBand: CourseCertCountEnum,
  recognizedProvider: z.boolean(),
  hasProfessionalCert: z.boolean(),
});

export type CourseCerts = z.infer<typeof CourseCertsSchema>;
```

---

### Step F4 — AI Familiarity

**Purpose:** Capture comfort level with AI tools and concepts (SCOPE §4.3).

```
┌──────────────────────────────────────────────────────────────────┐
│  AI familiarity                                                   │
│                                                                   │
│  How comfortable are you with AI tools and concepts? *           │
│                                                                   │
│  ○ None — I haven't used AI tools yet                            │
│  ○ Basic — I use consumer AI tools (ChatGPT, Copilot, etc.)      │
│  ○ Intermediate — I've integrated AI APIs or built AI-assisted    │
│    features                                                       │
│  ○ Advanced — I've trained/fine-tuned models or built AI         │
│    pipelines                                                      │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
export const AiFamiliarityEnum = z.enum(["none", "basic", "intermediate", "advanced"]);

export const AiFamiliaritySchema = z.object({
  level: AiFamiliarityEnum,
});

export type AiFamiliarity = z.infer<typeof AiFamiliaritySchema>;
```

---

### Step F5 — Cloud Exposure

**Purpose:** Capture cloud platform familiarity (SCOPE §4.3).

```
┌──────────────────────────────────────────────────────────────────┐
│  Cloud exposure                                                   │
│                                                                   │
│  Have you worked with cloud platforms? *                         │
│  ○ No cloud experience                                           │
│  ○ Familiar — I've used cloud services (storage, hosting, etc.)  │
│  ○ Hands-on — I've deployed apps or configured cloud services    │
│  ○ Advanced — I design cloud architectures or hold a cert        │
│                                                                   │
│  Which platforms? (select all that apply)                        │
│  ☐ AWS   ☐ Azure   ☐ Google Cloud   ☐ Other                     │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
export const CloudLevelEnum = z.enum(["none", "familiar", "hands_on", "advanced"]);

export const CloudSchema = z.object({
  level: CloudLevelEnum,
  platforms: z.array(z.enum(["aws", "azure", "gcp", "other"])).max(4),
});

export type Cloud = z.infer<typeof CloudSchema>;
```

---

### Step F6 — Programming Languages

**Purpose:** Capture the number and proficiency of programming languages known. Freshers are scored on **programming** languages (SCOPE §2 #8; distinct from professionals who are scored on spoken languages).

```
┌──────────────────────────────────────────────────────────────────┐
│  Programming languages                                            │
│                                                                   │
│  Which programming languages do you know? *                      │
│  Add languages you can write production-quality code in:         │
│                                                                   │
│  [ Python        ▾ ]  Proficiency: ○ Basic  ○ Intermediate  ○ Fluent │
│  [ + Add language ]                                               │
│                                                                   │
│  ℹ Add languages you genuinely use, not ones you've briefly     │
│    tried. Fluent = you could pass a coding interview in it.      │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
export const LanguageProficiencyEnum = z.enum(["basic", "intermediate", "fluent"]);

// Canonical language list lives in packages/contracts/src/languages.ts
export const ProgrammingLanguageEnum = z.enum([
  "python", "javascript", "typescript", "java", "kotlin", "swift",
  "go", "rust", "cpp", "c", "csharp", "ruby", "php", "scala", "r", "other",
]);

export const ProgrammingLanguageEntrySchema = z.object({
  language: ProgrammingLanguageEnum,
  proficiency: LanguageProficiencyEnum,
});

export const ProgrammingLanguagesSchema = z.object({
  languages: z.array(ProgrammingLanguageEntrySchema)
    .min(1, "Add at least one programming language")
    .max(10),
});

export type ProgrammingLanguages = z.infer<typeof ProgrammingLanguagesSchema>;
```

---

### Step F7 — Preferences (Relocation, Flexibility, Work Mode)

**Purpose:** Capture the three preference parameters in a single grouped step to minimize wizard fatigue. All three are self-reported (SCOPE §4.2, §4.3).

```
┌──────────────────────────────────────────────────────────────────┐
│  Work preferences                                                 │
│                                                                   │
│  Are you open to relocating for a job? *                         │
│  ○ Yes, anywhere   ○ Within my region only   ○ Not open to      │
│    relocating                                                     │
│                                                                   │
│  How flexible are you about role type / conditions? *            │
│  ○ Very flexible — open to varied roles & conditions             │
│  ○ Somewhat flexible — prefer certain conditions but can adapt   │
│  ○ Not flexible — specific requirements                           │
│                                                                   │
│  Work mode preference *                                           │
│  ○ On-site   ○ Hybrid   ○ Remote                                 │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
export const RelocationEnum = z.enum(["anywhere", "regional", "no"]);

export const FlexibilityEnum = z.enum(["high", "medium", "low"]);

export const WorkModeEnum = z.enum(["onsite", "hybrid", "remote"]);

export const PreferencesSchema = z.object({
  relocation: RelocationEnum,
  flexibility: FlexibilityEnum,
  workMode: WorkModeEnum,
});

export type Preferences = z.infer<typeof PreferencesSchema>;
```

These map to three engine parameters: `relocation` (max 60 pts), `flexibility` (max 50 pts), `workMode` (max 40 pts). Mapping ordinal → fraction is the rubric layer's job.

---

### Step F8 — Communication (common)

**Purpose:** Capture self-rated communication ability and any verifiable communication certifications. This is a common parameter — the identical step appears in the Professional wizard as well. See §6.3 (Professional Step P4) for the shared schema.

---

### Step F9 — Location (common)

**Purpose:** Capture where the candidate is currently based (city, country). Feeds the `location` common parameter. See §6.4 (Professional Step P5) for the shared schema.

---

## 6. Professional wizard — steps

Total steps (Phase 1): **5** mode-specific + **2** common = **7**, plus the shared Review step.

### Step P1 — Total Experience

**Purpose:** Capture total years in the workforce. The primary settledness signal for professionals (SCOPE §4.4).

```
┌──────────────────────────────────────────────────────────────────┐
│  Your work experience                                             │
│                                                                   │
│  Total years of work experience *                                 │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Number input, min 0, step 0.5]  years                  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ℹ Count all full-time, part-time, and contract experience.      │
│    Round to nearest 0.5 year.                                     │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
// packages/contracts/src/forms/professional.ts
import { z } from "zod";

export const TotalExperienceSchema = z.object({
  totalYears: z.number({ invalid_type_error: "Enter a number" })
    .min(0, "Cannot be negative")
    .max(50, "Capped at 50 years")
    .multipleOf(0.5, "Round to nearest 0.5 year"),
});

export type TotalExperience = z.infer<typeof TotalExperienceSchema>;
```

---

### Step P2 — Tenure (Job History)

**Purpose:** Capture average tenure per job — the short-hops stability signal (SCOPE §4.4). The candidate enters each relevant role with its duration; the rubric layer computes average tenure and applies the hop-penalty.

```
┌──────────────────────────────────────────────────────────────────┐
│  Job history                                                      │
│                                                                   │
│  List your roles (most recent first). Include roles held for     │
│  1 month or more.                                                 │
│                                                                   │
│  Role 1                          Duration: [ 24 ] months         │
│  Role 2                          Duration: [ 18 ] months         │
│  [ + Add role ]                                                   │
│                                                                   │
│  ℹ If you've had many roles, add at least your last 5.           │
│    Tech roles carry more weight; include them all.               │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
export const JobEntrySchema = z.object({
  durationMonths: z.number().int().min(1).max(480),
});

export const TenureSchema = z.object({
  jobs: z.array(JobEntrySchema)
    .min(1, "Add at least one role")
    .max(30),
});

export type Tenure = z.infer<typeof TenureSchema>;
```

---

### Step P3 — Personal Details (Spoken Languages, Age, Marital Status)

**Purpose:** Capture three professional parameters in one step. `age` and `maritalStatus` are **employer-only** (SCOPE §6.3, decision #9) — a clear privacy notice is shown inline before these fields.

> **Why grouped?** These three fields are short and factual. Grouping them reduces wizard length. The privacy notice ensures the candidate gives informed consent before answering the sensitive fields.

```
┌──────────────────────────────────────────────────────────────────┐
│  Personal details                                                 │
│                                                                   │
│  Spoken languages *                                               │
│  How many languages do you speak conversationally?               │
│  ○ 1   ○ 2   ○ 3   ○ 4+                                         │
│                                                                   │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│  🔒 Employer-only fields                                          │
│  The next two fields are used to compute your stability score.   │
│  They will ONLY be shared with employers/recruiters who you      │
│  explicitly consent to share your report with. They will NOT     │
│  appear in your own report view.                                 │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│                                                                   │
│  Your age *                                                       │
│  ┌──────────────────────────┐                                    │
│  │  [Number input]  years   │                                    │
│  └──────────────────────────┘                                    │
│                                                                   │
│  Marital status *                                                 │
│  ○ Single   ○ Married   ○ Prefer not to say                      │
│                                                                   │
│  ℹ "Prefer not to say" for age or marital status will result     │
│    in a 0 score for that factor. You may still submit.           │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema:**

```ts
export const SpokenLanguageCountEnum = z.enum(["one", "two", "three", "four_plus"]);

export const MaritalStatusEnum = z.enum(["single", "married", "prefer_not_to_say"]);

export const PersonalDetailsSchema = z.object({
  spokenLanguageCount: SpokenLanguageCountEnum,
  // Employer-only fields — visibility enforced server-side; collected client-side with informed consent
  age: z.number().int().min(16).max(100).nullable(),
  maritalStatus: MaritalStatusEnum,
});

export type PersonalDetails = z.infer<typeof PersonalDetailsSchema>;
```

`age: null` and `maritalStatus: "prefer_not_to_say"` both produce fraction `0` in the rubric layer, resulting in `0` points awarded for those parameters. The scoring engine never throws on missing or zero values (see [../../architecture/03-scoring-engine.md](../../architecture/03-scoring-engine.md) §2.3 — "missing keys score 0").

**Accessibility note:** the privacy disclosure box (`role="note"`) is rendered before the sensitive fields and is announced by screen readers. A screen-reader-only label on each sensitive field echoes "employer-only" context.

---

### Step P4 — Communication (common)

**Purpose:** Self-rated communication ability + verifiable certs. Shared with Fresher wizard.

```
┌──────────────────────────────────────────────────────────────────┐
│  Communication                                                    │
│                                                                   │
│  How would you rate your communication skills? *                  │
│                                                                   │
│  ○ Basic — I can convey ideas with effort                        │
│  ○ Functional — I communicate adequately in professional settings │
│  ○ Proficient — I communicate confidently and clearly            │
│  ○ Excellent — I am a skilled communicator; lead presentations,   │
│    write well                                                     │
│                                                                   │
│  Do you hold any communication / language certifications?         │
│  (e.g. IELTS, TOEFL, Cambridge B2+, Toastmasters)               │
│  ○ Yes   ○ No                                                     │
│                                                                   │
│  Number of verified communication certs:                          │
│  ┌──────────────────────────┐                                    │
│  │  [Number input, 0–10]    │  (shown only if "Yes" above)      │
│  └──────────────────────────┘                                    │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema (shared — used by both wizard paths):**

```ts
// packages/contracts/src/forms/common.ts
import { z } from "zod";

export const CommunicationRatingEnum = z.enum([
  "basic", "functional", "proficient", "excellent",
]);

const ratingToFraction = { basic: 0.25, functional: 0.5, proficient: 0.75, excellent: 1.0 } as const;

export const CommunicationSchema = z.object({
  selfRating: CommunicationRatingEnum,
  hasVerifiedCerts: z.boolean(),
  certCount: z.number().int().min(0).max(10).nullable(),
}).refine(
  (d) => !d.hasVerifiedCerts || (d.certCount !== null && d.certCount > 0),
  { message: "Enter the number of certifications", path: ["certCount"] },
);

export type Communication = z.infer<typeof CommunicationSchema>;
```

The `selfRating` ordinal + `certCount` feed `communicationRubric` in `packages/core`. The cert bonus is capped server-side (SCOPE §2 #10). See [../../architecture/03-scoring-engine.md](../../architecture/03-scoring-engine.md) §5.2.

---

### Step P5 — Location (common)

**Purpose:** Where the candidate is currently based. Feeds the `location` common parameter. Shared with Fresher wizard.

```
┌──────────────────────────────────────────────────────────────────┐
│  Your location                                                    │
│                                                                   │
│  Country *                                                        │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Searchable dropdown — ISO 3166-1 country list]         │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  City / Region *                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  [Free-text, max 100 chars]                               │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ℹ Location affects the stability model as a stability-signal    │
│    proxy (SCOPE §4.5). India and international both supported.   │
└──────────────────────────────────────────────────────────────────┘
```

**Zod schema (shared):**

```ts
export const LocationSchema = z.object({
  countryCode: z.string().length(2, "Select a country"),   // ISO 3166-1 alpha-2
  cityOrRegion: z.string().min(1, "Enter your city or region").max(100),
});

export type Location = z.infer<typeof LocationSchema>;
```

---

## 7. Combined answer payloads

The server receives a single flat `answers` object per `FormSubmission`. The wizard assembles this by merging all per-step answers. Both mode paths extend a common base:

### 7.1 Full Fresher payload

```ts
// packages/contracts/src/forms/fresher.ts
import { z } from "zod";
import { CommunicationSchema, LocationSchema } from "./common";

export const FresherAnswersSchema = z.object({
  // Mode-specific
  academics:            AcademicsSchema,
  projects:             ProjectsSchema,
  courseCerts:          CourseCertsSchema,
  aiFamiliarity:        AiFamiliaritySchema,
  cloud:                CloudSchema,
  programmingLanguages: ProgrammingLanguagesSchema,
  preferences:          PreferencesSchema,         // relocation + flexibility + workMode
  // Common
  communication:        CommunicationSchema,
  location:             LocationSchema,
});

export type FresherAnswers = z.infer<typeof FresherAnswersSchema>;
```

### 7.2 Full Professional payload

```ts
// packages/contracts/src/forms/professional.ts
import { z } from "zod";
import { CommunicationSchema, LocationSchema } from "./common";

export const ProfessionalAnswersSchema = z.object({
  // Mode-specific
  totalExperience:  TotalExperienceSchema,
  tenure:           TenureSchema,
  personalDetails:  PersonalDetailsSchema,  // spokenLanguages + age + maritalStatus
  // Common
  communication:    CommunicationSchema,
  location:         LocationSchema,
});

export type ProfessionalAnswers = z.infer<typeof ProfessionalAnswersSchema>;
```

### 7.3 Discriminated union for API submission

```ts
// packages/contracts/src/forms/index.ts
import { z } from "zod";

export const FormSubmissionBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fresher"),       answers: FresherAnswersSchema }),
  z.object({ mode: z.literal("professional"),  answers: ProfessionalAnswersSchema }),
]);

export type FormSubmissionBody = z.infer<typeof FormSubmissionBodySchema>;
```

---

## 8. Review step (shared)

**Purpose:** Show the candidate a read-only summary of every answer before final submission. A "Back" link from each section returns to the relevant wizard step.

```
┌──────────────────────────────────────────────────────────────────┐
│  Review your information                                          │
│  Step 11 of 11 (Fresher) / Step 9 of 9 (Professional)           │
│                                                                   │
│  Mode: Fresher                                               [Edit]│
│                                                                   │
│  ┌── Academics ─────────────────────────────────────────── [Edit]┐│
│  │  Bachelor's · Mid-tier institution · 72%                      ││
│  └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ┌── Projects ────────────────────────────────────────── [Edit] ─┐│
│  │  3 projects · 2 strong, 1 intermediate                        ││
│  └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│  … (one card per step) …                                          │
│                                                                   │
│  ┌── Location ───────────────────────────────────────── [Edit] ──┐│
│  │  India · Bengaluru                                             ││
│  └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│  By submitting you agree to our Terms and Privacy Policy.        │
│  Your score will be calculated immediately.                       │
│                                                                   │
│  [← Back]                             [Submit & get my score →]  │
└──────────────────────────────────────────────────────────────────┘
```

**Submit action:**

1. Client calls `POST /api/v1/form-submissions` (with full payload + `mode`) or `PATCH /api/v1/form-submissions/:id` if a draft already exists, with `status: "submitted"`.
2. After 2xx response, client immediately calls `POST /api/v1/scoring/runs` `{ submissionId, idempotencyKey: <uuid-v7> }`.
3. The `ScoreRun` is created synchronously (engine is fast and deterministic); the API returns `{ runId, total, tier }`.
4. Client redirects to `/report/:runId` (the candidate report page).

**Idempotency:** `POST /api/v1/scoring/runs` requires an `Idempotency-Key` header (UUID v7, generated client-side). Re-submitting with the same key returns the original `ScoreRun` without creating a duplicate.

---

## 9. Component inventory

| Component | Type | Location | Notes |
|-----------|------|----------|-------|
| `ModeSelectionPage` | page | `app/onboard/mode/page.tsx` | Renders two `ModeCard`s + `ResumeDraftBanner`. |
| `ModeCard` | presentational | `components/onboard/ModeCard.tsx` | shadcn `Card` + `Button`; accepts `mode`, `selected`, `onSelect`. |
| `ResumeDraftBanner` | presentational | `components/onboard/ResumeDraftBanner.tsx` | shadcn `Alert`; "Resume" link to `furthestStep`. |
| `WizardShell` | layout | `components/onboard/WizardShell.tsx` | Progress bar, step heading, nav buttons, auto-save indicator. |
| `WizardProgressBar` | presentational | `components/onboard/WizardProgressBar.tsx` | Accessible `<progress>` element + step labels. |
| `WizardContext` | context | `contexts/WizardContext.tsx` | Holds `mode`, `submissionId`, `currentStep`, `answers`; persisted to `sessionStorage`. |
| `useWizardAutosave` | hook | `hooks/useWizardAutosave.ts` | Debounced `PATCH` mutation; exposes `isSaving` / `lastSavedAt`. |
| `AcademicsStep` | step form | `components/onboard/steps/fresher/AcademicsStep.tsx` | react-hook-form; Zod schema `AcademicsSchema`. |
| `ProjectsStep` | step form | `components/onboard/steps/fresher/ProjectsStep.tsx` | Dynamic list; `useFieldArray` from RHF. |
| `CourseCertsStep` | step form | `components/onboard/steps/fresher/CourseCertsStep.tsx` | |
| `AiFamiliarityStep` | step form | `components/onboard/steps/fresher/AiFamiliarityStep.tsx` | |
| `CloudStep` | step form | `components/onboard/steps/fresher/CloudStep.tsx` | Checkbox group for platforms. |
| `ProgrammingLanguagesStep` | step form | `components/onboard/steps/fresher/ProgrammingLanguagesStep.tsx` | `useFieldArray`; language dropdown + proficiency radio. |
| `PreferencesStep` | step form | `components/onboard/steps/fresher/PreferencesStep.tsx` | Three radio groups (relocation, flexibility, workMode). |
| `TotalExperienceStep` | step form | `components/onboard/steps/professional/TotalExperienceStep.tsx` | |
| `TenureStep` | step form | `components/onboard/steps/professional/TenureStep.tsx` | `useFieldArray`; duration-in-months per role. |
| `PersonalDetailsStep` | step form | `components/onboard/steps/professional/PersonalDetailsStep.tsx` | Employer-only privacy notice; conditional `certCount` field. |
| `CommunicationStep` | step form | `components/onboard/steps/common/CommunicationStep.tsx` | Shared by both modes; conditional `certCount`. |
| `LocationStep` | step form | `components/onboard/steps/common/LocationStep.tsx` | Searchable country dropdown (ISO 3166-1); free-text city. |
| `ReviewStep` | step form | `components/onboard/ReviewStep.tsx` | Read-only summary cards; edit links; submit button. |
| `EmployerOnlyNotice` | presentational | `components/onboard/EmployerOnlyNotice.tsx` | Reusable privacy disclosure for sensitive fields; accepts field names. |
| `PhasePreFillStep` | step form | `components/onboard/steps/PhasePreFillStep.tsx` | **Phase 2 only** (feature-flagged). Two-column confirm/correct UI. |

---

## 10. Data needs (queries & mutations)

All queries/mutations use **TanStack Query** with typed API client functions from `packages/contracts`. See [../state-and-forms.md](../state-and-forms.md) for the shared patterns.

| Hook / Mutation | Method + Path | Purpose |
|-----------------|---------------|---------|
| `useMyProfile` | `GET /api/v1/profiles/me` | Check for existing draft; pre-fill mode. |
| `useSetMode` | `PATCH /api/v1/profiles/me` | Store `mode` selection on the profile. |
| `useCreateSubmission` | `POST /api/v1/form-submissions` | Create a new `FormSubmission` (mode + initial answers). Returns `{ id }`. |
| `useSaveDraft` | `PATCH /api/v1/form-submissions/:id/draft` | Partial auto-save during wizard. |
| `useSubmitForm` | `PATCH /api/v1/form-submissions/:id` `{ status: "submitted" }` | Finalise the submission. |
| `useCreateScoreRun` | `POST /api/v1/scoring/runs` | Trigger scoring. Requires `Idempotency-Key`. Returns `{ runId, total, tier }`. |
| `useResumeParsed` | `GET /api/v1/profiles/me/parsed-resume` | **Phase 2 only**. Fetch pre-extracted field values from Ollama parser. |

All mutations use `onError` to surface `toast.error` with the problem+json `detail` string and `onSuccess` to advance the wizard step.

---

## 11. States

### Loading states

| Screen | Skeleton |
|--------|----------|
| Mode Selection | Two side-by-side `ModeCard` skeletons (same dimensions as real cards). |
| Each wizard step | Input-field placeholders in the card area; progress bar and nav shown immediately (not skeletonized). |
| Review step | One skeleton card per section while answers are rehydrated from context. |

### Error states

| Scenario | Behaviour |
|----------|-----------|
| Profile load fails | Full-page error boundary: "We couldn't load your profile — [Retry]". |
| Auto-save fails | Non-blocking `toast.warning` "Couldn't save — we'll retry". Retry after 5 s, then 15 s, then 60 s (exponential). |
| Submit fails | Inline error banner above the submit button with problem detail; submit button re-enabled. |
| Score run creation fails | Inline error banner; "Try again" button re-fires `POST /api/v1/scoring/runs` with the same idempotency key. |
| Network offline | `navigator.onLine` listener disables "Next" and "Submit" buttons with tooltip "You appear to be offline". |

### Validation states

- Per-step validation fires **on Next click**, not on every keystroke (to avoid premature red states).
- Field-level errors from Zod are displayed inline below each field using shadcn `FormMessage`.
- Steps with validation errors have their progress-bar segment highlighted in destructive red and an accessible `aria-invalid` on the step heading.
- The Review step performs a final **full-schema parse** of the assembled answers before enabling Submit. If it fails (e.g. answers were corrupted in context), an error banner lists the affected steps.

---

## 12. Accessibility

- **Keyboard navigation:** every radio group uses `role="radiogroup"` with arrow-key navigation. `ModeCard` is a `<button>` (not a `<div>`).
- **Focus management:** when the wizard advances to the next step, focus moves to the step heading (`h1` or `h2` with `tabIndex={-1}` and `focus()` in a `useEffect`).
- **ARIA live regions:** auto-save indicator uses `aria-live="polite"`. Error messages use `role="alert"` with `aria-live="assertive"`.
- **Form labels:** every input has an explicit `<label>` via shadcn `FormLabel`; never `placeholder`-only labelling.
- **Privacy notice (`EmployerOnlyNotice`):** rendered as `role="note"` with `aria-label="Employer-only field notice"`. Sensitive fields below it have `aria-describedby` pointing to the notice ID.
- **Progress:** `WizardProgressBar` uses `<progress value={current} max={total}>` with visible and screen-reader-accessible text "Step N of M".
- **Color contrast:** all text on form cards meets WCAG AA (4.5:1). The employer-only notice uses an amber/warning color; verified to pass against the card background.
- **Responsive:** the wizard shell is single-column on mobile. The Mode Selection two-card layout stacks vertically on narrow viewports.

---

## 13. Acceptance criteria

> All criteria below apply to Phase 1 unless annotated **[Phase 2]**.

### Mode Selection

- [ ] A candidate arriving post-registration sees the Mode Selection screen before any wizard steps.
- [ ] Selecting a mode navigates to step 1 of the correct wizard; the mode is persisted on `CandidateProfile.mode` via `PATCH /api/v1/profiles/me`.
- [ ] If a draft exists for the candidate, a `ResumeDraftBanner` is shown before the mode cards; tapping "Resume" navigates to the furthest completed step.
- [ ] Both `ModeCard`s are fully keyboard and screen-reader accessible.

### Wizard — completeness & validation

- [ ] Every parameter defined in `packages/scoring/src/config.ts` is collected by at least one wizard step: `academics`, `projects`, `courseCerts`, `aiFamiliarity`, `cloud`, `programmingLanguages`, `relocation`, `flexibility`, `workMode` (Fresher); `totalExperience`, `tenure`, `spokenLanguages`, `age`, `maritalStatus` (Professional); `communication`, `location` (Common).
- [ ] Clicking "Next" on any step does not advance if the step's Zod schema validation fails; at least one field-level error is displayed.
- [ ] Clicking "Back" navigates to the previous step without re-validating.
- [ ] A candidate cannot navigate to a step beyond their furthest-completed step by direct URL.

### Sensitive fields — privacy

- [ ] The `PersonalDetailsStep` renders `EmployerOnlyNotice` before the `age` and `maritalStatus` fields.
- [ ] The privacy notice text explicitly states these fields will not appear in the candidate's own report.
- [ ] "Prefer not to say" for `maritalStatus` and a null/omitted `age` are accepted by the form and API; the API submits `age: null` without error.

### Draft autosave & resume

- [ ] After the first field change on Step 1, `POST /api/v1/form-submissions` is called; the returned `id` is stored.
- [ ] Subsequent field changes trigger `PATCH /api/v1/form-submissions/:id/draft` within 1 500 ms of the last change.
- [ ] Refreshing the browser mid-wizard rehydrates the candidate to their furthest step with all previously entered answers intact.
- [ ] The auto-save indicator ("Saved") appears for 2 s after each successful save.
- [ ] On auto-save failure, a non-blocking warning toast appears; the UI does not block the candidate from continuing.

### Review & Submit

- [ ] The Review step displays a read-only summary card for each wizard step.
- [ ] Each summary card has an "Edit" link that returns the candidate to the corresponding step.
- [ ] Clicking "Submit & get my score" fires `PATCH /api/v1/form-submissions/:id` `{ status: "submitted" }` followed immediately by `POST /api/v1/scoring/runs`.
- [ ] Submitting creates a `FormSubmission` (with `status: "submitted"`) and a `ScoreRun` in the database.
- [ ] On successful score run creation, the candidate is redirected to `/report/:runId`.
- [ ] Re-tapping Submit with the same idempotency key does not create a duplicate `ScoreRun`.

### Phase 2 pre-fill **[Phase 2]**

- [ ] When `NEXT_PUBLIC_PHASE_2_PARSING=true` and a parsed resume is available, a "Review extracted data" step appears before Step 1.
- [ ] The pre-fill step shows two columns: extracted values (read-only) and editable form fields pre-populated with those values.
- [ ] Fields the parser could not extract are blank and marked "Not found — please fill in".
- [ ] Confirmed values from the pre-fill step seed the downstream wizard steps as defaults (editable).

### Accessibility

- [ ] Wizard navigates entirely by keyboard; tab order is logical within each step.
- [ ] Focus moves to the step heading on step change.
- [ ] All required fields have explicit `<label>` elements.
- [ ] WCAG AA color contrast satisfied throughout (verified with axe-core in Playwright e2e).

---

## 14. Cross-cutting notes

- **Parameter keys must match `config.ts` exactly.** The frontend answer keys (`academics`, `projects`, `programmingLanguages`, `aiFamiliarity`, `cloud`, `courseCerts`, `relocation`, `flexibility`, `workMode`, `totalExperience`, `tenure`, `spokenLanguages`, `age`, `maritalStatus`, `communication`, `location`) must remain in sync with the `key` fields in `packages/scoring/src/config.ts`. A unit test in `packages/contracts` should assert this at CI time.
- **No fraction math in the frontend.** The UI collects raw answers only. Fraction computation and all rubric logic live in `packages/core` (server-side). The only numbers the frontend sees from the engine are `total` (integer 0–1500) and `tier` (string enum), returned in the `ScoreRun` response.
- **Sensitive attributes and `filterForAudience`.** `age` and `maritalStatus` have `visibility: "employer-only"` in `config.ts`. `filterForAudience("candidate")` in the engine strips them from the candidate-facing breakdown. The candidate report page must never read or display these fields from the breakdown, even if accidentally included. See [../../architecture/03-scoring-engine.md](../../architecture/03-scoring-engine.md) §6 for the filtering guarantee.
- **Calibration placeholder notice.** All `max` values shown in this document (e.g. `relocation` max 60 pts, `workMode` max 40 pts) are **PLACEHOLDER** pending the calibration workshop (SCOPE §13). The wizard UI must not display raw point values to the candidate; points are an internal engine detail. Show tier names and improvement framing instead.
