# Account, Consent & Settings

> **Status:** Draft v0.1 · **Phase:** 1 · **Owner area:** frontend
> **Related:**
> [backend/modules/consent-sharing.md](../../backend/modules/consent-sharing.md) ·
> [backend/modules/auth-accounts.md](../../backend/modules/auth-accounts.md) ·
> [architecture/05-security-privacy.md](../../architecture/05-security-privacy.md) ·
> [architecture/04-api-contracts.md](../../architecture/04-api-contracts.md) ·
> [architecture/02-data-model.md](../../architecture/02-data-model.md) ·
> [SCOPE.md](../../SCOPE.md)

This page is the candidate's self-service control centre. It groups four distinct concerns — identity & credentials, consent management (who may see my report), an access/audit log (who has seen it), data rights (export + deletion), and notification preferences — into a single tabbed shell. All features described here are **candidate-facing** and ship in **Phase 1** unless explicitly marked as a later phase. The page enforces SCOPE §6.2 (explicit per-share consent), §11 (delete on request), and the deletion pipeline and audit requirements in [architecture/05-security-privacy.md](../../architecture/05-security-privacy.md) §4.4 and §9.

---

## 1. Purpose & Audiences

| Audience | Role token | What they do here |
|----------|-----------|-------------------|
| **Candidate** | `candidate` | Primary audience; all four sections are available. |
| **Employer / Recruiter** | `employer` / `recruiter` | Access their own account section only (credential + notification tabs); consent management sections are hidden — employers do not manage ShareGrants from here. |
| **Admin** | `admin` | Uses the admin panel, not this page. |

This document covers only the **candidate** perspective.

---

## 2. Route(s)

All routes live under the authenticated shell layout (`/app/...`). Unauthenticated access redirects to `/auth/sign-in` via the `JwtAuthGuard` middleware.

| Path | Tab / Sub-route | Description |
|------|----------------|-------------|
| `/app/account` | Redirects to `/app/account/profile` | Default landing |
| `/app/account/profile` | **Profile** tab | Name, contact details, password, optional MFA |
| `/app/account/consent` | **Consent** tab | ShareGrants list, grant new share, revoke |
| `/app/account/access-log` | **Access Log** tab | Audit trail of who viewed the report and when |
| `/app/account/data-rights` | **Data Rights** tab | Export my data; request account/data deletion |
| `/app/account/notifications` | **Notifications** tab | Email/push notification preferences |

The tab nav is a shallow router — switching tabs does not cause a full page reload. Each tab URL is deep-linkable and shareable.

---

## 3. Phase

**Phase 1 — Core scoring + report.** All sub-features in this document are required for Phase 1 launch. Specifically:

- Profile editing and password change are foundational account operations.
- Consent management is **mandatory** per SCOPE §6.2 before any employer can view a report.
- Data rights (export + deletion) are required to meet SCOPE §11 and the compliance posture in [architecture/05-security-privacy.md §4.3](../../architecture/05-security-privacy.md).
- Notification preferences are needed for score-ready and consent-request email flows.
- MFA is marked as optional for Phase 1 (UI scaffold present; full TOTP integration may slip to Phase 1 polish).

---

## 4. Layout / Wireframe

```
┌─────────────────────────────────────────────────────────────────────────┐
│  STABIL   [Logo]                                    [Avatar] [Sign out]  │
├─────────────────────────────────────────────────────────────────────────┤
│  < Back to Dashboard                                                     │
│                                                                          │
│  Account Settings                                                        │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ [Profile] [Consent]  [Access Log]  [Data Rights]  [Notifications]│   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │                                                                  │    │
│  │  ← active tab content renders here (see §5 per-tab wireframes) →│    │
│  │                                                                  │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Mobile (Expo/RN):** the tab bar is replaced by a `<Stack>` screen titled "Account" with a `<SectionList>` of settings rows. Tapping any row pushes a detail screen. All sub-screens share a consistent back-button to the Account index. See [frontend/mobile.md](../mobile.md) for Expo navigation conventions.

---

## 5. Sub-Stages (Per-Tab Detail)

### 5.1 Profile Tab — `/app/account/profile`

#### 5.1.1 Purpose
Allows the candidate to update their display name, contact email/phone, change their password, and optionally configure multi-factor authentication (MFA).

#### 5.1.2 Wireframe

```
┌──────────────────────────────────────────────────────────┐
│  Profile                                                  │
├──────────────────────────────────────────────────────────┤
│  PERSONAL INFORMATION                                     │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Full name        [Aditya Garud               ]     │  │
│  │ Email            [dev@example.com             ]     │  │
│  │ Phone (optional) [+91 98765 43210             ]     │  │
│  │                                       [Save]        │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  CHANGE PASSWORD                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Current password  [••••••••••••••         ]        │  │
│  │ New password      [••••••••••••••         ]        │  │
│  │ Confirm password  [••••••••••••••         ]        │  │
│  │                               [Update password]    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  TWO-FACTOR AUTHENTICATION (optional)                     │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Authenticator app         Status: Disabled          │  │
│  │ [Enable two-factor authentication]                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

#### 5.1.3 Fields & Validation

| Field | Type | Rules (Zod) |
|-------|------|-------------|
| `name` | `string` | min 1, max 120, trimmed |
| `email` | `string` | `.email()`, unique check via API |
| `phone` | `string \| undefined` | optional; E.164 format `z.string().regex(/^\+[1-9]\d{6,14}$/)` |
| `currentPassword` | `string` | required when changing password; min 8 |
| `newPassword` | `string` | min 8, max 128; at least one uppercase, one digit, one special char |
| `confirmPassword` | `string` | must match `newPassword` via `refine()` |

Email changes trigger a **re-verification email** to the new address before the change takes effect (same pattern as onboarding). The candidate's old email remains active until the new one is confirmed.

#### 5.1.4 MFA Sub-Flow

MFA is **optional** for Phase 1. The TOTP scaffold UI is present but the backend TOTP enrollment endpoint (`POST /api/v1/auth/mfa/totp/enroll`) may ship in Phase 1 polish. The UI states are:

- **Disabled:** shows "Enable two-factor authentication" button.
- **Enrollment:** shows QR code + manual secret entry + 6-digit confirmation input. Submit → `POST /api/v1/auth/mfa/totp/enroll { code }`.
- **Enabled:** shows "Two-factor authentication is active. Last used: [date]" + "Disable" button (requires re-auth).

---

### 5.2 Consent Tab — `/app/account/consent`

#### 5.2.1 Purpose

This is the candidate's **consent command centre**. It surfaces every active `ShareGrant` record (see [architecture/02-data-model.md](../../architecture/02-data-model.md) §2 — entity `ShareGrant`), allows granting a new share to a specific employer/recruiter, and provides one-click revocation per grant. This implements SCOPE §6.2 and [architecture/05-security-privacy.md §3](../../architecture/05-security-privacy.md).

#### 5.2.2 Wireframe — active grants list

```
┌──────────────────────────────────────────────────────────────┐
│  Consent Management                                           │
│  Control who can view your stability report.                  │
├──────────────────────────────────────────────────────────────┤
│  [+ Share my report]          [Filter: All ▾]                 │
│                                                               │
│  ACTIVE SHARES  (2)                                           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ 🏢 Acme Recruiting Ltd                                │    │
│  │    Shared with: hr@acme.example.com                   │    │
│  │    Scope:  Full report                                │    │
│  │    Granted: 2026-05-20   Expires: 2026-08-20          │    │
│  │    Status: ● Active                                   │    │
│  │                                    [Revoke]           │    │
│  ├──────────────────────────────────────────────────────┤    │
│  │ 👤 TechHire Partners                                  │    │
│  │    Shared with: recruiter@techhire.example.com        │    │
│  │    Scope:  Summary only                               │    │
│  │    Granted: 2026-06-01   Expires: Never               │    │
│  │    Status: ● Active                                   │    │
│  │                                    [Revoke]           │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  PAST / EXPIRED SHARES  (3 — collapsed by default)            │
│  [▶ Show expired and revoked shares]                          │
└──────────────────────────────────────────────────────────────┘
```

#### 5.2.3 Grant New Share Sub-Flow

Clicking **"+ Share my report"** opens a modal (web) or pushes a screen (mobile).

**Step 1 — Recipient details**

```
┌─────────────────────────────────────────────────────────┐
│  Share your report                                       │
├─────────────────────────────────────────────────────────┤
│  Recipient email                                         │
│  [recruiter@company.com                          ]       │
│                                                          │
│  Recipient role                                          │
│  (○) Employer    (●) Recruiter                          │
│                                                          │
│  Company / organisation name (optional)                  │
│  [Acme Corp                                      ]       │
│                                           [Next →]       │
└─────────────────────────────────────────────────────────┘
```

**Step 2 — Scope & expiry**

```
┌─────────────────────────────────────────────────────────┐
│  What do you want to share?                              │
├─────────────────────────────────────────────────────────┤
│  Report scope                                            │
│  (●) Full report  (score, tier, all parameters)         │
│  (○) Summary only  (tier + overall score)               │
│  (○) Verification status only  (Verified User flag)     │
│                                                          │
│  Access expiry                                           │
│  (○) 30 days    (●) 90 days    (○) 180 days             │
│  (○) Never (until I revoke)                             │
│                                                          │
│  ┌───────────────────────────────────────────────────┐  │
│  │ ⚠  You are about to share your stability report   │  │
│  │    with recruiter@company.com. They will be able   │  │
│  │    to see your score, tier, and parameter details  │  │
│  │    (excluding sensitive attributes shown only in   │  │
│  │    employer view). You can revoke access at any    │  │
│  │    time from this page.                            │  │
│  └───────────────────────────────────────────────────┘  │
│                                                          │
│  [← Back]                        [Confirm & Share]       │
└─────────────────────────────────────────────────────────┘
```

The disclosure banner is mandatory and non-dismissible. The primary action is labeled "Confirm & Share" (affirmative action — not pre-ticked, per [architecture/05-security-privacy.md §3.5](../../architecture/05-security-privacy.md) and SCOPE §6.2). The candidate must explicitly click this button.

**Step 3 — Confirmation**

```
┌─────────────────────────────────────────────────────────┐
│  ✓ Report shared                                         │
│                                                          │
│  recruiter@company.com now has access to your report.   │
│  Access expires in 90 days (2026-09-04).                │
│                                                          │
│  You can revoke this access any time from the           │
│  Consent tab.                                            │
│                                            [Done]        │
└─────────────────────────────────────────────────────────┘
```

#### 5.2.4 Revoke Sub-Flow

Clicking **"Revoke"** on an active grant shows a confirmation dialog:

```
┌─────────────────────────────────────────────────────────┐
│  Revoke access?                                          │
│                                                          │
│  Acme Recruiting Ltd (hr@acme.example.com) will lose    │
│  access to your report immediately. They will not be    │
│  notified.                                              │
│                                                          │
│  [Cancel]                                [Revoke access] │
└─────────────────────────────────────────────────────────┘
```

On confirm → `DELETE /api/v1/consent/grants/:grantId`. The API sets `ShareGrant.revokedAt = now()` and `status = revoked`. The `ConsentGuard` immediately blocks the employer's next API call. The grant card moves to the "Past / Expired" section in the list.

#### 5.2.5 ShareGrant Scope Values

| Scope value | What the employer/recruiter can see |
|-------------|-------------------------------------|
| `full-report` | All candidate-visible parameters (score, tier, breakdown). Sensitive `employer-only` params (age, marital status) are shown in the employer report per SCOPE §6.3 — this is controlled by the report assembly layer, not consent scope. |
| `summary-only` | Tier label + overall score only |
| `verification-status` | Verified User badge only (no score) |

---

### 5.3 Access Log Tab — `/app/account/access-log`

#### 5.3.1 Purpose

Gives the candidate a transparent, append-only record of every time their report was accessed by an employer or recruiter, plus system events (consent grants, revocations, logins) that concern their account. This implements the candidate-facing view of the audit trail required by [architecture/05-security-privacy.md §9](../../architecture/05-security-privacy.md) and the data-subject right of access under SCOPE §11.

> Note: candidates see a **filtered view** of audit events that concern their own data. Candidates cannot see admin audit queries or the full `AuditLog` table. The backend filters by `targetId = me` and only exposes event types relevant to the candidate's perspective.

#### 5.3.2 Wireframe

```
┌──────────────────────────────────────────────────────────────┐
│  Access Log                                                   │
│  A record of who has accessed your report and key             │
│  account events.                                              │
├──────────────────────────────────────────────────────────────┤
│  [Filter: All events ▾]         [Date range: Last 90 days ▾]  │
│                                                               │
│  June 2026                                                    │
│  ─────────────────────────────────────────────────────────   │
│  ● Report viewed                                              │
│    Acme Recruiting Ltd · hr@acme.example.com                  │
│    Full report · Scope: full-report                           │
│    2026-06-05 at 14:32 UTC                                    │
│                                                               │
│  ● Consent granted                                            │
│    You shared your report with recruiter@techhire.example.com │
│    2026-06-01 at 09:10 UTC                                    │
│                                                               │
│  May 2026                                                     │
│  ─────────────────────────────────────────────────────────   │
│  ● Report viewed                                              │
│    TechHire Partners · recruiter@techhire.example.com         │
│    Summary only · Scope: summary-only                         │
│    2026-05-28 at 11:05 UTC                                    │
│                                                               │
│  ● Consent revoked                                            │
│    Access for oldemployer@example.com removed by you          │
│    2026-05-15 at 16:22 UTC                                    │
│                                                               │
│  ● Sign-in                                                    │
│    Successful login from 203.0.113.4 (Chrome / macOS)         │
│    2026-05-10 at 08:01 UTC                                    │
│                                                               │
│  [Load older events]                                          │
└──────────────────────────────────────────────────────────────┘
```

#### 5.3.3 Event Types Displayed

| `eventType` (from `AuditLog`) | Display label | Candidate-visible? |
|-------------------------------|---------------|--------------------|
| `report.viewed` | "Report viewed" | Yes |
| `consent.granted` | "Consent granted" | Yes |
| `consent.revoked` | "Consent revoked" | Yes |
| `consent.expired` | "Consent expired" | Yes |
| `account.login` | "Sign-in" | Yes |
| `account.logout` | "Sign-out" | Yes |
| `account.deletion-requested` | "Deletion requested" | Yes |
| `score.run` | "Score calculated" | Yes |
| `document.downloaded` | "Document accessed" (admin/verification only) | Yes |
| `verification.approved` | "Document verified" | Yes |
| `verification.rejected` | "Document review rejected" | Yes |

Events not in this list (e.g. `employer-only-param.accessed`, `refresh-token.reuse-detected`) are **admin-only** and not exposed here.

#### 5.3.4 Pagination

The list is paginated: 25 events per page, cursor-based (keyset on `occurredAt DESC, id DESC`). "Load older events" appends the next page using TanStack Query's infinite query. Filters (event type, date range) reset the cursor.

---

### 5.4 Data Rights Tab — `/app/account/data-rights`

#### 5.4.1 Purpose

Implements the candidate's data-subject rights under SCOPE §11 and [architecture/05-security-privacy.md §4.3](../../architecture/05-security-privacy.md): the right to export all personal data (portability) and the right to request full account and data deletion.

#### 5.4.2 Wireframe

```
┌──────────────────────────────────────────────────────────────┐
│  Data Rights                                                  │
│  Your data belongs to you. Export or permanently delete it.   │
├──────────────────────────────────────────────────────────────┤
│  EXPORT YOUR DATA                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Download a complete copy of all data Stabil holds      │  │
│  │ about you: profile, score history, form answers,       │  │
│  │ uploaded documents, and consent records.               │  │
│  │                                                        │  │
│  │ The export is prepared as a JSON archive. We aim to    │  │
│  │ deliver it within 72 hours (DPDP / GDPR compliant).    │  │
│  │                                                        │  │
│  │                          [Request data export]         │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  ─────────────────────────────────────────────────────────   │
│                                                               │
│  DELETE MY ACCOUNT & DATA                                     │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ⚠ This is permanent and cannot be undone.             │  │
│  │                                                        │  │
│  │ Requesting deletion will:                              │  │
│  │  • Immediately revoke all active sharing consents      │  │
│  │  • Immediately sign you out of all devices             │  │
│  │  • Soft-delete your profile within 24 hours            │  │
│  │  • Permanently purge all your data within 30 days      │  │
│  │  • Delete all uploaded documents from storage          │  │
│  │  • Anonymise (not delete) consent & audit records      │  │
│  │    for legal compliance                                │  │
│  │  • Send you a deletion confirmation email              │  │
│  │                                                        │  │
│  │ [Request account deletion]                             │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

#### 5.4.3 Export Sub-Flow

1. Candidate clicks **"Request data export"**.
2. A `POST /api/v1/account/data-export` request is sent. The API enqueues an export job and returns `202 Accepted` with an estimated ready time (≤ 72 hours).
3. The UI shows a confirmation banner: "Your data export has been requested. We'll email you at dev@example.com when it's ready (within 72 hours)."
4. When the export is ready, the candidate receives an email with a **short-lived signed download link** (the archive is stored in MinIO with a 7-day expiry on the signed URL).
5. The Data Rights tab shows a "Previous exports" section listing past export requests with their status (`pending` | `ready` | `expired`) and a download link if ready.

**Export contents (from `GET /api/v1/account/data-export/:exportId/download`):**

```json
{
  "exportedAt": "2026-06-06T12:00:00.000Z",
  "profile": { "...all CandidateProfile fields..." },
  "scoreRuns": [{ "...ScoreRun with full breakdown..." }],
  "formSubmissions": [{ "...FormSubmission + Answer rows..." }],
  "shareGrants": [{ "...all ShareGrant records..." }],
  "auditLog": [{ "...candidate-visible AuditLog entries..." }],
  "documents": [
    {
      "type": "resume",
      "uploadedAt": "...",
      "downloadUrl": "...signed MinIO URL (15 min TTL)..."
    }
  ]
}
```

The export excludes derived computed values and admin-only fields. It includes a `documents` array of signed download URLs for each file stored in MinIO — these short-lived URLs (15-minute TTL per [architecture/05-security-privacy.md §5.1](../../architecture/05-security-privacy.md)) are generated at export-download time, not at request time.

#### 5.4.4 Deletion Sub-Flow

The deletion flow has two hard gates to prevent accidental deletion.

**Gate 1 — Intent screen** (shown on "Request account deletion" click):

```
┌─────────────────────────────────────────────────────────┐
│  Are you sure you want to delete your account?           │
│                                                          │
│  You have 2 active share grants. These will be          │
│  revoked immediately when deletion is confirmed.         │
│                                                          │
│  This action is permanent. After 30 days, your data     │
│  cannot be recovered.                                    │
│                                                          │
│  [Cancel]                         [Yes, continue →]     │
└─────────────────────────────────────────────────────────┘
```

The count of active grants is fetched from the API and surfaced here so the candidate understands the downstream impact.

**Gate 2 — Re-authentication + typed confirmation**:

```
┌─────────────────────────────────────────────────────────┐
│  Confirm account deletion                                │
│                                                          │
│  Enter your password to confirm:                         │
│  [••••••••••••••                                ]        │
│                                                          │
│  Type DELETE to confirm:                                 │
│  [                                              ]        │
│                                                          │
│  [Cancel]                      [Permanently delete]      │
└─────────────────────────────────────────────────────────┘
```

- The "Permanently delete" button is **disabled** until the password field is non-empty and the typed confirmation field contains the string `DELETE` exactly (case-sensitive).
- On submit: `DELETE /api/v1/account` with body `{ password: string }`.

**Post-deletion (immediate effects in the browser):**

1. The API processes deletion step 1 (set `User.status = pending-deletion`, revoke all sessions, revoke all ShareGrants — see [architecture/05-security-privacy.md §4.4](../../architecture/05-security-privacy.md)).
2. The API returns `200 OK` with `{ status: "pending-deletion", purgeScheduledAt: "2026-07-06T..." }`.
3. The client clears all tokens and redirects to `/auth/deleted-confirmation`, a public page that shows: "Your deletion request has been received. Your account is now disabled. All data will be permanently purged by [date]. A confirmation email has been sent to [email]."
4. All subsequent API calls with old tokens return `401`.

**Pending deletion state (edge case — user re-visits):**

If the user somehow navigates back before purge completes (e.g. via a cached session or a new login attempt), the API returns a dedicated status. The app shows a read-only "Your account is scheduled for deletion on [date]" banner with a **"Cancel deletion"** option (`POST /api/v1/account/cancel-deletion`) available until the purge job runs.

---

### 5.5 Notifications Tab — `/app/account/notifications`

#### 5.5.1 Purpose

Allows the candidate to control which system events trigger email and push notifications (Phase 1: email only; push via Expo is Phase 1 polish).

#### 5.5.2 Wireframe

```
┌──────────────────────────────────────────────────────────────┐
│  Notification Preferences                                     │
├──────────────────────────────────────────────────────────────┤
│  EMAIL NOTIFICATIONS                                          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Score calculated / updated              [●──] ON        │  │
│  │ Consent request received                [●──] ON        │  │
│  │ Someone viewed my report                [●──] ON        │  │
│  │ Consent about to expire (7 days before) [●──] ON        │  │
│  │ Account security alert                  [●──] ON        │  │
│  │ Document verification result            [●──] ON        │  │
│  │ Data export ready                       [●──] ON        │  │
│  │ Product updates & tips                  [───] OFF       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│  PUSH NOTIFICATIONS  (Coming soon in the mobile app)          │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Enable push notifications                              │  │
│  │ [Enable push]  (requires mobile app)                   │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
│                                          [Save preferences]   │
└──────────────────────────────────────────────────────────────┘
```

Security-related notifications (account security alert) are **always on** and the toggle is disabled (locked). All other preferences persist to `PATCH /api/v1/account/notification-preferences`.

---

## 6. Components

### 6.1 Design System Components (shadcn/ui)

| Component | Usage |
|-----------|-------|
| `<Tabs>` + `<TabsList>` + `<TabsTrigger>` + `<TabsContent>` | Top-level tab shell |
| `<Card>` + `<CardHeader>` + `<CardContent>` | Section grouping within each tab |
| `<Form>` + `<FormField>` + `<FormItem>` + `<FormLabel>` + `<FormMessage>` | Profile and password forms (react-hook-form + Zod integration) |
| `<Input>` | Text inputs (name, email, phone, password fields) |
| `<Button>` | Primary actions (Save, Confirm & Share, Revoke, etc.) |
| `<Dialog>` + `<DialogContent>` + `<DialogFooter>` | Revoke confirmation modal; grant new share modal |
| `<AlertDialog>` | Gate-1 deletion warning (destructive action variant) |
| `<Badge>` | Grant status (`Active`, `Expired`, `Revoked`) |
| `<Switch>` | Notification toggles |
| `<RadioGroup>` + `<RadioGroupItem>` | Consent scope selector, expiry selector |
| `<Alert>` | Disclosure banners in the share flow; pending-deletion banner |
| `<Separator>` | Visual section dividers |
| `<Avatar>` | Recipient org avatar in the ShareGrant list |
| `<Skeleton>` | Loading placeholders for grant list and access log |
| `<ScrollArea>` | Access log scroll container |
| `<Select>` | Filter dropdowns (access log event type, date range) |
| `<Collapsible>` | "Past / Expired Shares" collapsed section |
| `<Tooltip>` | Contextual help text on scope descriptions |

### 6.2 Custom / Page-Specific Components

| Component | Path | Description |
|-----------|------|-------------|
| `<ShareGrantCard>` | `components/consent/ShareGrantCard.tsx` | Renders one grant row: org name, email, scope badge, dates, status badge, Revoke button. |
| `<GrantShareModal>` | `components/consent/GrantShareModal.tsx` | Multi-step modal (recipient → scope/expiry → confirmation). Manages its own local step state. |
| `<RevokeGrantDialog>` | `components/consent/RevokeGrantDialog.tsx` | Confirmation AlertDialog; receives `grantId` + display name; calls revoke mutation on confirm. |
| `<AccessLogEntry>` | `components/audit/AccessLogEntry.tsx` | Renders one audit event row with icon, label, actor, date. |
| `<DeletionConfirmForm>` | `components/account/DeletionConfirmForm.tsx` | Gate-2 re-auth form; validates password field + typed `DELETE` confirmation; manages disabled state. |
| `<DataExportSection>` | `components/account/DataExportSection.tsx` | Export button + previous-exports list with status and download links. |
| `<NotificationToggleRow>` | `components/account/NotificationToggleRow.tsx` | Labelled switch row; accepts `locked` prop for security alerts. |
| `<MfaEnrollSection>` | `components/account/MfaEnrollSection.tsx` | QR code display + 6-digit code input + submit. Handles TOTP enrollment state machine. |
| `<PendingDeletionBanner>` | `components/account/PendingDeletionBanner.tsx` | Full-page warning banner shown if `User.status === pending-deletion`; contains "Cancel deletion" action. |

---

## 7. Data Needs

### 7.1 Queries (TanStack Query)

| Query key | Endpoint | Used in |
|-----------|----------|---------|
| `['account', 'me']` | `GET /api/v1/account/me` | Profile tab — pre-fills name, email, phone |
| `['consent', 'grants', 'active']` | `GET /api/v1/consent/grants?status=active` | Consent tab — active grants list |
| `['consent', 'grants', 'all']` | `GET /api/v1/consent/grants` | Consent tab — expanded past/expired list |
| `['audit', 'log', filters]` | `GET /api/v1/account/audit-log?...` | Access Log tab — paginated events |
| `['account', 'exports']` | `GET /api/v1/account/data-export` | Data Rights tab — previous export requests |
| `['account', 'notifications']` | `GET /api/v1/account/notification-preferences` | Notifications tab |
| `['account', 'mfa', 'status']` | `GET /api/v1/auth/mfa/status` | Profile tab — MFA enabled/disabled |

### 7.2 Mutations (TanStack Query `useMutation`)

| Mutation | Method + Endpoint | Used in | On success |
|----------|-------------------|---------|------------|
| Update profile | `PATCH /api/v1/account/me` | Profile tab | Invalidate `['account', 'me']`; toast "Profile saved" |
| Change password | `POST /api/v1/auth/change-password` | Profile tab | Toast "Password updated"; do NOT invalidate auth tokens |
| Enroll MFA | `POST /api/v1/auth/mfa/totp/enroll` | Profile tab | Invalidate `['account', 'mfa', 'status']` |
| Disable MFA | `DELETE /api/v1/auth/mfa/totp` | Profile tab | Invalidate `['account', 'mfa', 'status']` |
| Grant share | `POST /api/v1/consent/grants` | Consent tab | Invalidate both grant queries; advance modal to step 3 |
| Revoke grant | `DELETE /api/v1/consent/grants/:grantId` | Consent tab | Invalidate grant queries; close dialog |
| Request export | `POST /api/v1/account/data-export` | Data Rights tab | Invalidate `['account', 'exports']`; show banner |
| Delete account | `DELETE /api/v1/account` | Data Rights tab | Clear tokens → redirect to `/auth/deleted-confirmation` |
| Cancel deletion | `POST /api/v1/account/cancel-deletion` | Pending banner | Invalidate `['account', 'me']`; reload page |
| Update notifications | `PATCH /api/v1/account/notification-preferences` | Notifications tab | Invalidate preferences query; toast "Saved" |

### 7.3 Request / Response Shapes (Key DTOs)

**`POST /api/v1/consent/grants` — CreateShareGrantDto**

```typescript
// packages/contracts/src/consent.ts
import { z } from 'zod';

export const ConsentScope = z.enum(['full-report', 'summary-only', 'verification-status']);
export type ConsentScope = z.infer<typeof ConsentScope>;

export const CreateShareGrantSchema = z.object({
  recipientEmail: z.string().email(),
  recipientRole:  z.enum(['employer', 'recruiter']),
  orgName:        z.string().max(200).optional(),
  scope:          ConsentScope,
  expiresInDays:  z.number().int().min(1).max(365).nullable(),
  // null = indefinite (until revoked)
});

export type CreateShareGrantDto = z.infer<typeof CreateShareGrantSchema>;
```

**`GET /api/v1/consent/grants` — ShareGrantDto (list item)**

```typescript
export const ShareGrantDto = z.object({
  id:             z.string().uuid(),
  recipientEmail: z.string().email(),
  recipientRole:  z.enum(['employer', 'recruiter']),
  orgName:        z.string().nullable(),
  scope:          ConsentScope,
  grantedAt:      z.string().datetime(),
  expiresAt:      z.string().datetime().nullable(),
  revokedAt:      z.string().datetime().nullable(),
  status:         z.enum(['active', 'expired', 'revoked']),
  lastAccessedAt: z.string().datetime().nullable(),
  accessCount:    z.number().int(),
});
```

**`GET /api/v1/account/audit-log` — AuditLogEntryDto (candidate-filtered)**

```typescript
export const AuditLogEntryDto = z.object({
  id:          z.string().uuid(),
  eventType:   z.string(),  // one of the event types listed in §5.3.3
  actorName:   z.string().nullable(),  // org/person display name if applicable
  actorEmail:  z.string().nullable(),
  scope:       ConsentScope.nullable(),  // for report.viewed events
  occurredAt:  z.string().datetime(),
  ipAddress:   z.string().nullable(),  // only for account.login events
  userAgent:   z.string().nullable(),  // only for account.login events
});
```

**`DELETE /api/v1/account` — body**

```typescript
export const DeleteAccountSchema = z.object({
  password: z.string().min(1),
  // Backend validates password before processing; no typed confirmation sent (UI-only gate)
});
```

---

## 8. States

### 8.1 Loading States

- Each tab's content shows `<Skeleton>` placeholders on initial load.
- The grant list shows 2 skeleton `<ShareGrantCard>` rows while `['consent', 'grants', 'active']` is loading.
- The access log shows 5 skeleton rows while fetching.
- Form fields are populated from cached query data; stale-while-revalidate (`staleTime: 5 * 60 * 1000`) prevents flicker.

### 8.2 Empty States

| Location | Condition | Empty state UI |
|----------|-----------|----------------|
| Consent tab — active grants | No active grants | "You haven't shared your report with anyone yet. Click 'Share my report' to get started." + illustration + CTA button. |
| Consent tab — past grants | No revoked/expired grants | Section hidden (the collapsible trigger reads "No past shares"). |
| Access Log | No events in range | "No activity in this period. Try extending the date range." |
| Data Rights — exports | No previous exports | Section shows only the export request button; no list rendered. |

### 8.3 Error States

| Error scenario | Handling |
|----------------|----------|
| Profile save fails (409 email conflict) | Inline `<FormMessage>` under email field: "This email address is already in use." |
| Profile save fails (network) | Toast: "Failed to save profile. Please try again." |
| Grant fails — recipient email not found in system | The API returns `404`; the modal shows an inline error: "No Stabil account found for this email. Ask the employer/recruiter to sign up first." |
| Revoke fails | Toast: "Failed to revoke access. Please try again." Grant card remains in the active list. |
| Delete account — wrong password | Inline error under the password field: "Incorrect password." The purge is not triggered. |
| Export request fails | Toast: "Export request failed. Please contact support." |
| Access log fetch fails | `<Alert>` inside the log container: "Could not load access log. Please refresh the page." |

### 8.4 Pending Deletion State

When `User.status === 'pending-deletion'` (detectable from `GET /api/v1/account/me`), the entire Account Settings page renders with a `<PendingDeletionBanner>` pinned to the top:

```
┌─────────────────────────────────────────────────────────────────┐
│ ⚠  Your account is scheduled for permanent deletion on          │
│    2026-07-06. All data will be purged on that date.            │
│    Until then, your account is disabled and cannot be used      │
│    to share or score.                                            │
│                                      [Cancel deletion]          │
└─────────────────────────────────────────────────────────────────┘
```

All other tabs are rendered as read-only (form inputs disabled, action buttons hidden) except the "Cancel deletion" action in the banner.

### 8.5 MFA Sub-States (Profile Tab)

| State | UI |
|-------|----|
| `disabled` | Enable button visible |
| `enrolling` | QR code + secret + 6-digit code input visible; Cancel link |
| `verifying` | Spinner on the confirm button while `POST /api/v1/auth/mfa/totp/enroll` is in flight |
| `enabled` | "Active" badge + last-used date + Disable button |
| `disabling` | Re-auth modal requiring current password |

---

## 9. Forms & Validation (Zod)

All forms use `react-hook-form` with `@hookform/resolvers/zod`. Schema definitions live in `packages/contracts/src/account.ts` and are imported by both the frontend and the backend NestJS pipes.

### 9.1 Profile Form Schema

```typescript
// packages/contracts/src/account.ts
import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  name:  z.string().min(1, 'Name is required').max(120).trim(),
  email: z.string().email('Invalid email address'),
  phone: z
    .string()
    .regex(/^\+[1-9]\d{6,14}$/, 'Enter a valid phone number with country code (e.g. +91 98765 43210)')
    .optional()
    .or(z.literal('')),
});

export type UpdateProfileDto = z.infer<typeof UpdateProfileSchema>;
```

### 9.2 Change Password Schema

```typescript
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Minimum 8 characters')
      .max(128)
      .regex(
        /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d])/,
        'Must include at least one uppercase letter, one digit, and one special character',
      ),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
```

### 9.3 Grant Share Schema

```typescript
export const CreateShareGrantSchema = z.object({
  recipientEmail: z.string().email('Enter a valid email address'),
  recipientRole:  z.enum(['employer', 'recruiter']),
  orgName:        z.string().max(200).optional(),
  scope:          z.enum(['full-report', 'summary-only', 'verification-status']),
  expiresInDays:  z.union([z.literal(30), z.literal(90), z.literal(180), z.null()]),
});
```

### 9.4 Deletion Confirmation Schema (client-only gate)

```typescript
// This schema is used only for the local UI gate; the API receives only password.
export const DeleteAccountUiSchema = z
  .object({
    password:            z.string().min(1, 'Enter your password to confirm'),
    typedConfirmation:   z.string(),
  })
  .refine((d) => d.typedConfirmation === 'DELETE', {
    message: 'Type DELETE to confirm',
    path: ['typedConfirmation'],
  });
```

---

## 10. Charts

This page contains **no data visualisation charts**. The access log uses a simple sorted list. If an aggregate view is needed (e.g. "views over time"), a `<BarChart>` via `react-chartjs-2` could be added in a later phase, but it is out of scope for Phase 1.

---

## 11. Accessibility

| Requirement | Implementation |
|-------------|---------------|
| **Tab navigation** | `<Tabs>` uses shadcn/ui's `@radix-ui/react-tabs` which implements ARIA `tablist` / `tab` / `tabpanel` roles and keyboard navigation (`←` / `→` to switch tabs, `Enter`/`Space` to activate). |
| **Form labels** | Every input has an associated `<label>` (via `<FormLabel>`); no placeholder-only labels. Error messages are linked via `aria-describedby`. |
| **Button states** | Destructive buttons (Revoke, Permanently delete) use `variant="destructive"`; the "Permanently delete" button has `aria-disabled={!isFormValid}` and a `title` tooltip explaining why it is disabled. |
| **Confirmation dialogs** | `<AlertDialog>` from Radix traps focus inside the dialog; pressing `Escape` cancels; the destructive action is not the default focused element. |
| **Disclosure banner** | The share-flow disclosure notice uses `role="alert"` so screen readers announce it without requiring focus. |
| **Toggle switches** | `<Switch>` has `aria-label` including the notification name and current state (e.g. "Score calculated — on"). Locked switches have `aria-disabled="true"` and a tooltip "This notification cannot be disabled for security reasons." |
| **Pending-deletion banner** | `role="alert"` + `aria-live="assertive"` so it announces immediately on render. |
| **Colour contrast** | Active grant status badge: green text on white background ≥ 4.5:1. Revoked badge: grey text ≥ 4.5:1. Error messages: red text meets WCAG 2.1 AA. |
| **Focus management** | After the grant modal closes (success or cancel), focus returns to the "Share my report" trigger button. After revoke dialog closes, focus returns to the revoked grant's row (or the previous focusable element if the row is removed). |
| **Skip link** | The page shell includes a `<a href="#tab-content">Skip to content</a>` skip link visible on focus. |
| **Mobile a11y** | On Expo/RN, `AccessibilityRole` is set correctly: buttons have `accessibilityRole="button"`, toggles have `accessibilityRole="switch"`, and `accessibilityState={{ disabled, checked }}` is kept in sync with UI state. |

---

## 12. Acceptance Criteria

### 12.1 Profile & Account

- [ ] **AC-PROF-01** — Submitting a valid profile update form calls `PATCH /api/v1/account/me` and reflects the new name/email/phone within the same session without a full page reload.
- [ ] **AC-PROF-02** — Attempting to save with an email already registered to another account shows an inline field error "This email address is already in use" and does not navigate away.
- [ ] **AC-PROF-03** — A successful password change does not invalidate the current session (the candidate stays logged in) but all other sessions for that account are revoked.
- [ ] **AC-PROF-04** — The new-password field displays the Zod validation message before the form is submitted if the pattern requirement is not met (live `onChange` validation after the field is first touched).
- [ ] **AC-PROF-05** — The "Confirm password" field shows "Passwords do not match" if it differs from the new password field, and the submit button remains disabled.

### 12.2 Consent Management

- [ ] **AC-CONS-01** — A candidate with no active share grants sees the empty-state prompt, not an empty list or spinner.
- [ ] **AC-CONS-02** — Granting a new share requires the candidate to click an affirmative "Confirm & Share" button. No pre-ticked checkboxes or implicit consent paths exist.
- [ ] **AC-CONS-03** — The disclosure banner ("You are about to share your stability report with…") is visible and non-dismissible on Step 2 of the share flow.
- [ ] **AC-CONS-04** — Attempting to grant a share to an email not registered in the system returns an inline error in the modal without closing it.
- [ ] **AC-CONS-05** — After a successful grant, the new grant card appears in the active list without requiring a page reload, and the `lastAccessedAt` is null and `accessCount` is 0.
- [ ] **AC-CONS-06** — **Revoking a grant immediately blocks employer access**: if the employer calls `GET /api/v1/reports/:candidateId` after revocation, the API returns `403 Forbidden` with problem+json `type: consent-required`. This must be verified by an API integration test.
- [ ] **AC-CONS-07** — The revoked grant card moves from the "Active" section to the "Past / Expired Shares" section within the same UI update (optimistic update is acceptable but must not persist if the API call fails).
- [ ] **AC-CONS-08** — The "Revoke" confirmation dialog states the employer's name and email so the candidate can confirm they are revoking the correct grant.
- [ ] **AC-CONS-09** — Expired grants (where `expiresAt` has passed) appear only in the collapsed "Past / Expired" section and do not show a Revoke button.

### 12.3 Access Log

- [ ] **AC-LOG-01** — The access log shows `report.viewed` events with the employer/recruiter's org name, email, scope label, and UTC timestamp.
- [ ] **AC-LOG-02** — Events are listed in reverse-chronological order (most recent first).
- [ ] **AC-LOG-03** — "Load older events" appends the next page of results without resetting the list to the top.
- [ ] **AC-LOG-04** — Filtering by event type refreshes the list to show only matching events; the cursor resets.
- [ ] **AC-LOG-05** — Admin-only event types (`employer-only-param.accessed`, `refresh-token.reuse-detected`) are never returned by `GET /api/v1/account/audit-log` for a `candidate` role — this is enforced server-side and verified by an API test.

### 12.4 Data Export

- [ ] **AC-EXP-01** — Clicking "Request data export" calls `POST /api/v1/account/data-export` and the UI immediately shows a confirmation banner that the request has been received.
- [ ] **AC-EXP-02** — The Data Rights tab lists previous export requests with their status (`pending`, `ready`, `expired`).
- [ ] **AC-EXP-03** — A "ready" export shows a download link. Clicking the link fetches a pre-signed MinIO URL from the backend and initiates the browser download.
- [ ] **AC-EXP-04** — The exported JSON contains the candidate's profile, all score runs, all form submissions, all share grants, and candidate-visible audit events — verified by an integration test against a seeded test account.

### 12.5 Account Deletion

- [ ] **AC-DEL-01** — **Deletion request enqueues purge and disables sharing**: calling `DELETE /api/v1/account` with a valid password immediately sets `User.status = pending-deletion`, revokes all active `ShareGrant` records, and revokes all sessions. Verified by API integration test.
- [ ] **AC-DEL-02** — The "Permanently delete" button is disabled until both the password field is non-empty and the typed confirmation field contains exactly `DELETE` (case-sensitive).
- [ ] **AC-DEL-03** — Submitting the deletion form with an incorrect password shows an inline error "Incorrect password" and does not proceed with deletion.
- [ ] **AC-DEL-04** — After successful deletion, the client clears all access and refresh tokens and redirects to `/auth/deleted-confirmation`. No subsequent authenticated API calls succeed.
- [ ] **AC-DEL-05** — A candidate in `pending-deletion` status who attempts to share their report receives an API error (`409 Conflict`, type `account-pending-deletion`) and sees a UI message explaining that sharing is disabled while deletion is pending.
- [ ] **AC-DEL-06** — The Gate-1 dialog shows the count of active share grants that will be revoked, matching the live value from `GET /api/v1/consent/grants?status=active`.
- [ ] **AC-DEL-07** — "Cancel deletion" is available until the purge job runs (i.e. while `deletedAt` has been set but < 30 days have passed). After purge, the account no longer exists and the cancel endpoint returns `404`.
- [ ] **AC-DEL-08** — Consent records and audit logs are **anonymised** (not hard-deleted) after purge. A Playwright test confirms that after deletion, no personal identifiers (name, email) appear in the retained records — this requires an admin-role API call to verify.

### 12.6 Notifications

- [ ] **AC-NOTIF-01** — Saving notification preferences calls `PATCH /api/v1/account/notification-preferences` and shows a "Saved" toast.
- [ ] **AC-NOTIF-02** — The "Account security alert" toggle is always on and its switch control is visually disabled and cannot be toggled; it returns to the `on` state even if the user manipulates the DOM.
- [ ] **AC-NOTIF-03** — Preference changes are persisted: refreshing the page after saving shows the same toggle states.

### 12.7 Accessibility

- [ ] **AC-A11Y-01** — All four tabs are reachable and operable using keyboard only (`Tab` to reach the tab list, `←`/`→` to navigate between tabs).
- [ ] **AC-A11Y-02** — The destructive "Revoke" and "Permanently delete" buttons are not the default-focused element when their respective dialogs open.
- [ ] **AC-A11Y-03** — Focus returns to the appropriate trigger element after any modal or dialog closes.
- [ ] **AC-A11Y-04** — The `<PendingDeletionBanner>` is announced immediately by screen readers on render (`aria-live="assertive"`).
- [ ] **AC-A11Y-05** — All interactive elements achieve at least WCAG 2.1 AA colour contrast (4.5:1 for normal text, 3:1 for large text/UI components).

---

## 13. Security Notes (Implementation Reminders)

These are implementation-time reminders derived from [architecture/05-security-privacy.md](../../architecture/05-security-privacy.md). They are not new decisions — they restate architecture requirements the frontend must respect.

1. **No consent bypass UI.** There must be no path on this page that results in a `ShareGrant` being created without the candidate explicitly clicking an affirmative action button. See [architecture/05-security-privacy.md §3.5](../../architecture/05-security-privacy.md).

2. **Password fields never persisted.** Password values must not be stored in TanStack Query cache, `localStorage`, or any persistent browser store. The form state lives only in `react-hook-form`'s in-memory `useForm` state and is cleared on unmount.

3. **Token clearance on deletion.** The deletion flow must clear both the access token (in-memory) and the refresh token (HttpOnly cookie via `POST /api/v1/auth/logout` before or as part of the deletion response) before redirecting. The API revokes the session server-side (Step 1 of the deletion pipeline); the client must also clear its local state to prevent stale token reuse.

4. **Audit log read-only.** The access log UI must have no controls that could imply editing, filtering out, or deleting log entries. The backend enforces append-only via the `AuditService`; the UI must not give a false impression of user control over log contents.

5. **Sensitive-attribute transparency during consent.** When the share scope is `full-report` and the recipient role is `employer` or `recruiter`, the disclosure banner must explicitly note that the employer view includes attributes not shown to the candidate (age, marital status) per SCOPE §6.3. This is a legal requirement, not a UI nicety.

---

## 14. Cross-References

| Topic | Document |
|-------|---------|
| ShareGrant entity, lifecycle, `ConsentGuard` | [backend/modules/consent-sharing.md](../../backend/modules/consent-sharing.md) |
| User, Session, RefreshToken entities; password hashing; JWT; MFA | [backend/modules/auth-accounts.md](../../backend/modules/auth-accounts.md) |
| Deletion pipeline (steps 1–7), retention policy | [architecture/05-security-privacy.md §4.4](../../architecture/05-security-privacy.md) |
| Audit logging schema and event types | [architecture/05-security-privacy.md §9](../../architecture/05-security-privacy.md) |
| RBAC permission matrix (who can grant/revoke) | [architecture/05-security-privacy.md §8](../../architecture/05-security-privacy.md) |
| `ConsentScope` and consent record structure | [architecture/05-security-privacy.md §3.2](../../architecture/05-security-privacy.md) |
| Data export endpoint (`GET /api/v1/account/data-export`) | [architecture/04-api-contracts.md](../../architecture/04-api-contracts.md) |
| Data model: `ShareGrant`, `AuditLog`, `User` | [architecture/02-data-model.md](../../architecture/02-data-model.md) |
| Notification module (email/push channels) | [backend/modules/notifications.md](../../backend/modules/notifications.md) |
| Form conventions (react-hook-form + Zod + TanStack Query) | [frontend/state-and-forms.md](../state-and-forms.md) |
| shadcn/ui token and theming reference | [frontend/design-system.md](../design-system.md) |
| Expo/RN navigation and screen patterns | [frontend/mobile.md](../mobile.md) |
| Onboarding auth (sign-in, sign-up) | [frontend/pages/onboarding-auth.md](./onboarding-auth.md) |
| Candidate report dashboard | [frontend/pages/candidate-report.md](./candidate-report.md) |
