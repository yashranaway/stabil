# Security & Privacy

> **Status:** Draft v0.1 · **Phase:** cross-cutting · **Owner area:** backend/infra/data
> **Related:** [02-data-model.md](./02-data-model.md) · [backend/modules/consent-sharing.md](../backend/modules/consent-sharing.md) · [backend/modules/verification.md](../backend/modules/verification.md) · [SCOPE.md](../SCOPE.md)

This document is the security and privacy reference for Stabil. It covers how sensitive attributes are handled throughout the system, the PII inventory, consent enforcement, regulatory compliance, document storage security, AI/PII boundaries, authentication hardening, the full RBAC permission matrix, audit logging, and the threat model. Every implementation decision in this document derives from confirmed product scope — see SCOPE §6, §10, §11, and §12 for the authoritative product decisions.

---

## 1. Sensitive-Attribute Handling (Age & Marital Status)

### 1.1 The decision (SCOPE §6.3, §12)

Age and marital status are **scored parameters** — they contribute to the stability score. However, they carry a **dual legal/fairness risk**:

1. **Direct exposure risk:** Showing age or marital status in a candidate's own report could expose the system to discrimination-awareness claims (candidates knowing exactly which personal attributes were scored against them).
2. **Indirect employer-use risk:** Even with suppression from the candidate view, employers receive a score that has been influenced by these attributes. This does not remove the underlying legal risk — a score inflated or deflated by marital status or age still has legal implications in hiring under India's employment law, and analogous laws in other jurisdictions. **A pre-production regional legal review is mandatory (see §11).**

The confirmed design decision: **score both attributes, suppress them from the candidate-facing report, expose them only in the employer/recruiter view, and audit every access**.

### 1.2 Visibility model

Every scoring parameter carries a `visibility` field. The two permitted values are:

| Visibility value | Who sees the line-item in the report | Affected parameters |
|-----------------|--------------------------------------|---------------------|
| `all` | Candidate, employer, recruiter, admin | All parameters except the two below |
| `employer-only` | Employer and recruiter only (never candidate) | `age`, `marital_status` |

The `visibility` field lives in the `Parameter` entity in the database (see [02-data-model.md](./02-data-model.md)). It is **not a runtime config** — it is a data-driven property enforced at every serialization boundary.

### 1.3 Technical enforcement points

Three independent layers prevent leakage to the candidate audience:

**Layer 1 — Report assembly (backend).**
The `ReportsService` filters parameters before building any report DTO:

```typescript
// packages/core/src/report/assemble.ts (conceptual)
function assembleReport(
  scoreRun: ScoreRun,
  audience: 'candidate' | 'employer' | 'recruiter' | 'admin',
): ReportDTO {
  const visibleParams = scoreRun.parameterBreakdown.filter((p) => {
    if (p.visibility === 'employer-only') {
      return audience === 'employer' || audience === 'recruiter' || audience === 'admin';
    }
    return true;
  });
  return buildDTO(visibleParams, audience);
}
```

**Layer 2 — API response serialization.**
The NestJS interceptor strips any field marked `employerOnly: true` from the serialized response when the authenticated principal's role is `candidate`. This is a defence-in-depth catch for cases where the assembly layer is bypassed.

**Layer 3 — Audit log.**
Every call to a report endpoint that touches `employer-only` parameters is written to the `AuditLog` table with the accessor's user ID, their role, the report ID, the parameter keys accessed, and a timestamp (see §9).

### 1.4 What is never done

- Employer-only parameter values are **never included** in any response JSON payload delivered to a `candidate`-role session, even as zero or null.
- Employer-only parameters are **never returned** by any candidate-facing API route (`/api/v1/candidates/me/report`, `/api/v1/candidates/me/score`).
- PDF exports for candidates **exclude** employer-only line-items; the employer PDF explicitly marks them as `[Employer View]`.

---

## 2. PII Inventory & Data Classification

All personal data collected or inferred by Stabil is classified into one of three tiers.

### 2.1 Classification tiers

| Tier | Definition | Examples in Stabil |
|------|-----------|-------------------|
| **Highly sensitive** | Government identifiers, biometric-linked documents; breach causes identity-fraud risk | Aadhaar number, PAN number, passport number, national ID numbers (international) |
| **Sensitive** | Personal information that, if disclosed, causes material harm | Date of birth, age, marital status, home address, phone number, email, resume (full work/education history), profile photos |
| **Non-sensitive** | Professional or public information; low standalone harm | Score tier label, skill self-ratings, work-mode preference, relocation willingness, AI-familiarity level |

### 2.2 Full PII inventory

| Data element | Classification | Where stored | Retention |
|---|---|---|---|
| Full name | Sensitive | `User.name` (PostgreSQL) | While account active |
| Email address | Sensitive | `User.email` (PostgreSQL, unique) | While account active |
| Phone number | Sensitive | `CandidateProfile.phone` | While account active |
| Date of birth | Sensitive | `CandidateProfile.dateOfBirth` | While account active |
| Age (derived) | Highly sensitive (scored, employer-only) | Not stored independently — derived at score time | N/A (computed) |
| Marital status | Sensitive (scored, employer-only) | `CandidateProfile.maritalStatus` | While account active |
| Home / current city | Sensitive | `CandidateProfile.location` | While account active |
| Resume file | Sensitive | MinIO bucket (`resumes/`) | While account active |
| Aadhaar number | Highly sensitive | `VerificationDocument.idNumber` (encrypted at rest) | While account active |
| PAN number | Highly sensitive | `VerificationDocument.idNumber` (encrypted at rest) | While account active |
| Passport number | Highly sensitive | `VerificationDocument.idNumber` (encrypted at rest) | While account active |
| National ID (international) | Highly sensitive | `VerificationDocument.idNumber` (encrypted at rest) | While account active |
| Document scans / images | Highly sensitive | MinIO bucket (`verification-docs/`, encrypted) | While account active |
| Score history | Non-sensitive | `ScoreRun` table | While account active |
| Parameter breakdown | Mixed (employer-only rows are sensitive) | `ScoreRunParameter` table | While account active |
| Consent records | Sensitive (legal evidence) | `ConsentRecord` table | Retain for audit even after deletion (anonymised) |
| Audit log | Sensitive (access records) | `AuditLog` table | Minimum 2 years |

### 2.3 Handling rules by tier

**Highly sensitive:**
- Encrypted at rest (AES-256 via MinIO server-side encryption or Postgres column-level encryption for structured fields).
- Access restricted to `admin` role and automated verification pipeline; no read access for employer or recruiter.
- Document images: stored in a private MinIO bucket; accessed only via short-lived signed URLs (15-minute expiry) generated by the backend. No public bucket access permitted.
- ID numbers partially masked in any log output (show only last 4 digits).
- Require explicit consent for processing.

**Sensitive:**
- Stored in main PostgreSQL DB; columns holding DOB, marital status, phone are not indexed for full-value search.
- Not included in search indexes.
- Transmission over TLS 1.2+ only.

**Non-sensitive:**
- Standard DB storage; may appear in logs at debug level.

---

## 3. Consent Model

### 3.1 Principle (SCOPE §6.2, §18)

No employer or recruiter may read a candidate's report unless the candidate has given **explicit, affirmative, per-share consent**. Consent is not implied by profile creation, not bundled with Terms of Service acceptance, and not permanent.

### 3.2 Consent record structure

```typescript
interface ConsentRecord {
  id: string;              // UUID v7
  candidateId: string;     // FK → User
  grantedToId: string;     // FK → User (employer or recruiter)
  grantedToRole: 'employer' | 'recruiter';
  scope: ConsentScope[];   // what data is included
  grantedAt: Date;
  expiresAt: Date | null;  // null = indefinite (until revoked)
  revokedAt: Date | null;  // null = still active
  shareToken: string;      // opaque token used in share link
  auditTrail: AuditEvent[]; // append-only access log
}

type ConsentScope =
  | 'full-report'       // all visible parameters for employer audience
  | 'summary-only'      // tier + overall score only
  | 'verification-status'; // Verified User flag only
```

### 3.3 Consent lifecycle

```
Candidate grants consent
       │
       ▼
ConsentRecord created (status: active, expiresAt set if candidate chose TTL)
       │
       ├─► Employer/recruiter accesses report → AuditLog entry written
       │
       ├─► expiresAt reached → ConsentRecord.status set to 'expired' automatically
       │       (cron job runs nightly)
       │
       └─► Candidate revokes → ConsentRecord.revokedAt = now(), status = 'revoked'
               → subsequent employer access blocked immediately
```

### 3.4 Enforcement points (API guard)

**Every** endpoint that delivers a report to an employer or recruiter role passes through the `ConsentGuard` before any data is read. The guard is applied at the NestJS route level; it cannot be bypassed by other guards or interceptors:

```typescript
// backend/src/common/guards/consent.guard.ts (conceptual)
@Injectable()
export class ConsentGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const { candidateId } = req.params;
    const requestorId = req.user.id;

    const consent = await this.consentService.findActiveConsent(
      candidateId,
      requestorId,
    );

    if (!consent) throw new ForbiddenException('No active consent');

    // Attach to request for downstream use (e.g. scope filtering)
    req.activeConsent = consent;
    return true;
  }
}
```

Routes protected by `ConsentGuard`:

- `GET /api/v1/reports/:candidateId` (employer/recruiter audience)
- `GET /api/v1/reports/:candidateId/pdf` (employer/recruiter PDF export)
- `GET /api/v1/candidates/:candidateId/score` (employer/recruiter)
- Any future comparison or ranking endpoint

**No employer or recruiter route reads candidate data before this guard completes successfully.** See [backend/modules/consent-sharing.md](../backend/modules/consent-sharing.md) for full module documentation.

### 3.5 Consent UI contract

- Consent flow must show: what data is shared, with whom (org name + individual), and the expiry.
- Candidate must take an affirmative action (button click, not a pre-ticked checkbox).
- Consent can be revoked from the account settings page at any time.
- Revocation takes effect immediately (next API call from that employer is blocked).

---

## 4. Compliance Posture

### 4.1 Applicable frameworks

| Framework | Applicability |
|-----------|---------------|
| **India DPDP Act 2023** | Primary — all Indian users; Aadhaar/PAN handling; data fiduciary obligations |
| **GDPR (EU/UK)** | Applies to EU/UK residents; analogous to DPDP in most obligations |
| **Other national laws** | India + international scope from day one (SCOPE §14); country-level review required before each market launch |

### 4.2 Lawful basis

| Processing activity | Lawful basis |
|--------------------|-------------|
| Account creation and profile building | **Contract** (user registers to use the product) |
| Scoring (including sensitive attributes) | **Explicit consent** — disclosed during onboarding and re-confirmed before first score run |
| Sharing report with employer/recruiter | **Explicit consent** — per-share consent flow (§3) |
| Verification document processing | **Explicit consent** — separate consent for ID document upload |
| Audit logging | **Legitimate interest** (security, fraud prevention, legal defence) |
| Retention of consent records after account deletion | **Legal obligation** |

> Consent for scoring sensitive attributes (age, marital status) must be granular: candidates must understand these attributes influence their score even though they are not shown in the candidate view.

### 4.3 Data-subject rights

| Right | How implemented | Response SLA |
|-------|----------------|-------------|
| **Right of access** | `GET /api/v1/account/data-export` — returns all stored data as JSON + downloadable archive including documents | 72 hours |
| **Right to export (portability)** | Same endpoint; structured JSON output | 72 hours |
| **Right to correction** | Candidate can edit profile fields at any time; score is recalculated on next run | Immediate |
| **Right to deletion** | `DELETE /api/v1/account` triggers deletion pipeline (see §4.4) | 30 days to complete purge |
| **Right to withdraw consent** | Consent revocation (§3.3) | Immediate |
| **Right to object** | Contact email + in-app ticket; manual review by admin | 30 days |

### 4.4 Retention and deletion pipeline

**Retention policy:**
- Candidate data and documents are retained while the account is active.
- Aggregated, anonymised score statistics may be retained indefinitely for calibration (no PII).
- Consent records are retained for a minimum of 2 years after expiry/revocation (legal evidence), but anonymised (candidate name replaced with hash, employer name retained as legal record).
- Audit logs are retained for a minimum of 2 years.

**Deletion pipeline (triggered by `DELETE /api/v1/account`):**

```
Step 1  Immediate: set User.status = 'pending-deletion', revoke all active sessions
Step 2  Immediate: revoke all active consent records
Step 3  Within 24h: soft-delete (set deletedAt timestamp) on all profile, score, and parameter rows
Step 4  Within 30 days: purge job hard-deletes all soft-deleted rows
Step 5  Within 30 days: MinIO lifecycle rule deletes all documents in the candidate's prefix
Step 6  Anonymise (not delete) consent records and audit logs per §4.4 above
Step 7  Send deletion confirmation email
```

**Implementation:**
- Soft-delete is a `deletedAt: DateTime?` column on `User`, `CandidateProfile`, `ScoreRun`, and `VerificationDocument`.
- A scheduled NestJS task (cron) runs the hard-delete purge nightly; it selects rows where `deletedAt < now() - 30 days`.
- MinIO lifecycle rules are configured per bucket to expire objects with the candidate's object-key prefix after 30 days once a deletion marker is set.

---

## 5. Document Storage Security

### 5.1 MinIO configuration

| Control | Implementation |
|---------|---------------|
| **Encryption at rest** | MinIO server-side encryption (SSE-S3 or SSE-KMS) enabled on all buckets storing candidate documents |
| **Bucket visibility** | All buckets are **private** (no public access policy); no bucket is set to public-read or public-read-write |
| **Access model** | Backend service account is the only principal with direct MinIO access; no client receives MinIO credentials |
| **Signed URLs** | All document downloads delivered via short-lived pre-signed GET URLs (15-minute expiry) generated by `DocumentsService`; URL is single-use where MinIO supports it |
| **Upload path** | Candidates upload via the NestJS API (`POST /api/v1/documents`); the API streams to MinIO; no direct client-to-MinIO upload |

### 5.2 Bucket layout

```
stabil-documents/
├── resumes/
│   └── {candidateId}/
│       └── {documentId}.{ext}
└── verification-docs/
    └── {candidateId}/
        └── {documentId}.{ext}    ← Aadhaar/PAN/passport scans
```

Both prefixes are in a private bucket. The `verification-docs/` prefix additionally has an access log enabled and every access event is written to the `AuditLog` table.

### 5.3 Optional antivirus scan

Before any uploaded file is stored permanently, an optional antivirus/malware scan step is available in the upload pipeline. In the POC this is a no-op pass-through; in production a ClamAV sidecar (or equivalent) should be wired into the `DocumentsService.uploadAndScan()` method. The pipeline:

```
Client → POST /api/v1/documents
  → Multipart parse (max 10 MB)
  → MIME type validation (allowlist: pdf, jpg, png, heic)
  → [Optional] AV scan (ClamAV / cloud AV)
  → MinIO PUT with SSE
  → DB record created (VerificationDocument)
  → Signed URL returned (not the raw MinIO path)
```

See [backend/modules/verification.md](../backend/modules/verification.md) for the full document verification flow.

---

## 6. AI Processing & PII Boundaries

### 6.1 Self-hosted Ollama as the default (SCOPE §10, §20)

Stabil's default AI setup uses **self-hosted Ollama** running an open model (e.g. Llama 3.x) on our own infrastructure. This has a critical privacy consequence: **candidate PII — including resumes, ID document text extracted by OCR, and form answers — never leaves our infrastructure when using the default setup.** There is no third-party API call that transmits raw candidate data to an external service.

Why this matters for compliance:
- DPDP Act and GDPR both impose obligations on data transfers to third parties and cross-border transfers.
- Free tiers of major managed LLM providers (e.g. Gemini free tier) have historically included training-on-submitted-data clauses. Sending raw resumes or PII to such endpoints would constitute a data transfer without adequate safeguard.
- Self-hosting eliminates this risk for the default path.

### 6.2 Provider-agnostic adapter

The parsing module wraps all LLM calls behind an `AIProviderAdapter` interface. The adapter decouples the application from any specific provider:

```typescript
interface AIProviderAdapter {
  parseResume(rawText: string): Promise<ParsedResumeDTO>;
  extractDocumentFields(ocrText: string, docType: DocumentType): Promise<ExtractedFieldsDTO>;
}
```

Two implementations exist:
- `OllamaAdapter` — default; calls `http://localhost:11434`; zero external traffic.
- `ManagedLLMAdapter` — opt-in; calls a managed API (OpenAI, Anthropic, etc.).

### 6.3 Pre-flight checklist before enabling a managed LLM

Before switching `AI_PROVIDER=managed` in any environment that processes real candidate data, verify all of the following:

- [ ] Reviewed the provider's current data-use policy; confirmed they do **not** use API submissions for model training without opt-out.
- [ ] Confirmed opt-out from training is enabled on the account (if available).
- [ ] Data processing agreement (DPA) signed with the provider.
- [ ] Cross-border transfer mechanism in place if provider's servers are outside India/EEA (standard contractual clauses or equivalent).
- [ ] PII minimisation applied: only the minimum fields required for the parsing task are sent; raw ID numbers are stripped before transmission; only extracted text from resumes is sent, not full document images.
- [ ] Logging of prompts containing PII is disabled on the managed provider's dashboard.
- [ ] Legal review sign-off obtained.
- [ ] `AI_PROVIDER_AUDIT_ENABLED=true` is set so every managed LLM call is logged internally.

---

## 7. Authentication Security

### 7.1 Password hashing

All user passwords are hashed using **argon2id** before storage. Configuration:

| Parameter | Value |
|-----------|-------|
| Algorithm | argon2id (memory-hard, phishing-resistant) |
| Memory cost | 64 MB (64 × 1024 KiB) |
| Time cost | 3 iterations |
| Parallelism | 1 |
| Output length | 32 bytes |
| Salt | 16-byte random salt per password (auto-generated by the argon2 library) |

Plain-text passwords are never logged, never stored, and never transmitted after the initial registration/login request over TLS.

### 7.2 JWT access/refresh token rotation

| Token type | Expiry | Storage (client) | Rotation |
|------------|--------|-----------------|---------|
| **Access token** | 15 minutes | In-memory (web) / SecureStore (mobile) | Issued fresh on every refresh |
| **Refresh token** | 30 days | HttpOnly, Secure, SameSite=Strict cookie (web) / SecureStore (mobile) | Rotated on every use (sliding window); old token invalidated |

**Refresh token storage (backend):** refresh tokens are stored as a hash (SHA-256) in the `RefreshToken` table linked to the user. The table has a `revokedAt` column. On every refresh request:
1. The submitted token is hashed and looked up.
2. If found and not revoked/expired → issue new access + refresh tokens, revoke the old refresh record, insert a new one.
3. If the submitted token has already been used (i.e. its record is revoked) → **reuse detected**: revoke all refresh tokens for that user (logout everywhere) and emit a security alert.

### 7.3 Brute-force protection and account lockout

| Mechanism | Configuration |
|-----------|-------------|
| **Rate limiting** | `ThrottlerModule` (NestJS); login endpoint limited to 10 requests per 60 seconds per IP |
| **Account lockout** | After 5 consecutive failed login attempts for a specific email: account locked for 15 minutes; lockout state stored in Redis/DB with exponential backoff |
| **CAPTCHA** | Recommended after 3 failed attempts; implementation deferred to Phase 1 polish |
| **Password reset tokens** | Cryptographically random (32 bytes, hex-encoded), single-use, expire after 1 hour |
| **Email enumeration** | Login and password-reset endpoints return identical responses for valid and invalid emails |

### 7.4 Session management

- All sessions are invalidated on explicit logout (refresh token revoked in DB).
- `DELETE /api/v1/account` revokes all sessions immediately (Step 1 of deletion pipeline, §4.4).
- Admin role can revoke all sessions for any user (for incident response).

---

## 8. RBAC Permission Matrix

The four roles in the system are **candidate**, **employer**, **recruiter**, and **admin**. The table below documents which actions each role may perform. "Own" means only on their own resource; "Any" means any resource subject to other guards (e.g. consent).

| Action | Candidate | Employer | Recruiter | Admin |
|--------|:---------:|:--------:|:---------:|:-----:|
| Register / create account | ✓ | ✓ | ✓ | — |
| Edit own profile | ✓ | — | — | ✓ |
| View own score + report (candidate view) | ✓ (own) | — | — | ✓ |
| View own parameter breakdown (all-visibility params) | ✓ (own) | — | — | ✓ |
| View employer-only parameters (age, marital status) | ✗ | ✓ (consented) | ✓ (consented) | ✓ |
| Submit own documents for verification | ✓ (own) | — | — | ✓ |
| Trigger score run (self) | ✓ (own) | — | — | ✓ |
| Submit candidate profile (employer-driven flow) | — | ✓ | ✓ | ✓ |
| View employer/recruiter report of another candidate | ✗ | ✓ (consented) | ✓ (consented) | ✓ |
| Export candidate report as PDF (employer view) | ✗ | ✓ (consented) | ✓ (consented) | ✓ |
| Grant consent to share own report | ✓ (own) | — | — | ✓ |
| Revoke consent | ✓ (own) | — | — | ✓ |
| View list of active consents (own) | ✓ (own) | — | — | ✓ |
| Approve / reject verification document | ✗ | ✗ | ✗ | ✓ |
| Run score on behalf of a candidate | ✗ | ✗ | ✗ | ✓ |
| Delete own account | ✓ (own) | ✓ (own) | ✓ (own) | ✓ |
| Delete any account | ✗ | ✗ | ✗ | ✓ |
| View audit log | ✗ | ✗ | ✗ | ✓ |
| Claim an employer-submitted profile | ✓ (matching email/token) | — | — | ✓ |
| Access data-export (own) | ✓ (own) | ✓ (own) | ✓ (own) | ✓ |
| Search / list all candidates | ✗ | ✗ (Phase 4) | ✗ (Phase 4) | ✓ |
| Configure parameter weights | ✗ | ✗ | ✗ | ✓ |
| Invite employer/recruiter to an org | ✗ | ✓ (own org) | — | ✓ |

**Notes:**
- "consented" = active `ConsentRecord` exists and has not expired or been revoked (enforced by `ConsentGuard`).
- Employer multi-candidate search and ranking is a Phase 4 feature; access control will be specified in that phase's docs.
- All role checks are enforced by NestJS `RolesGuard` applied at the route level; `ConsentGuard` is applied in addition for cross-candidate reads.

---

## 9. Audit Logging

### 9.1 What is logged

Every security-relevant event is written to the `AuditLog` table. Minimum fields per event:

```typescript
interface AuditLog {
  id: string;           // UUID v7
  eventType: AuditEventType;
  actorId: string;      // user ID performing the action
  actorRole: Role;
  targetType: 'user' | 'report' | 'document' | 'consent' | 'scoreRun';
  targetId: string;     // ID of the affected resource
  parameterKeys?: string[]; // for report access: which parameter keys were in the response
  ipAddress: string;
  userAgent: string;
  occurredAt: Date;
  outcome: 'success' | 'denied' | 'error';
  metadata?: Record<string, unknown>; // additional context (e.g. consent ID)
}
```

### 9.2 Audited event types

| Event type | Trigger | Sensitive? |
|------------|---------|-----------|
| `report.viewed` | Employer/recruiter fetches candidate report | Yes — log which parameter keys were included |
| `employer-only-param.accessed` | Report response includes `employer-only` parameter | Yes — always logged |
| `document.downloaded` | Signed URL generated for a verification document | Yes |
| `consent.granted` | Candidate grants a new consent record | Yes |
| `consent.revoked` | Candidate revokes consent | Yes |
| `consent.expired` | Cron job marks consent as expired | No |
| `account.login` | Successful or failed login attempt | Yes — log IP, outcome |
| `account.logout` | Session ended | No |
| `account.deletion-requested` | User triggers account deletion | Yes |
| `account.purged` | Hard-delete purge job runs for a user | Yes |
| `score.run` | Score computation triggered | No |
| `verification.approved` | Admin approves a document | Yes |
| `verification.rejected` | Admin rejects a document | Yes |
| `refresh-token.reuse-detected` | Refresh token replay attack detected | Yes — escalate alert |

### 9.3 Retention and access

- Audit logs are retained for a minimum of **2 years**.
- Only `admin` role can query audit logs.
- Audit log rows are **append-only** — there are no UPDATE or DELETE operations on `AuditLog` (enforced by removing those Prisma operations from the `AuditService`; direct DB access is restricted to the service account).
- In the deletion pipeline (§4.4), the candidate's name is replaced with a hash in audit records, but the records themselves are not deleted.

---

## 10. Threat Model Highlights & Mitigations

### 10.1 Threat summary table

| Threat | Attack vector | Severity | Mitigation |
|--------|---------------|----------|-----------|
| **IDOR on profiles** | Employer guesses another candidate's UUID and calls `GET /api/v1/candidates/:id/report` | High | `ConsentGuard` blocks all cross-candidate reads without active consent; UUIDs are v7 (unguessable); route requires `employer`/`recruiter` role |
| **IDOR on documents** | Attacker intercepts or guesses a document URL | High | All URLs are pre-signed with 15-minute expiry; the raw MinIO path is never exposed; access logged to `AuditLog` |
| **IDOR on score runs** | Candidate A retrieves Candidate B's score run via `GET /api/v1/score-runs/:id` | High | Score run endpoints validate `scoreRun.candidateId === req.user.id` for candidate role; employer access requires `ConsentGuard` |
| **Sensitive-field leakage to candidate audience** | Bug in report assembly exposes `employer-only` fields in candidate API response | High | Three independent enforcement layers (§1.3); integration test suite asserts candidate report never contains `age` or `maritalStatus` fields |
| **Scraping candidate profiles** | Authenticated employer iterates all candidate IDs | Medium | Rate limiting on API; no "list all candidates" endpoint in Phase 1–3; employer can only access consented candidates |
| **ID document fraud** | Candidate submits a forged Aadhaar/PAN image | High | Manual admin review (Phase 3 now); third-party KYC / DigiLocker integration (Phase 3 later); AV scan on upload; document hash stored to detect re-use of same file |
| **Refresh token theft** | Attacker steals HttpOnly cookie via XSS or network | High | HttpOnly + Secure + SameSite=Strict cookie; token rotation with reuse detection (§7.2); short access token lifetime (15 min) |
| **Brute-force login** | Attacker tries many passwords against one account | Medium | Rate limiting (10 req/60s per IP) + account lockout after 5 failures (§7.3) |
| **Managed LLM PII exfiltration** | Developer enables managed LLM without safeguards | High | Pre-flight checklist (§6.3) required; `AI_PROVIDER` defaults to `ollama`; code review gate before any change |
| **Mass deletion / data wipe** | Insider or compromised admin account runs bulk deletes | Critical | Soft-delete + 30-day purge lag allows recovery; admin actions are audit-logged; DB backups on schedule |
| **Consent bypass** | Employer calls report endpoint without a valid consent and gets data | Critical | `ConsentGuard` is applied before any data read; guard failure throws `ForbiddenException`; integration test asserts 403 without consent |

### 10.2 OWASP Top 10 mapping (API-specific)

| OWASP API risk | How addressed |
|----------------|---------------|
| API1 — Broken object-level authorization | `ConsentGuard` + ownership checks on every resource |
| API2 — Broken authentication | argon2id hashing, token rotation, reuse detection |
| API3 — Excessive data exposure | Serialization interceptor strips employer-only fields for candidate role |
| API5 — Broken function-level authorization | `RolesGuard` on every route; admin-only routes explicitly tagged |
| API8 — Security misconfiguration | Private MinIO buckets; SSE enabled; no public access |

---

## 11. Pre-Production Legal / Compliance Checklist

This checklist must be completed and signed off before Stabil is opened to real users in any market. Items marked **(India)** are specific to the India DPDP Act. Items marked **(EU)** apply for any EU/UK users. Items marked **(All)** apply universally.

### 11.1 Sensitive-attribute review

- [ ] **(All)** Regional employment-law review completed for each launch market confirming whether scoring on age and/or marital status is permissible or requires modification to the model.
- [ ] **(All)** Legal justification documented for each sensitive attribute kept in the scoring model; document available for regulatory inspection.
- [ ] **(All)** User-facing disclosure of all scored attributes (including employer-only ones) is present and clear during onboarding consent flow.
- [ ] **(All)** Opt-out mechanism for sensitive attributes is implemented or legally reviewed as unnecessary.

### 11.2 Data protection registration and DPA

- [ ] **(India)** Data fiduciary registration completed under DPDP Act 2023 if required for the category of data processed.
- [ ] **(EU)** Data Protection Officer (DPO) appointed or exemption confirmed.
- [ ] **(EU)** Records of Processing Activities (RoPA) document completed.
- [ ] **(All)** Data processing agreements signed with: hosting provider, MinIO provider (if cloud), any managed LLM provider (if enabled), any third-party KYC provider.

### 11.3 Consent mechanics

- [ ] **(All)** Consent UI reviewed by legal: granular, no dark patterns, no pre-ticked boxes, withdrawal as easy as grant.
- [ ] **(All)** Consent records stored and retrievable as evidence.
- [ ] **(India)** Consent for Aadhaar processing complies with Aadhaar (Targeted Delivery) Act and UIDAI guidelines; confirm whether UIDAI authentication API is required vs. self-service OCR.

### 11.4 Data-subject rights

- [ ] **(All)** Data export endpoint tested end-to-end; output reviewed to confirm completeness.
- [ ] **(All)** Deletion pipeline tested: soft-delete, 30-day purge, document lifecycle rule, anonymisation of audit/consent records.
- [ ] **(All)** Support process in place for manual rights requests (access, correction, objection).
- [ ] **(All)** Response SLAs documented and operationally achievable.

### 11.5 Security controls

- [ ] **(All)** Penetration test completed on API, authentication, and document storage endpoints.
- [ ] **(All)** OWASP API Security Top 10 review completed.
- [ ] **(All)** MinIO bucket access policy audited; confirmed no public buckets.
- [ ] **(All)** Encryption at rest confirmed enabled on all document buckets and ID-number columns.
- [ ] **(All)** TLS 1.2+ enforced on all endpoints; TLS certificate auto-renewal in place.
- [ ] **(All)** Audit log retention configured and tested (2-year minimum).
- [ ] **(All)** Brute-force protection tested; lockout behaviour confirmed.

### 11.6 AI / LLM

- [ ] **(All)** Ollama (self-hosted) confirmed as default; no managed LLM enabled in production without pre-flight checklist (§6.3).
- [ ] **(All)** If managed LLM enabled: DPA with provider signed, training opt-out confirmed, cross-border transfer mechanism in place.

### 11.7 Retention and lifecycle

- [ ] **(All)** Retention policy published in Privacy Policy.
- [ ] **(All)** MinIO lifecycle rules configured and tested for deletion-triggered expiry.
- [ ] **(All)** Nightly purge job tested in staging with real soft-deleted records.
- [ ] **(All)** Backup and disaster-recovery procedure documented and tested.

### 11.8 Privacy policy and notices

- [ ] **(All)** Privacy Policy reviewed by legal; covers: what is collected, why, how long, with whom shared, subject rights, sensitive attributes disclosed.
- [ ] **(All)** Cookie / session policy covers JWT cookies.
- [ ] **(India)** Privacy Policy available in relevant Indian languages if required by DPDP Act guidelines.
