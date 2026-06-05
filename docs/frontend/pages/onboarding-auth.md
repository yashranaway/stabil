# Onboarding & Auth Pages

> **Status:** Draft v0.1 · **Phase:** Phase 1 (auth/sign-up/sign-in/role-selection/email-verification/password-reset); claim-profile ties to Phase 1 employer-submit flow · **Owner area:** frontend
> **Related:**
> - [../../backend/modules/auth-accounts.md](../../backend/modules/auth-accounts.md) — users, roles, JWT sessions, password hashing
> - [../../backend/modules/profiles.md](../../backend/modules/profiles.md) — claimable profiles, claim token lifecycle
> - [../../architecture/04-api-contracts.md](../../architecture/04-api-contracts.md) — `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /profiles/employer-submit`, `POST /profiles/:id/claim`
> - [../state-and-forms.md](../state-and-forms.md) — react-hook-form + Zod, multi-step patterns
> - [../design-system.md](../design-system.md) — shadcn/ui tokens, component library
> - [./mode-selection-and-forms.md](./mode-selection-and-forms.md) — next destination after sign-up/claim
> - [../../phases/phase-1-core-scoring.md](../../phases/phase-1-core-scoring.md) — Phase 1 task breakdown A1

All authentication and identity-establishment flows for every audience. This is the entry point to Stabil for a first-time user, a returning user, and a candidate responding to a claimable-profile invite. It covers **six distinct flows**: sign-up (with role selection), sign-in, email verification, password reset, and the claim-profile flow in which a candidate claims an employer-submitted claimable profile via a single-use invite link (SCOPE §6.1 / §16).

---

## 1. Purpose & Audiences

| Flow | Primary audience | Entry point |
|------|-----------------|-------------|
| Sign-up | Candidate, Employer, Recruiter | `/register` |
| Role selection (inline at sign-up) | All three self-serve roles | Step within `/register` |
| Sign-in | Any authenticated user | `/login` |
| Email verification | Candidate, Employer, Recruiter (post-register) | `/verify-email?token=…` |
| Password reset | Any account holder | `/forgot-password`, `/reset-password?token=…` |
| Claim profile | Candidate invited via employer-submit | `/claim/[token]` |

All flows are **public** (no access token required). Every flow except claim-profile must complete before a user can access any protected route.

---

## 2. Routes

All routes live under the Next.js App Router **`(auth)`** route group, rendering inside a shared centered-card layout (`app/(auth)/layout.tsx`). The group has no sidebar or navigation shell — authentication pages are intentionally minimal.

```
app/
└── (auth)/
    ├── layout.tsx                    # centered card, Stabil wordmark, no nav
    ├── register/
    │   └── page.tsx                  # sign-up + role selection (multi-sub-stage)
    ├── login/
    │   └── page.tsx                  # sign-in
    ├── verify-email/
    │   └── page.tsx                  # email verification (token from query string)
    ├── forgot-password/
    │   └── page.tsx                  # request reset link
    ├── reset-password/
    │   └── page.tsx                  # consume token, set new password
    └── claim/
        └── [token]/
            └── page.tsx              # claim a claimable profile (invite link)
```

**Middleware** (`middleware.ts`) redirects authenticated users away from `(auth)` routes to `/dashboard` (candidates) or `/employer/dashboard` (employers/recruiters). The claim route is special: if the user is already authenticated as a candidate with a matching email, the middleware lets them proceed to allow auto-claim (no re-registration required).

---

## 3. Phase

**Phase 1** — all flows ship in Phase 1. The claim-profile flow is the candidate-facing end of the employer-submit feature (SCOPE §2 decisions 15–16; SCOPE §6.1; Phase 1 task A1.5, B2.4–B2.7).

---

## 4. Shared Layout Wireframe

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│                  S T A B I L                        │  ← wordmark, href="/"
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │                                               │  │
│  │  <Page title>                                 │  │
│  │  <Page subtitle>                              │  │
│  │                                               │  │
│  │  ┌─────────────────────────────────────────┐ │  │
│  │  │  <Form content>                         │ │  │
│  │  └─────────────────────────────────────────┘ │  │
│  │                                               │  │
│  │  <Footer link>  (e.g. "Already have an       │  │
│  │  account?  Sign in")                          │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The card is `max-w-md w-full mx-auto mt-16 rounded-xl border shadow-sm p-8` (Tailwind). The layout component is a server component; form pages are client components (`"use client"`).

---

## 5. Flow 1 — Sign-Up (`/register`)

### 5.1 Purpose

New users create a Stabil account. Role is selected during registration and is permanently attached to the account (SCOPE §2 decision; role drives all differentiated views). `admin` is provisioned out-of-band; it is never a selectable option here.

### 5.2 Sub-stages

The page is a **single-page two-sub-stage form** (not a separate route per step; the second sub-stage appears when role is selected):

| Sub-stage | Fields shown | Condition |
|-----------|-------------|-----------|
| 1 — Identity | Email, Password, Display name, Role selector | Always visible |
| 2a — Candidate extra | *(none)* — candidates may proceed immediately | `role === "candidate"` |
| 2b — Organisation | Organisation name (required) | `role ∈ { "employer", "recruiter" }` |

The role selector's conditional field (`organizationName`) mounts/unmounts via `watch("role")` in react-hook-form. Sub-stage 2b fades in with a CSS transition when the role changes.

### 5.3 ASCII Wireframe

```
┌───────────────────────────────────────────┐
│  Create your account                      │
│  Already have an account?  Sign in →      │
│                                           │
│  Display name                             │
│  ┌─────────────────────────────────────┐  │
│  │ Asha Rao                            │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Email address                            │
│  ┌─────────────────────────────────────┐  │
│  │ asha@example.com                    │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Password                                 │
│  ┌─────────────────────────────────────┐  │
│  │ ••••••••••••                        │  │
│  └─────────────────────────────────────┘  │
│  At least 10 characters                   │
│                                           │
│  I am a …                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Candidate│ │ Employer │ │Recruiter │  │
│  │    ✓     │ │          │ │          │  │
│  └──────────┘ └──────────┘ └──────────┘  │
│                                           │
│  [shown only when employer/recruiter]     │
│  Organisation name                        │
│  ┌─────────────────────────────────────┐  │
│  │                                     │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │         Create account              │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

### 5.4 Components

| Component | Source | Notes |
|-----------|--------|-------|
| `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` | `shadcn/ui` | Wraps `react-hook-form` context |
| `Input` | `shadcn/ui` | `type="email"`, `type="password"`, `type="text"` |
| `ToggleGroup`, `ToggleGroupItem` | `shadcn/ui` | Role selector — three mutually exclusive options; each item renders a card-style tile with an icon and label |
| `Button` | `shadcn/ui` | `type="submit"`, `loading` state via `disabled + spinner` |
| `Alert` | `shadcn/ui` | Server-side errors (e.g. email already taken) rendered below the form |

### 5.5 Zod Schema

Defined in `packages/contracts/src/auth.ts` and shared with the NestJS DTO.

```ts
// packages/contracts/src/auth.ts
import { z } from "zod";
import { Role } from "./common"; // z.enum(["candidate","employer","recruiter","admin"])

export const RegisterSchema = z
  .object({
    displayName: z.string().min(1, "Name is required").max(120, "Name must be 120 characters or fewer"),
    email: z.string().email("Enter a valid email address"),
    password: z
      .string()
      .min(10, "Password must be at least 10 characters")
      .max(128, "Password must be 128 characters or fewer"),
    role: z.enum(["candidate", "employer", "recruiter"], {
      required_error: "Select a role to continue",
    }),
    organizationName: z.string().min(1).max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "employer" || data.role === "recruiter") {
      if (!data.organizationName || data.organizationName.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["organizationName"],
          message: "Organisation name is required for employers and recruiters",
        });
      }
    }
  });

export type RegisterRequest = z.infer<typeof RegisterSchema>;
```

### 5.6 API Call

```ts
// POST /api/v1/auth/register  (see architecture/04-api-contracts.md §3)
const res = await apiClient.post<AuthResponse>("/auth/register", payload);
// On 201: store accessToken (web = HttpOnly cookie set by API response),
//         redirect to /verify-email?sent=1
// On 409: "An account with this email already exists."
// On 422: field errors surfaced via react-hook-form setError()
```

After successful registration the user is redirected to `/verify-email?sent=1` to await the verification email before accessing any protected route.

### 5.7 States

| State | UI behaviour |
|-------|-------------|
| Idle | Form enabled |
| Loading | Submit button shows spinner, all fields `disabled`, `aria-busy="true"` on form |
| Error — 409 conflict | `Alert` variant `destructive` above form: "An account with this email address already exists. Sign in instead." with a link to `/login` |
| Error — 422 validation | Per-field `FormMessage` via react-hook-form `setError` mapping `errors[]` from the API response `FieldError[]` |
| Error — network/500 | `Alert` destructive: "Something went wrong. Please try again." |
| Success | Redirect to `/verify-email?sent=1` |

### 5.8 Acceptance Criteria

- [ ] Submitting with an empty email shows "Enter a valid email address" below the email field.
- [ ] Submitting with a password of fewer than 10 characters shows "Password must be at least 10 characters".
- [ ] Selecting `employer` or `recruiter` reveals the Organisation name field; selecting `candidate` hides it.
- [ ] Submitting as `employer` without an organisation name shows the organisation name error inline.
- [ ] A successful submission creates a `User` in the database with the correct `role` and redirects the browser to `/verify-email?sent=1`.
- [ ] The `admin` role is never selectable from this form.
- [ ] Attempting to register with an already-registered email returns HTTP 409 and the page displays the conflict message without clearing the form.
- [ ] The submit button is disabled and shows a spinner while the API request is in flight.
- [ ] The form is keyboard-navigable: Tab moves through fields in document order; Enter on any field does not submit until all validations pass; role tiles are togglable with Space/Enter.

---

## 6. Flow 2 — Sign-In (`/login`)

### 6.1 Purpose

Existing users authenticate and receive a session. The API never reveals whether an email exists (SCOPE §10 "no user enumeration"; see [architecture/04-api-contracts.md §3](../../architecture/04-api-contracts.md)).

### 6.2 ASCII Wireframe

```
┌───────────────────────────────────────────┐
│  Welcome back                             │
│  Don't have an account?  Sign up →        │
│                                           │
│  Email address                            │
│  ┌─────────────────────────────────────┐  │
│  │ asha@example.com                    │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Password                                 │
│  ┌─────────────────────────────────────┐  │
│  │ ••••••••••••                        │  │
│  └─────────────────────────────────────┘  │
│  Forgot password?                         │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │            Sign in                  │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

### 6.3 Components

`Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`, `Input` (email + password), `Button` (submit), `Alert` (error), `Link` (forgot-password and sign-up).

### 6.4 Zod Schema

```ts
// packages/contracts/src/auth.ts
export const LoginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
export type LoginRequest = z.infer<typeof LoginSchema>;
```

### 6.5 API Call

```ts
// POST /api/v1/auth/login  (see architecture/04-api-contracts.md §3)
// On 200: store token (HttpOnly cookie on web), redirect to role-appropriate dashboard
// On 401: generic message — no distinction between wrong email and wrong password
// On 422: field-level errors (empty fields)
```

Post-login redirect logic:
- `candidate` → `/dashboard` (or the `?redirect=` query param if present)
- `employer` / `recruiter` → `/employer/dashboard`
- `admin` → `/admin`

If the user's email is unverified (`emailVerifiedAt === null` on the access-token claims), redirect to `/verify-email?sent=0` with a banner to re-send the verification email.

### 6.6 States

| State | UI behaviour |
|-------|-------------|
| Idle | Form enabled |
| Loading | Button spinner, fields disabled |
| Error — 401 | `Alert` destructive: "Incorrect email or password." (generic; never says which is wrong) |
| Error — unverified | Redirect to `/verify-email?sent=0` |
| Error — deleted account | `Alert` destructive: "This account has been deactivated. Contact support if this is a mistake." |
| Error — 429 | `Alert` with remaining wait time from `Retry-After` header: "Too many attempts. Please wait N seconds." |
| Success | Redirect (see above) |

### 6.7 Acceptance Criteria

- [ ] A correct email + correct password logs the user in and redirects them to the role-appropriate dashboard.
- [ ] An incorrect password produces a generic 401 message without revealing whether the email exists.
- [ ] A correct email for an unverified account redirects to `/verify-email?sent=0`.
- [ ] After 10 failed attempts (rate bucket: `auth`, 10/min/IP — see [architecture/04-api-contracts.md §1.7](../../architecture/04-api-contracts.md)) the form shows the retry-after duration.
- [ ] `?redirect=/some/path` is honoured after successful login (sanitized: only same-origin paths accepted).
- [ ] Pressing Enter in the password field submits the form.

---

## 7. Flow 3 — Role Selection (Inline at Sign-Up)

Role selection is not a separate page; it is the role `ToggleGroup` within the sign-up form (§5 above). It is documented separately here for clarity because the role is immutable after registration and drives all downstream differentiated views (SCOPE §6.3).

### 7.1 Role Descriptions Shown in UI

| Role tile | Icon | Short description |
|-----------|------|------------------|
| Candidate | `UserCircle` | "I want to score and share my stability profile" |
| Employer | `Building2` | "I want to screen and score candidates" |
| Recruiter | `Users` | "I source candidates for multiple clients" |

Icons from `lucide-react`. Tiles have a `ring-2 ring-primary` focus/selected state.

### 7.2 Conditional Rendering Rule

```ts
// react-hook-form watch
const role = watch("role");
const showOrgField = role === "employer" || role === "recruiter";
```

The `organizationName` field uses `AnimatePresence` (or a CSS `transition-all`) to slide down when `showOrgField` becomes true, preserving layout stability (no content jump).

### 7.3 Acceptance Criteria

- [ ] Role is required — submitting without selecting a role shows "Select a role to continue" and focuses the role group.
- [ ] Role selection is communicated to screen readers (`aria-pressed` on each tile; the group has `role="group"` with `aria-label="I am a"`).
- [ ] `admin` is never rendered as a tile option.
- [ ] The selected role is included verbatim in the `POST /auth/register` payload as `"candidate"`, `"employer"`, or `"recruiter"`.

---

## 8. Flow 4 — Email Verification (`/verify-email`)

### 8.1 Purpose

After registration, a verification email is sent to the user's address. The page handles two entry modes:

- **`?sent=1`** — landed here immediately after registration; shows "Check your inbox" state.
- **`?token=<jwt>`** — user clicked the verification link in email; the token is consumed client-side via an API call.

### 8.2 ASCII Wireframe — "Check your inbox" state (`?sent=1`)

```
┌───────────────────────────────────────────┐
│                                           │
│         📬  Check your inbox             │
│                                           │
│  We sent a verification link to           │
│  asha@example.com                         │
│                                           │
│  Click the link in the email to           │
│  activate your account.                   │
│                                           │
│  Didn't receive it?                       │
│  ┌─────────────────────────────────────┐  │
│  │       Re-send verification email    │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Already verified?  Sign in →             │
│                                           │
└───────────────────────────────────────────┘
```

### 8.3 ASCII Wireframe — Token-consuming state (`?token=…`)

```
┌───────────────────────────────────────────┐
│                                           │
│  [loading]  Verifying your email…         │  ← skeleton / spinner
│                                           │
│  [success]  ✓ Email verified!             │  ← green check
│  Your account is active.                  │
│  ┌─────────────────────────────────────┐  │
│  │         Go to dashboard             │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  [already-verified]                       │
│  Your email is already verified.          │
│  Sign in →                               │
│                                           │
│  [error / expired]                        │
│  This link has expired or is invalid.     │
│  ┌─────────────────────────────────────┐  │
│  │       Re-send verification email    │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

### 8.4 Components

`Alert` (states), `Button` (re-send + dashboard CTA), `Skeleton` (loading state). No form; all interaction is via buttons.

### 8.5 API Calls

```ts
// Verify token (token present in query string — runs on mount via useEffect)
// POST /api/v1/auth/verify-email  { token }
// → 200: email verified; update auth context; redirect to /dashboard after 2 s delay
// → 410 share-expired / 404: "This link has expired."
// → 409: "Email is already verified."

// Re-send verification email (button click)
// POST /api/v1/auth/verify-email/resend  {}  (requires Bearer token or email in body)
// → 200: "Verification email re-sent."
// → 429: rate limited
```

Note: the verify-email endpoint is `@Public()` on the API but the re-send endpoint requires a valid Bearer token (or, if called from the post-login unverified state, the user holds a token already).

### 8.6 States

| State | Trigger | UI |
|-------|---------|---|
| `awaiting` | `?sent=1` with no `?token` | "Check your inbox" UI with re-send button |
| `verifying` | `?token` present, request in flight | Spinner with "Verifying your email…" |
| `verified` | Token consumed successfully | Green check + "Email verified!" + dashboard button |
| `already-verified` | API returns 409 | Subdued notice + sign-in link |
| `expired` | API returns 404/410 | Error alert + re-send button |
| `resent` | Re-send succeeded | Toast/`Alert` success: "Verification email re-sent. Check your inbox." |
| `resend-rate-limited` | Re-send returns 429 | Button disabled + "Please wait N seconds before re-sending." |

### 8.7 Acceptance Criteria

- [ ] Landing on `/verify-email?sent=1` immediately after registration shows the "check inbox" state with the email address visible.
- [ ] Opening the link from the email (`/verify-email?token=…`) automatically fires the verify API call on mount, transitions to `verifying`, then `verified` on success.
- [ ] A valid, un-consumed token marks `User.emailVerifiedAt` in the database and returns 200.
- [ ] An expired or invalid token shows the `expired` state with a re-send button.
- [ ] A token that has already been consumed shows the `already-verified` state.
- [ ] The re-send button is rate-limited and disabled while a re-send request is in flight.
- [ ] After verification, the "Go to dashboard" button navigates to the correct role-specific dashboard.
- [ ] Protected routes redirect unverified users back to `/verify-email?sent=0` until verification is complete.

---

## 9. Flow 5 — Password Reset (`/forgot-password` + `/reset-password`)

### 9.1 Purpose

Two-step password reset: (1) user submits their email to request a reset link; (2) user opens the link, sets a new password. The API never confirms whether an email is registered (no user enumeration).

### 9.2 Sub-stage A — Request Reset (`/forgot-password`)

#### Wireframe

```
┌───────────────────────────────────────────┐
│  Forgot your password?                    │
│                                           │
│  Enter your email and we'll send a        │
│  reset link if an account exists.         │
│                                           │
│  Email address                            │
│  ┌─────────────────────────────────────┐  │
│  │                                     │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │       Send reset link               │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Back to sign in                          │
└───────────────────────────────────────────┘
```

After submit (regardless of whether the email exists):

```
┌───────────────────────────────────────────┐
│  Check your inbox                         │
│                                           │
│  If asha@example.com has an account,      │
│  you'll receive a password reset link.    │
│                                           │
│  Back to sign in                          │
└───────────────────────────────────────────┘
```

#### Zod Schema

```ts
// packages/contracts/src/auth.ts
export const ForgotPasswordSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordSchema>;
```

#### API Call

```ts
// POST /api/v1/auth/forgot-password  { email }
// Always returns 200 (no enumeration); transition to "check inbox" state on any 2xx
// On 429: show rate-limit notice
```

#### States

| State | UI |
|-------|---|
| Idle | Form enabled |
| Loading | Spinner, form disabled |
| Sent (200) | "Check your inbox" replacement content (replaces the entire form) |
| Rate limited | Button disabled, retry-after countdown |

### 9.3 Sub-stage B — Set New Password (`/reset-password?token=…`)

#### Wireframe

```
┌───────────────────────────────────────────┐
│  Set a new password                       │
│                                           │
│  New password                             │
│  ┌─────────────────────────────────────┐  │
│  │ ••••••••••••                        │  │
│  └─────────────────────────────────────┘  │
│  At least 10 characters                   │
│                                           │
│  Confirm new password                     │
│  ┌─────────────────────────────────────┐  │
│  │ ••••••••••••                        │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │       Reset password                │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Back to sign in                          │
└───────────────────────────────────────────┘
```

#### Zod Schema

```ts
// packages/contracts/src/auth.ts
export const ResetPasswordSchema = z
  .object({
    token: z.string().min(1),                          // from query string, not rendered
    newPassword: z
      .string()
      .min(10, "Password must be at least 10 characters")
      .max(128),
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export type ResetPasswordRequest = z.infer<typeof ResetPasswordSchema>;
```

The `token` field is read from the query string and injected into the form's hidden state; it is not rendered as an input.

#### API Call

```ts
// POST /api/v1/auth/reset-password  { token, newPassword }
// On 200: redirect to /login with a success toast "Password updated. Sign in with your new password."
// On 404/410: token expired/invalid → show "This link has expired." + link to /forgot-password
// On 422: validation errors (e.g. password too short) surfaced via setError
```

#### States

| State | UI |
|-------|---|
| Loading (token validation on mount) | Skeleton placeholder while the token is pre-validated via a lightweight API ping |
| Idle (token valid) | Password form enabled |
| Token expired/invalid | `Alert` destructive + "Request a new link" CTA linking to `/forgot-password` |
| Submitting | Button spinner, form disabled |
| Success | Redirect to `/login?reset=1`; login page shows a success banner |
| Error — 422 | Inline field errors |

### 9.4 Acceptance Criteria

- [ ] Submitting `/forgot-password` always shows the "check inbox" state regardless of whether the email is registered (no enumeration).
- [ ] The reset link is single-use and expires after 1 hour; consuming it a second time returns 404/410.
- [ ] `/reset-password?token=…` with an invalid or expired token shows the "link expired" state immediately on mount (pre-validation call fires before the form is rendered).
- [ ] A new password of fewer than 10 characters produces a validation error without firing an API call.
- [ ] `confirmPassword` mismatch is caught client-side by the Zod superRefine before the API call.
- [ ] After a successful reset, all existing refresh tokens for that user are revoked server-side (token family revocation — see [architecture/04-api-contracts.md §1.3](../../architecture/04-api-contracts.md)).
- [ ] The "Back to sign in" link is present at all sub-stages.

---

## 10. Flow 6 — Claim Profile (`/claim/[token]`)

### 10.1 Purpose

An employer or recruiter submits a candidate's information via `POST /api/v1/profiles/employer-submit` (see [architecture/04-api-contracts.md §4](../../architecture/04-api-contracts.md)). This creates a **claimable profile** (`status: "claimable"`, `ownerUserId: null`) and sends an invite email to `candidateEmail`. The email contains a link to `/claim/<claimToken>`. This page is the candidate's entry point to claim that profile, becoming its owner, and optionally registering a new Stabil account in the same flow (SCOPE §2 decision 16; SCOPE §6.1).

The claim token is a **single-use, 256-bit random hex string** (`crypto.randomBytes(32).toString('hex')`), not a JWT. It expires 7 days after creation. (See [backend/modules/profiles.md](../../backend/modules/profiles.md) for the token lifecycle.)

### 10.2 Sub-stages

The page has **three sequential sub-stages** governed by the candidate's current authentication state and token validity:

| Sub-stage | Condition | Action |
|-----------|-----------|--------|
| 1 — Token validation | Page mount | `GET /api/v1/profiles/claim/:token` — verify token, surface profile preview |
| 2 — Identity | Token valid | If not authenticated: show register-or-sign-in choice. If already authenticated as a candidate with matching email: auto-claim (skip to sub-stage 3). If authenticated as wrong role or mismatched email: show error. |
| 3 — Claim confirmation | Identity established | `POST /api/v1/profiles/:id/claim` — link profile to account; show success + navigate to dashboard |

### 10.3 ASCII Wireframe — Sub-stage 1: Token Validating

```
┌───────────────────────────────────────────┐
│                                           │
│  ⏳  Checking your invitation…            │
│  [skeleton placeholder]                   │
│                                           │
└───────────────────────────────────────────┘
```

### 10.4 ASCII Wireframe — Sub-stage 1 (Success): Profile Preview

```
┌───────────────────────────────────────────┐
│  You've been invited to claim             │
│  your stability profile                   │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │  👤  Ravi Kumar                     │  │
│  │  Working Professional               │  │  ← mode if set by employer
│  │  Submitted by: Acme Staffing        │  │  ← submittedByOrgName
│  │  Expires in: 6 days                 │  │  ← days until claimToken expires
│  └─────────────────────────────────────┘  │
│                                           │
│  Claiming this profile makes you its      │
│  owner. You can then review, update,      │
│  and share your stability score.          │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │   Create an account and claim       │  │  ← primary CTA (not logged in)
│  └─────────────────────────────────────┘  │
│                                           │
│  Already have a Stabil account?           │
│  Sign in and claim →                      │
│                                           │
└───────────────────────────────────────────┘
```

### 10.5 ASCII Wireframe — Sub-stage 2a: Register to Claim (New User)

Shown when the candidate clicks "Create an account and claim". The register form is the same as `/register` but:
- `role` is pre-set to `"candidate"` and hidden (not editable — an invite is always for a candidate).
- `email` is pre-filled from the `claimEmail` on the profile and shown as read-only with a note: "This email must match the invitation."
- The button label reads "Create account and claim profile".

```
┌───────────────────────────────────────────┐
│  Create your account to claim             │
│  this profile                             │
│                                           │
│  Display name                             │
│  ┌─────────────────────────────────────┐  │
│  │                                     │  │
│  └─────────────────────────────────────┘  │
│                                           │
│  Email address                            │
│  ┌─────────────────────────────────────┐  │
│  │ ravi@example.com  🔒                │  │  ← read-only, pre-filled
│  └─────────────────────────────────────┘  │
│  This email matches your invitation.      │
│                                           │
│  Password                                 │
│  ┌─────────────────────────────────────┐  │
│  │ ••••••••••••                        │  │
│  └─────────────────────────────────────┘  │
│  At least 10 characters                   │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │   Create account and claim profile  │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

### 10.6 ASCII Wireframe — Sub-stage 2b: Sign In to Claim (Existing User)

Shown when the candidate clicks "Sign in and claim →".

```
┌───────────────────────────────────────────┐
│  Sign in to claim this profile            │
│                                           │
│  Email address                            │
│  ┌─────────────────────────────────────┐  │
│  │ ravi@example.com  🔒                │  │  ← pre-filled, not editable
│  └─────────────────────────────────────┘  │
│                                           │
│  Password                                 │
│  ┌─────────────────────────────────────┐  │
│  └─────────────────────────────────────┘  │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │       Sign in and claim             │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

### 10.7 ASCII Wireframe — Sub-stage 3: Claim Confirmation

```
┌───────────────────────────────────────────┐
│                                           │
│  ✓  Profile claimed!                      │
│                                           │
│  This profile is now linked to your       │
│  Stabil account. Any data the employer    │
│  submitted has been preserved and is      │
│  ready for you to review and update.      │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │       Go to my profile              │  │
│  └─────────────────────────────────────┘  │
│                                           │
└───────────────────────────────────────────┘
```

### 10.8 Components

| Component | Source | Notes |
|-----------|--------|-------|
| `Card`, `CardHeader`, `CardContent` | `shadcn/ui` | Profile preview card in sub-stage 1 |
| `Badge` | `shadcn/ui` | Mode label (Fresher / Working Professional) |
| `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage` | `shadcn/ui` | Register or sign-in sub-form |
| `Input` | `shadcn/ui` | `readOnly` for pre-filled email; `disabled` visually to distinguish it |
| `Button` | `shadcn/ui` | CTAs at each sub-stage |
| `Alert` | `shadcn/ui` | Error states (expired token, wrong email, already claimed) |
| `Skeleton` | `shadcn/ui` | Token validation loading state |

### 10.9 Zod Schema

The register-to-claim sub-form reuses `RegisterSchema` but with the role and email locked:

```ts
// packages/contracts/src/auth.ts
export const ClaimRegisterSchema = z.object({
  displayName: z.string().min(1, "Name is required").max(120),
  // email is read-only and injected from the profile preview; not a form field
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128),
  claimToken: z.string().min(1), // hidden, injected from URL param
});
export type ClaimRegisterRequest = z.infer<typeof ClaimRegisterSchema>;

// Login-to-claim variant
export const ClaimLoginSchema = z.object({
  email: z.string().email(),   // read-only, pre-filled — included for API call
  password: z.string().min(1, "Enter your password"),
  claimToken: z.string().min(1),
});
export type ClaimLoginRequest = z.infer<typeof ClaimLoginSchema>;
```

### 10.10 API Calls

```ts
// Sub-stage 1: Validate token and get profile preview (on mount)
// GET /api/v1/profiles/claim/:token  (see architecture/04-api-contracts.md §4)
// → 200: { claimEmail, profileSummary: { fullName, mode, submittedByOrgName, tokenExpiresAt } }
// → 404: unknown token
// → 410: token expired (older than 7 days)
// → 409: profile already claimed

// Sub-stage 2a: Register and immediately claim
// Step 1 — POST /api/v1/auth/register  { email: claimEmail, password, displayName, role: "candidate" }
// Step 2 — POST /api/v1/profiles/:profileId/claim  { claimToken }  (see architecture/04-api-contracts.md §4)
// → 200: Profile (status → "claimed", ownerUserId → new user)

// Sub-stage 2b: Log in and claim
// Step 1 — POST /api/v1/auth/login  { email: claimEmail, password }
// Step 2 — POST /api/v1/profiles/:profileId/claim  { claimToken }
// → 200: Profile claimed

// Auto-claim (already logged in as matching candidate)
// POST /api/v1/profiles/:profileId/claim  { claimToken }  directly on sub-stage 1 confirmation click
```

The two-step register+claim sequence must be atomic from the user's perspective. If registration succeeds but the subsequent claim call fails, the UI must surface the error and allow retrying the claim step without re-registering (the user is already logged in at this point).

### 10.11 States

| State | Trigger | UI |
|-------|---------|---|
| `validating` | Mount, token present | Skeleton + "Checking your invitation…" |
| `preview` | GET claim token → 200 | Profile preview card + CTA buttons |
| `expired` | GET claim token → 410 | `Alert`: "This invitation link has expired. Ask the employer or recruiter to re-send it." |
| `not-found` | GET claim token → 404 | `Alert`: "This link is invalid or has already been used." |
| `already-claimed` | GET claim token → 409 | `Alert`: "This profile has already been claimed." + sign-in link |
| `registering` | New-user register form in flight | Spinner, form disabled |
| `logging-in` | Sign-in form in flight | Spinner, form disabled |
| `claiming` | POST claim in flight | Full-page spinner: "Linking profile to your account…" |
| `success` | Claim 200 | "Profile claimed!" with dashboard CTA |
| `claim-email-mismatch` | API returns 403 on claim | `Alert` destructive: "The email on your account does not match this invitation." |
| `wrong-role` | Authenticated user's role ≠ candidate | `Alert`: "This invitation is for a candidate account. Sign in with your candidate account." |
| `auto-claiming` | Already logged in as matching candidate | Skips sub-stage 2; shows "Linking profile…" spinner, then success |

### 10.12 Employer-Submitted Data Preservation

When an employer submits a candidate profile (via `POST /api/v1/profiles/employer-submit`), they may include `initialAnswers` (partial `SubmissionAnswers`). After the claim succeeds:

- The profile's `status` changes from `"claimable"` to `"claimed"` and `ownerUserId` is set.
- All `initialAnswers` are preserved in the `FormSubmission` associated with the profile.
- The candidate's dashboard shows the inherited answers pre-filled in the form wizard.
- If a `ScoreRun` was computed from the employer-submitted data, it is visible in the candidate's score history.
- The candidate may update answers and re-score at any time (SCOPE §2 decision 17 — re-scoring over time).

This means the claim flow **never discards** employer-submitted data; it only changes ownership.

### 10.13 Acceptance Criteria

- [ ] Navigating to `/claim/<validToken>` shows the profile preview with the candidate's full name, mode (if set by the employer), and the submitting organisation name.
- [ ] Clicking "Create an account and claim" shows the register sub-form with `email` pre-filled from `claimEmail` and marked read-only.
- [ ] Clicking "Sign in and claim →" shows the login sub-form with `email` pre-filled and read-only.
- [ ] After registering + claiming, the candidate's database record has `role = "candidate"`, `emailVerifiedAt` is null (verification email is sent), and the `CandidateProfile` has `status = "claimed"`, `ownerUserId` matching the new user, and `claimToken = null`.
- [ ] Claiming a profile preserves all employer-submitted `FormSubmission` data; the candidate's dashboard wizard pre-populates with those answers.
- [ ] Any `ScoreRun` computed from the employer-submitted data appears in the candidate's score history after claiming.
- [ ] A `claimToken` older than 7 days returns a 410 response; the page shows the "expired" state with instructions to contact the employer.
- [ ] A token used a second time returns 409; the page shows "already claimed".
- [ ] An authenticated candidate whose email does not match `claimEmail` sees the "email mismatch" error and cannot claim.
- [ ] An authenticated employer or recruiter who follows a claim link sees the "wrong role" error.
- [ ] An authenticated candidate whose email matches `claimEmail` sees the profile preview and a single "Claim this profile" button; clicking it fires the claim API call without requiring a registration or login form.
- [ ] If the register step succeeds but the claim step fails (e.g. token was concurrently consumed), the page shows an error without logging the user out; the user can retry the claim or contact support.

---

## 11. Data Needs

### Queries / Mutations (TanStack Query)

All mutations use `useMutation` from TanStack Query (`@tanstack/react-query`). The API client is a typed wrapper over `fetch` (or `axios`) generated from the OpenAPI spec at `GET /api/v1/openapi.json`.

| Hook | API call | Used in |
|------|----------|---------|
| `useRegister()` | `POST /api/v1/auth/register` | `/register`, `/claim/[token]` (register-to-claim) |
| `useLogin()` | `POST /api/v1/auth/login` | `/login`, `/claim/[token]` (login-to-claim) |
| `useLogout()` | `POST /api/v1/auth/logout` | Auth provider (global) |
| `useRefreshToken()` | `POST /api/v1/auth/refresh` | Auth provider (silent refresh) |
| `useVerifyEmail(token)` | `POST /api/v1/auth/verify-email` | `/verify-email` (fires on mount when `?token=…`) |
| `useResendVerification()` | `POST /api/v1/auth/verify-email/resend` | `/verify-email` |
| `useForgotPassword()` | `POST /api/v1/auth/forgot-password` | `/forgot-password` |
| `useResetPassword()` | `POST /api/v1/auth/reset-password` | `/reset-password` |
| `useClaimPreview(token)` | `GET /api/v1/profiles/claim/:token` | `/claim/[token]` (mount query) |
| `useClaimProfile()` | `POST /api/v1/profiles/:id/claim` | `/claim/[token]` |

`useClaimPreview` is a **query** (not a mutation) and fires automatically on mount via `useQuery`. All others are mutations (user-initiated).

### Auth Provider

`app/providers/auth-provider.tsx` — a client component that:
- Exposes `useAuth()` returning `{ user, role, isLoading, isAuthenticated }`.
- Reads the current user from `GET /api/v1/auth/me` on mount (invalidated by login/logout mutations).
- Silently refreshes the access token via `POST /api/v1/auth/refresh` before expiry (15 min window).

---

## 12. Accessibility

All auth pages follow WCAG 2.1 AA. Specific requirements for this page group:

| Requirement | Implementation |
|-------------|----------------|
| Focus management | On sub-stage transition (e.g. claim sub-stage 2 renders), focus moves to the new section heading using `ref.current.focus()` |
| Error announcements | Form errors are associated with inputs via `aria-describedby`; the `Alert` component has `role="alert"` so screen readers announce it immediately |
| Loading states | Buttons in loading state have `aria-busy="true"` and `aria-label` updated (e.g. "Signing in, please wait") |
| Password visibility toggle | Not shown by default; if added later, the toggle button must have `aria-label="Show password"` / `"Hide password"` |
| Role selector | `ToggleGroup` renders each tile as a `button` with `aria-pressed`; the group has `role="group"` and `aria-labelledby` pointing to the "I am a …" legend |
| Token-consuming pages | The verify-email and claim pages fire side effects on mount; they announce their state via `aria-live="polite"` regions so assistive technologies communicate progress without focus being stolen |
| Color-only cues | Error states use both red color and a text message (never color alone); success states use both green and a checkmark icon with `aria-label` |
| Skip link | The `(auth)/layout.tsx` contains a skip-to-content link as the first focusable element |

---

## 13. Charts

No charts on auth pages. N/A.

---

## 14. Cross-cutting Concerns

### Token Storage (web)

- **Access token:** returned in the JSON response body; stored in memory (React context / TanStack Query cache). Never written to `localStorage`.
- **Refresh token (web):** set as an `HttpOnly; Secure; SameSite=Strict` cookie by the API response. The client never reads it directly; it is sent automatically with requests to `/auth/refresh`.
- **Refresh token (mobile):** returned in the response body; stored in `expo-secure-store` (AES-256 at rest). See [../mobile.md](../mobile.md).

### Error Boundary

Each auth page is wrapped in an `ErrorBoundary` (from `react-error-boundary`). Unhandled JS errors fall back to a generic "Something went wrong" card with a "Try again" button, not a blank screen.

### Redirect Loop Prevention

Middleware checks for the `?redirect=` query param and validates that it is a same-origin relative path before trusting it. A hard-coded blocklist prevents redirect to `/` (which could cause a loop) or external URLs.

### Rate Limiting Feedback

All rate-limited responses (`429`) carry a `Retry-After` header (seconds). Forms parse this header and show a countdown: "Too many attempts. Try again in N seconds." The submit button remains disabled until the countdown reaches zero.

---

## 15. Full State Matrix

| Page | Loading | Empty/Idle | Error | Success |
|------|---------|-----------|-------|---------|
| `/register` | Button spinner, fields disabled | Form with placeholder hints | Per-field inline errors (422); `Alert` for 409/500 | Redirect to `/verify-email?sent=1` |
| `/login` | Button spinner, fields disabled | Form | `Alert` generic 401; redirect to verify-email if unverified; 429 countdown | Redirect to dashboard |
| `/verify-email?sent=1` | — | "Check inbox" with re-send button | Re-send 429 | — (user clicks email link) |
| `/verify-email?token=…` | "Verifying…" skeleton | — | Alert: expired (410), invalid (404), already-verified (409) | Green check, dashboard button |
| `/forgot-password` | Button spinner | Email form | 429 countdown | "Check inbox" replacement |
| `/reset-password?token=…` | Token pre-validation skeleton | Password form | Expired/invalid alert; 422 inline | Redirect to `/login?reset=1` |
| `/claim/[token]` | `validating` skeleton | `preview` card + CTAs | `expired`, `not-found`, `already-claimed`, `claim-email-mismatch`, `wrong-role` | `success` card, dashboard CTA |

---

## 16. Sibling Page Links

| Page | Path |
|------|------|
| Mode selection + scoring forms | [./mode-selection-and-forms.md](./mode-selection-and-forms.md) |
| Candidate report dashboard | [./candidate-report.md](./candidate-report.md) |
| Employer/recruiter views | [./employer-recruiter.md](./employer-recruiter.md) |
| Account, consent, settings | [./account-consent-settings.md](./account-consent-settings.md) |
| Document upload + verification | [./documents-and-verification.md](./documents-and-verification.md) |
