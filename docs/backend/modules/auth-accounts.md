# Auth & Accounts Module

> **Status:** Draft v0.1 · **Phase:** 0 (shell) → 1 (full) · **Owner area:** backend
> **Related:** [architecture/04-api-contracts.md](../../architecture/04-api-contracts.md) · [architecture/05-security-privacy.md](../../architecture/05-security-privacy.md) · [modules/profiles.md](./profiles.md) · [architecture/02-data-model.md](../../architecture/02-data-model.md)

This module owns every identity concern in Stabil: user registration with role selection, credential management, JWT access- and refresh-token issuance and rotation, session lifecycle, email verification, password reset, logout, and the NestJS guards that enforce role-based access control across all other modules. It is the prerequisite for every other module — nothing else runs until a principal is authenticated and its role claims are established.

---

## 1. Responsibility

One bounded purpose: **authenticate a principal and assert its role**. Concretely:

- Register an account and assign a role (`candidate`, `employer`, `recruiter`; `admin` is out-of-band only).
- Validate credentials and issue a short-lived **access token** + a long-lived, rotating **refresh token**.
- Rotate refresh tokens on every use and detect token reuse (theft detection).
- Verify email addresses (Phase 1) and support secure password reset (Phase 1).
- Revoke sessions on logout and on account deletion.
- Expose `JwtAuthGuard`, `RolesGuard`, `@Roles(...)`, and `@Public()` for the rest of the API.

Everything downstream of authentication — profiles, scoring, sharing, verification — delegates to this module for who-is-this and what-role-do-they-have.

---

## 2. Public API

All endpoints live under `/api/v1`. Error shapes follow RFC 9457 `application/problem+json` (see [architecture/04-api-contracts.md §1.5](../../architecture/04-api-contracts.md)). Auth endpoints are rate-limited to **10 requests / 60 s / IP** (`auth` bucket).

### 2.1 DTO types

Zod schemas live in `packages/contracts/src/auth.ts`; the TypeScript types below are `z.infer<...>`:

```ts
// packages/contracts/src/auth.ts

export const RegisterRequestSchema = z.object({
  email:            z.string().email(),
  password:         z.string().min(10).max(128),
  displayName:      z.string().min(1).max(120).trim(),
  role:             z.enum(["candidate", "employer", "recruiter"]), // "admin" is never self-served
  organizationName: z.string().min(1).max(200).optional(), // required when role ∈ {employer, recruiter}
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().optional(), // omit on web (cookie carries it)
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

export const UpdateAccountRequestSchema = z.object({
  displayName:      z.string().min(1).max(120).trim().optional(),
  organizationName: z.string().min(1).max(200).optional(), // employer/recruiter only
});
export type UpdateAccountRequest = z.infer<typeof UpdateAccountRequestSchema>;

export const RequestPasswordResetSchema = z.object({
  email: z.string().email(),
});

export const ResetPasswordSchema = z.object({
  token:       z.string().min(1),
  newPassword: z.string().min(10).max(128),
});

export const RequestDataDeletionSchema = z.object({
  confirmEmail: z.string().email(),
  reason:       z.string().max(500).optional(),
});
export type RequestDataDeletionRequest = z.infer<typeof RequestDataDeletionSchema>;

// Shared response types
export interface AuthResponse {
  user: {
    id:           string; // UUID v7
    email:        string;
    displayName:  string;
    role:         "candidate" | "employer" | "recruiter" | "admin";
  };
  accessToken:  string; // JWT, 15 min
  refreshToken: string; // JWT, 30 days — also set as HttpOnly cookie on web
  expiresIn:    number; // 900 (access token TTL in seconds)
}

export interface Account {
  id:               string;
  email:            string;
  displayName:      string;
  role:             "candidate" | "employer" | "recruiter" | "admin";
  organizationName: string | null;
  emailVerified:    boolean;
  createdAt:        string;
}

export interface RequestDataDeletionResponse {
  ticketId:   string;
  status:     "scheduled";
  purgeAfter: string; // ISO-8601 — end of 30-day grace window
}
```

### 2.2 Endpoint table

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| `POST` | `/auth/register` | `@Public()` | — | Register account + issue tokens |
| `POST` | `/auth/login` | `@Public()` | — | Authenticate + issue tokens |
| `POST` | `/auth/refresh` | `@Public()` | — | Rotate refresh → new access+refresh pair |
| `POST` | `/auth/logout` | Bearer access token | any | Revoke session |
| `GET`  | `/auth/verify-email` | `@Public()` | — | Verify email via token in link |
| `POST` | `/auth/request-password-reset` | `@Public()` | — | Send reset email |
| `POST` | `/auth/reset-password` | `@Public()` | — | Apply new password via reset token |
| `GET`  | `/account` | Bearer | any | Get my account details |
| `PATCH` | `/account` | Bearer | any | Update display name / org name |
| `POST` | `/account/request-data-deletion` | Bearer | any | Schedule account + data purge |

### 2.3 Endpoint specifications

#### `POST /auth/register`

Creates a `User`, the matching `Role` row, an `AuthIdentity` (`provider = "password"`, `passwordHash` = argon2id hash), and immediately issues an access + refresh token pair. `admin` cannot self-register — that role is seeded or manually assigned.

- **Body:** `RegisterRequest`
- **Response:** `201 AuthResponse`
- **Errors:**
  - `409 conflict` — email already in use
  - `422 validation-failed` — Zod errors (e.g. password too short, missing `organizationName` for employer)
- **Side-effect (Phase 1):** enqueues an email-verification notification.

```json
// POST /api/v1/auth/register
{
  "email": "asha@example.com",
  "password": "correct-horse-battery",
  "displayName": "Asha R",
  "role": "candidate"
}
// 201 Created
{
  "user": { "id": "0190a1...", "email": "asha@example.com", "displayName": "Asha R", "role": "candidate" },
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "expiresIn": 900
}
```

#### `POST /auth/login`

Looks up the `AuthIdentity` for `provider = "password"` / `providerUid = email`, verifies the password with argon2id, and issues tokens. On failure the response is **identical** for unknown email and wrong password (no user enumeration).

- **Body:** `LoginRequest`
- **Response:** `200 AuthResponse`
- **Errors:**
  - `401 unauthenticated` — bad credentials (generic, no enumeration)
  - `422 validation-failed`
- **Lockout:** after 5 consecutive failures for the same email the account is locked for 15 minutes; a Redis or DB counter tracks streaks (see [Security §4](#4-security-and-permissions)).

#### `POST /auth/refresh`

Exchanges a valid, unconsumed refresh token for a fresh access + refresh pair. The submitted token's `Session` row is **immediately marked `revokedAt = now()`** and a new `Session` row is inserted. If the incoming token's `Session.revokedAt` is already set, the **entire token family** (`Session` rows sharing the same `userId`) is revoked and `401 token-reuse-detected` is returned (see [Security §4.3](#43-refresh-token-rotation-and-reuse-detection)).

- **Body (mobile):** `RefreshRequest` — pass `refreshToken` in JSON body.
- **Body (web):** empty `{}` — the `HttpOnly` cookie is read automatically.
- **Response:** `200 AuthResponse`
- **Errors:**
  - `401 unauthenticated` — token expired, malformed, or signature invalid
  - `401 token-reuse-detected` — family revoked due to replay

#### `POST /auth/logout`

Revokes the refresh token (and its associated `Session` row) and clears the web `HttpOnly` cookie. The access token cannot be actively revoked (it expires naturally in ≤ 15 min); rely on the access token's short lifetime.

- **Body:** `LogoutRequest`
- **Response:** `204 No Content`
- **Errors:** `401 unauthenticated`

#### `GET /auth/verify-email?token=<otp>`

Phase 1. Verifies the one-time URL token e-mailed at registration. Sets `User.emailVerifiedAt` and deletes the `EmailVerification` record.

- **Auth:** `@Public()`
- **Response:** `200 { "message": "Email verified." }`
- **Errors:**
  - `404 not-found` — unknown or already-used token
  - `410 share-expired` — token TTL (24 h) elapsed

#### `POST /auth/request-password-reset`

Phase 1. Generates a secure 32-byte random reset token (hex-encoded), stores its hash in `PasswordResetToken` with `expiresAt = now() + 1 h`, and enqueues a reset-link email. Returns **the same response** regardless of whether the email is known (no user enumeration).

- **Body:** `{ email: string }`
- **Response:** `202 { "message": "If that email is registered, a reset link has been sent." }`
- **Side-effect:** emits a `password-reset-requested` notification event.

#### `POST /auth/reset-password`

Phase 1. Looks up the `PasswordResetToken` by hash, verifies it is unexpired and unused, hashes the new password with argon2id, updates `AuthIdentity.passwordHash`, marks the token used, and revokes all `Session` rows for the user (force re-login everywhere).

- **Body:** `ResetPasswordSchema`
- **Response:** `200 { "message": "Password updated. Please log in again." }`
- **Errors:**
  - `404 not-found` — token unknown
  - `410 share-expired` — token TTL elapsed
  - `422 validation-failed`

#### `GET /account`

Returns the caller's `Account` record.

- **Auth:** Bearer access token · **Roles:** any
- **Response:** `200 Account`

#### `PATCH /account`

Updates `User.fullName` (`displayName`) and, for employer/recruiter users, `EmployerOrg.name` or `RecruiterOrg.name` (`organizationName`). Candidates attempting to set `organizationName` receive `403`.

- **Body:** `UpdateAccountRequest`
- **Response:** `200 Account`
- **Errors:** `403 forbidden`, `422 validation-failed`

#### `POST /account/request-data-deletion`

Sets `User.deletedAt = now()` (soft-delete), revokes all `Session` rows, revokes all active `ShareGrant` records, and schedules a background purge job to run after a 30-day grace window. See [architecture/05-security-privacy.md §4.4](../../architecture/05-security-privacy.md) for the full deletion pipeline.

- **Body:** `RequestDataDeletionRequest` — `confirmEmail` must match `req.user.email`
- **Response:** `202 RequestDataDeletionResponse`
- **Errors:**
  - `403 forbidden` — `confirmEmail` mismatch
  - `409 conflict` — deletion already scheduled
  - `422 validation-failed`

---

## 3. Data Models Touched

This module reads and writes the four identity-layer models. All other Prisma models (profiles, score runs, documents, etc.) are touched only by their respective modules.

### 3.1 `User`

The account record. Every authenticated principal maps to exactly one `User` row.

```prisma
// packages/db/prisma/schema.prisma (§4.3 in 02-data-model.md)
model User {
  id             String   @id @db.Uuid           // UUID v7 (app-generated)
  email          String   @unique
  fullName       String?                          // displayName
  employerOrgId  String?  @db.Uuid
  recruiterOrgId String?  @db.Uuid
  employerOrg    EmployerOrg?  @relation(...)
  recruiterOrg   RecruiterOrg? @relation(...)

  roles          Role[]
  authIdentities AuthIdentity[]
  sessions       Session[]

  // Phase 1 additions (not in Phase 0 shell)
  emailVerifiedAt DateTime?
  loginFailCount  Int       @default(0)
  lockedUntil     DateTime?

  ownedProfiles     CandidateProfile[] @relation("ProfileOwner")
  submittedProfiles CandidateProfile[] @relation("ProfileSubmitter")
  notifications     Notification[]
  auditLogs         AuditLog[]          @relation("AuditActor")

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime? // soft-delete (SCOPE §19)

  @@index([email])
  @@index([deletedAt])
  @@index([lockedUntil])
}
```

### 3.2 `Role`

A thin join-table holding a user's named role. A user holds at most **one** role in the current model (the schema enforces `@@unique([userId, name])` so the guard can trust the first Role row). Admin accounts are seeded via a Prisma migration seed or a one-shot script — never via the registration endpoint.

```prisma
model Role {
  id     String   @id @db.Uuid
  userId String   @db.Uuid
  user   User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name   RoleName // candidate | employer | recruiter | admin

  createdAt DateTime @default(now())

  @@unique([userId, name])
  @@index([name])
}
```

### 3.3 `AuthIdentity`

Holds the actual credential. `provider = "password"` for email/password accounts; a future OAuth provider (e.g. `"google"`) would add a second row per user with a null `passwordHash`. This design lets a user eventually link multiple providers without changing `User`.

```prisma
model AuthIdentity {
  id           String  @id @db.Uuid
  userId       String  @db.Uuid
  user         User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider     String  // "password" | "google" | ...
  providerUid  String  // email (password) or OAuth subject ID
  passwordHash String? // argon2id hash; null for OAuth identities

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([provider, providerUid])
  @@index([userId])
}
```

### 3.4 `Session`

Tracks every live refresh token as a server-side session row. The raw refresh token **never** touches the database — only its SHA-256 hash is stored. On logout or reuse detection, `revokedAt` is set; the purge job removes expired/revoked rows periodically.

```prisma
model Session {
  id          String    @id @db.Uuid
  userId      String    @db.Uuid
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshHash String    // SHA-256(rawRefreshToken), hex
  family      String    @db.Uuid // token-family id; all sessions in a refresh chain share one family
  userAgent   String?
  ip          String?
  expiresAt   DateTime
  revokedAt   DateTime?

  createdAt DateTime @default(now())

  @@index([userId])
  @@index([refreshHash])
  @@index([expiresAt])
  @@index([family])
}
```

> **`family` column:** each initial login creates a new random `family` UUID. Every rotation inherits the same `family`. Reuse detection calls `UPDATE Session SET revokedAt = now() WHERE userId = ? AND family = ?` — this atomically terminates every token in the compromised chain.

### 3.5 Phase-1 supplementary models

```prisma
// One row per pending email verification. Deleted on success.
model EmailVerification {
  id        String   @id @db.Uuid
  userId    String   @db.Uuid @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   // SHA-256 of the URL token
  expiresAt DateTime

  createdAt DateTime @default(now())

  @@index([tokenHash])
}

// One row per pending password reset. Single-use; deleted on success.
model PasswordResetToken {
  id        String   @id @db.Uuid
  userId    String   @db.Uuid
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique // SHA-256 of the URL token
  usedAt    DateTime?
  expiresAt DateTime

  createdAt DateTime @default(now())

  @@index([tokenHash])
  @@index([userId])
}
```

---

## 4. Dependencies

| Dependency | Purpose |
|------------|---------|
| `@nestjs/jwt` | Sign and verify JWTs (HS256 in Phase 0; consider RS256 in production hardening). |
| `@nestjs/passport` + `passport-jwt` | `JwtStrategy` extracts and validates Bearer tokens. |
| `argon2` (npm: `argon2`) | Password hashing and verification (argon2id). |
| `packages/contracts` | Shared Zod schemas for request/response DTOs. |
| `packages/db` | Prisma client for `User`, `Role`, `AuthIdentity`, `Session`, `EmailVerification`, `PasswordResetToken`. |
| `notifications` module | Enqueues email-verification and password-reset emails. |
| `ThrottlerModule` (NestJS) | Per-IP rate limiting on auth endpoints. |
| Redis (Phase 1 lock store) | Stores login-failure counters and lockout state. Falls back to in-process cache in dev. |

---

## 5. Key Flows (Mermaid Sequence Diagrams)

### 5.1 Login + initial token issuance

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant API as AuthController
    participant AuthSvc as AuthService
    participant DB as PostgreSQL (Prisma)

    Client->>API: POST /auth/login { email, password }
    API->>AuthSvc: login(email, password)
    AuthSvc->>DB: findAuthIdentity(provider="password", providerUid=email)
    DB-->>AuthSvc: AuthIdentity | null

    alt identity not found
        AuthSvc-->>API: UnauthorizedException (generic)
        API-->>Client: 401 unauthenticated
    else identity found
        AuthSvc->>AuthSvc: argon2.verify(passwordHash, password)
        alt password wrong
            AuthSvc->>DB: incrementLoginFailCount(userId)
            note over DB: lock if count >= 5
            AuthSvc-->>API: UnauthorizedException (generic)
            API-->>Client: 401 unauthenticated
        else password correct
            AuthSvc->>DB: resetLoginFailCount(userId)
            AuthSvc->>AuthSvc: buildAccessClaims(user, role)
            AuthSvc->>AuthSvc: jwtService.sign(claims, { expiresIn: "15m" })
            AuthSvc->>AuthSvc: generateRefreshToken() → rawToken + jti
            AuthSvc->>AuthSvc: sha256(rawToken) → refreshHash
            AuthSvc->>DB: Session.create({ userId, refreshHash, family=newUUID, expiresAt=+30d })
            AuthSvc-->>API: AuthResponse
            API->>Client: Set-Cookie: refreshToken=...; HttpOnly; Secure; SameSite=Strict
            API-->>Client: 200 AuthResponse
        end
    end
```

### 5.2 Refresh token rotation

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant API as AuthController
    participant AuthSvc as AuthService
    participant DB as PostgreSQL (Prisma)

    Client->>API: POST /auth/refresh { refreshToken? } (or HttpOnly cookie)
    API->>AuthSvc: refresh(rawToken)
    AuthSvc->>AuthSvc: jwtService.verify(rawToken) → claims (sub, jti, family)
    AuthSvc->>AuthSvc: sha256(rawToken) → incomingHash
    AuthSvc->>DB: Session.findOne({ refreshHash: incomingHash })
    DB-->>AuthSvc: Session | null

    alt session not found / expired / signature invalid
        AuthSvc-->>API: UnauthorizedException
        API-->>Client: 401 unauthenticated
    else session.revokedAt is set (token already consumed)
        note over AuthSvc: Token reuse detected — potential theft
        AuthSvc->>DB: Session.updateMany({ userId, family }, { revokedAt: now() })
        note over DB: All sessions in family revoked → user forced to re-login
        AuthSvc-->>API: UnauthorizedException(type="token-reuse-detected")
        API-->>Client: 401 token-reuse-detected
    else session valid and not revoked
        AuthSvc->>DB: Session.update(id, { revokedAt: now() })
        note over DB: Old session immediately invalidated
        AuthSvc->>AuthSvc: build new access claims + new raw refresh token
        AuthSvc->>AuthSvc: sha256(newRawToken) → newHash
        AuthSvc->>DB: Session.create({ userId, refreshHash: newHash, family: same, expiresAt: +30d })
        AuthSvc-->>API: AuthResponse (new pair)
        API->>Client: Set-Cookie: refreshToken=<new>; HttpOnly; Secure; SameSite=Strict
        API-->>Client: 200 AuthResponse
    end
```

---

## 6. JWT Token Design

### 6.1 Access token (`AccessClaims`)

```ts
// apps/api/src/auth/types/access-claims.ts
export interface AccessClaims {
  sub:   string;   // userId (UUID v7)
  role:  "candidate" | "employer" | "recruiter" | "admin";
  email: string;
  jti:   string;   // random UUID — token id (for future server-side blocklist if needed)
  iat:   number;
  exp:   number;   // iat + 900 (15 min)
}
```

**Algorithm:** HS256 in Phase 0 (single API instance; shared secret via `JWT_SECRET` env). Switch to RS256 (asymmetric; public key published for clients) before multi-instance production deployment.

**Lifetime:** 15 minutes. Clients must call `/auth/refresh` before expiry. Access tokens are **not** stored server-side and cannot be actively revoked; the 15-minute window limits the blast radius of a stolen access token.

### 6.2 Refresh token

The refresh token is a **signed JWT** (same algorithm as the access token) carrying:

```ts
export interface RefreshClaims {
  sub:    string;   // userId
  jti:    string;   // token instance id
  family: string;   // UUID shared by all rotations in one login session
  iat:    number;
  exp:    number;   // iat + 30 days
}
```

The JWT signature lets the API quickly reject tokens with a wrong secret (no DB hit needed for invalid tokens). Only after signature validation is the `SHA-256(rawToken)` looked up in `Session` to confirm it has not been consumed.

**Client storage:**
| Client | Storage |
|--------|---------|
| Web (Next.js) | `HttpOnly; Secure; SameSite=Strict` cookie — inaccessible to JavaScript |
| Mobile (Expo) | `expo-secure-store` (encrypted native keychain) |
| Access token (both) | In-memory only — never persisted to localStorage or AsyncStorage |

---

## 7. Password Hashing (argon2id)

All password hashing uses **argon2id** via the `argon2` npm package. Configuration matches the recommendation in [architecture/05-security-privacy.md §7.1](../../architecture/05-security-privacy.md):

```ts
// apps/api/src/auth/auth.service.ts
import argon2 from "argon2";

const ARGON2_OPTIONS: argon2.Options = {
  type:         argon2.argon2id,
  memoryCost:   65536,  // 64 MiB
  timeCost:     3,      // iterations
  parallelism:  1,
  hashLength:   32,     // bytes
};

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
  // argon2 auto-generates a 16-byte cryptographically random salt and encodes it in the output string.
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
```

Plain-text passwords are **never logged**, never stored, and never leave the TLS boundary.

---

## 8. NestJS Guards and Decorators

This module provides the guards consumed by every other controller in the API. They are registered globally in `AppModule`.

### 8.1 `JwtAuthGuard`

A global guard (applied via `APP_GUARD` provider) that calls `JwtStrategy.validate()` on every incoming request. Requests to routes decorated with `@Public()` are exempt.

```ts
// apps/api/src/auth/guards/jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  canActivate(context: ExecutionContext) {
    // Skip JWT check for @Public() routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

`JwtStrategy.validate()` decodes and verifies the Bearer token, looks up the `User` (optionally, or trusts claims), and attaches `req.user: AccessClaims`.

### 8.2 `RolesGuard`

Applied after `JwtAuthGuard`. Reads the `@Roles(...)` metadata from the handler and compares it against `req.user.role`.

```ts
// apps/api/src/auth/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true; // no restriction

    const { user } = context.switchToHttp().getRequest<{ user: AccessClaims }>();
    if (!required.includes(user.role as RoleName)) {
      throw new ForbiddenException("Insufficient role.");
    }
    return true;
  }
}
```

### 8.3 `@Roles(...)` decorator

```ts
// apps/api/src/auth/decorators/roles.decorator.ts
export const ROLES_KEY = "roles";
export const Roles = (...roles: RoleName[]) => SetMetadata(ROLES_KEY, roles);
```

Usage in any controller:

```ts
@Get("some-endpoint")
@Roles("admin", "recruiter")
findAllCandidates() { ... }
```

### 8.4 `@Public()` decorator

```ts
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

Applied to all auth endpoints (register, login, refresh, verify-email, password-reset). Without it, the global `JwtAuthGuard` would reject them.

### 8.5 `CurrentUser` parameter decorator

```ts
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessClaims => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

Usage: `@Get("account") getAccount(@CurrentUser() user: AccessClaims) { ... }`.

---

## 9. Validation & Errors

All request validation is performed by the global Zod validation pipe. The module emits the following problem types (RFC 9457 `application/problem+json`). See [architecture/04-api-contracts.md §1.5](../../architecture/04-api-contracts.md) for the full ProblemDetails shape.

| Problem type slug | HTTP status | Trigger |
|-------------------|-------------|---------|
| `validation-failed` | 422 | Zod schema violation (email invalid, password too short, missing `organizationName`) |
| `conflict` | 409 | Email already registered |
| `unauthenticated` | 401 | Bad credentials, expired token, invalid token signature |
| `token-reuse-detected` | 401 | Replay of a consumed refresh token → family revoked |
| `forbidden` | 403 | Wrong role (`RolesGuard`), or `confirmEmail` mismatch in deletion request |
| `not-found` | 404 | Unknown email-verification or password-reset token |
| `share-expired` | 410 | Email-verification or password-reset token TTL elapsed |
| `conflict` | 409 | Data deletion already scheduled |
| `rate-limited` | 429 | `auth` rate-limit bucket exceeded (10 req / 60 s / IP) |

**No user enumeration:** `POST /auth/login`, `POST /auth/request-password-reset` always return the same response shape for a valid-format email that does or does not exist in the database. The 401 on login is generic ("Invalid credentials.") with no indication of whether the email was found.

**Field-level errors example (422):**

```json
{
  "type": "https://stabil.app/problems/validation-failed",
  "title": "Request validation failed",
  "status": 422,
  "detail": "2 fields are invalid.",
  "instance": "/api/v1/auth/register",
  "requestId": "req_01HZ...",
  "errors": [
    { "path": "password", "message": "String must contain at least 10 character(s)", "code": "too_small" },
    { "path": "organizationName", "message": "Required", "code": "invalid_type" }
  ]
}
```

---

## 10. Security & Permissions

### 10.1 Role assignment rules

| Role | How obtained |
|------|-------------|
| `candidate` | Self-registration via `POST /auth/register` |
| `employer` | Self-registration with `organizationName`; creates / joins an `EmployerOrg` |
| `recruiter` | Self-registration with `organizationName`; creates / joins a `RecruiterOrg` |
| `admin` | Out-of-band only (Prisma seed script or manual DB insert); never via the API |

A user holds exactly one role (enforced by the `@@unique([userId, name])` constraint on `Role` and by the registration endpoint accepting only one `role` value).

### 10.2 Password hashing (argon2id)

See [§7](#7-password-hashing-argon2id). Configuration: 64 MiB memory, 3 iterations, parallelism 1, 32-byte output. Salt is auto-generated per hash. These settings are chosen to be computationally expensive for an offline attacker while remaining acceptable (< 500 ms) on typical server hardware.

### 10.3 Refresh token rotation and reuse detection

Every call to `POST /auth/refresh` **atomically** marks the incoming `Session` row as revoked and inserts a new one. This guarantees:

1. **Single use:** a legitimate client consumes the token immediately; re-presenting it (e.g. from a stolen cookie) is detected.
2. **Reuse = theft signal:** if a revoked token is submitted, the entire token family (all `Session` rows sharing `family = X`) is revoked. Both the legitimate user and the attacker are forced to re-authenticate. An `AuditLog` event `refresh-token.reuse-detected` is written with the IP and user agent (see [architecture/05-security-privacy.md §9.2](../../architecture/05-security-privacy.md)).

The `family` column makes family-wide revocation a single indexed `UPDATE` with no table scan.

### 10.4 Brute-force and account lockout

The login endpoint maintains a per-email failure counter (`User.loginFailCount`, `User.lockedUntil`):

| Threshold | Effect |
|-----------|--------|
| 1–4 failures | Counter incremented; login returns `401 unauthenticated` |
| 5 failures | `lockedUntil = now() + 15 min`; subsequent login attempts on that account return `401 unauthenticated` without running `argon2.verify` (prevents timing oracle) |
| Successful login | Counter reset to 0, `lockedUntil` cleared |

The rate-limit ThrottlerModule (10 req / 60 s / IP) acts as an independent outer layer — it fires before any DB access.

### 10.5 HttpOnly cookie (web)

On web clients, the refresh token is delivered as a `Set-Cookie` header with `HttpOnly; Secure; SameSite=Strict` attributes. This makes the token inaccessible to JavaScript running on the page, which eliminates the most common XSS-based token theft vector. The mobile client (Expo) stores both tokens in `expo-secure-store`.

### 10.6 Admin actions

Admin accounts can revoke all sessions for any user (incident response). There is no registration path for `admin` — the role is inserted via a seeded Prisma migration or an offline script. Admin actions on sessions are audit-logged (`account.session-revoked-by-admin`).

### 10.7 Deletion and session invalidation

`POST /account/request-data-deletion` immediately sets `User.deletedAt` and bulk-revokes all `Session` rows before the 202 response is sent. The next access-token validation checks `User.deletedAt` — if set, the request is rejected with `401 unauthenticated` even within the 15-minute access token window. This is the one case where the access token TTL does not bound revocation.

---

## 11. Phased Implementation

### Phase 0 — Foundation shell

Deliverables: a working auth layer sufficient for all Phase 1 development to proceed.

**Checklist:**
- [ ] `AuthModule` bootstrapped in NestJS; `JwtAuthGuard` registered globally via `APP_GUARD`.
- [ ] `RolesGuard` registered globally via `APP_GUARD` after `JwtAuthGuard`.
- [ ] `@Roles(...)`, `@Public()`, and `@CurrentUser()` decorators in `apps/api/src/auth/decorators/`.
- [ ] `JwtStrategy` (passport-jwt) reads `Authorization: Bearer` header; `validate()` returns `AccessClaims`.
- [ ] `POST /auth/register` — creates `User`, `Role`, `AuthIdentity` (argon2id hash), `Session`; returns `AuthResponse`.
- [ ] `POST /auth/login` — verifies argon2id hash, issues tokens, inserts `Session` row.
- [ ] `POST /auth/refresh` — rotates refresh token with family-scoped reuse detection.
- [ ] `POST /auth/logout` — revokes `Session` row, clears web cookie.
- [ ] `GET /account`, `PATCH /account` — account read/update.
- [ ] `POST /account/request-data-deletion` — soft-delete + session revocation + 30-day purge scheduling.
- [ ] Prisma models: `User`, `Role`, `AuthIdentity`, `Session` (with `family` column).
- [ ] Rate limiting via `ThrottlerModule` on `auth` endpoints (10 / 60 s / IP).
- [ ] Login failure counter + 15-minute lockout logic (`User.loginFailCount`, `User.lockedUntil`).
- [ ] Unit tests: registration, login (success/failure/lockout), refresh rotation, reuse detection, logout.
- [ ] Integration test: `POST /auth/register → GET /account` happy path.

**Out of scope for Phase 0:** email verification, password reset, email delivery.

### Phase 1 — Full authentication (core scoring release)

Deliverables: complete authentication including email verification and password reset.

**Checklist:**
- [ ] `POST /auth/verify-email?token=` — verify token hash, set `User.emailVerifiedAt`, delete `EmailVerification` row.
- [ ] `POST /auth/request-password-reset` — generate 32-byte random token, store hash in `PasswordResetToken`, enqueue reset email via Notifications module.
- [ ] `POST /auth/reset-password` — verify token, hash new password, bulk-revoke sessions, delete `PasswordResetToken` row.
- [ ] Prisma models: `EmailVerification`, `PasswordResetToken`.
- [ ] Registration side-effect: emit `email-verification-requested` event to Notifications module.
- [ ] Access token validation checks `User.deletedAt`; if set → `401 unauthenticated`.
- [ ] `User.emailVerified` included in `Account` response.
- [ ] Integration tests: full email-verification flow, password-reset flow (success, expired token, replayed token).
- [ ] E2E test (supertest): register → login → refresh → logout cycle.

---

## 12. Testing

### 12.1 Unit tests (`Vitest`)

Location: `apps/api/src/auth/__tests__/auth.service.spec.ts`

| Test case | What it asserts |
|-----------|----------------|
| `hashPassword` | Output is a valid argon2id string; `verifyPassword` returns `true` for the same plain text and `false` for a different one. |
| `login` — success | Returns `AuthResponse`; a `Session` row is inserted; `loginFailCount` is reset. |
| `login` — wrong password | Throws `UnauthorizedException`; `loginFailCount` incremented. |
| `login` — lockout (5th failure) | `User.lockedUntil` set; subsequent call within lock window returns `401` without calling `argon2.verify`. |
| `refresh` — valid | Old `Session.revokedAt` is set; new `Session` inserted with same `family`; new `AuthResponse` returned. |
| `refresh` — consumed token (reuse) | All sessions with same `family` revoked; throws `UnauthorizedException(type="token-reuse-detected")`. |
| `refresh` — expired JWT | `jwtService.verify` throws; `UnauthorizedException` propagated. |
| `logout` | `Session.revokedAt` set; `200 AuthResponse` is not accessible after logout with the old refresh token. |
| `register` — duplicate email | Throws `ConflictException`. |
| `register` — employer without organizationName | Zod pipe catches it; `422` with `errors[0].path = "organizationName"`. |
| `requestDataDeletion` — confirmEmail mismatch | Throws `ForbiddenException`. |

### 12.2 Guard unit tests

Location: `apps/api/src/auth/__tests__/guards/`

| Guard | Test cases |
|-------|-----------|
| `JwtAuthGuard` | Public route bypasses guard; missing Bearer → 401; expired token → 401; valid token → attaches `req.user`. |
| `RolesGuard` | No `@Roles` → passes; matching role → passes; non-matching role → 403; admin role → passes for any `@Roles(...)`. |

### 12.3 Integration / E2E tests (supertest)

Location: `apps/api/test/auth.e2e-spec.ts`

| Scenario | Assertions |
|----------|-----------|
| Full register → login → GET /account cycle | 201 register, 200 login, 200 account with correct fields. |
| Refresh rotation | Second POST /auth/refresh with the first (now consumed) refresh token → 401 token-reuse-detected. |
| Protected route without token | 401. |
| Protected route with wrong role | 403 (e.g. candidate hitting a recruiter-only route). |
| Rate limit | 11th login in 60 s from same IP → 429. |
| Phase 1: email-verify happy path | register → extract token from `EmailVerification` → GET /auth/verify-email → `User.emailVerifiedAt` set. |
| Phase 1: password-reset happy path | request-reset → read `PasswordResetToken` from DB → reset-password → old sessions revoked → login with new password succeeds. |

### 12.4 Security regression tests

- Candidate cannot access recruiter-only endpoint (403).
- Employer cannot access report without consent (tested in consent-sharing module, but auth guard is the first check).
- `POST /auth/register` with `role = "admin"` in the body returns `422` (admin is not in the allowed enum).
- Access token for a soft-deleted user is rejected with 401 on any protected route.
- Refresh token belonging to a different user (signed with a valid secret but wrong `sub`) is rejected.

---

## 13. Best Practices & Gotchas

### Never store raw tokens

Only `SHA-256(rawToken)` is stored in `Session.refreshHash`. The raw refresh token string is assembled in memory, returned in the `AuthResponse`, set as a cookie, and never written to disk or a log. This means a DB breach of the `Session` table does not yield usable tokens.

### Lockout counter and race conditions

`User.loginFailCount` is incremented with a Prisma `update` — this is a point-in-time read-modify-write. For very high-traffic scenarios, use an atomic Redis `INCR` with a TTL instead. The DB-based approach is acceptable for Phase 0/1 volumes.

### Cookie vs. body transport

Web and mobile have different transport. `AuthService.issueTokens()` always returns both tokens in the JSON body; `AuthController` additionally sets the cookie when the request comes from a web context (detected by `User-Agent` or a `X-Client: web` header). Mobile clients read from the JSON body and store in SecureStore. Maintain this distinction carefully — do not strip the body token for web clients, because the Next.js SSR layer needs to read and relay it during hydration.

### Token clock skew

When validating access tokens, allow ≤ 30 s of clock skew (`clockTolerance: 30` in `passport-jwt` options). This prevents false 401s when the API and client clocks are slightly out of sync.

### `family` column migration

Adding the `family` column to `Session` is a Phase 0 migration. New sessions at registration/login generate `uuidv7()` for `family`. Existing sessions (if any) from before the migration can be given a random `family` via a one-time data migration script.

### OpenAPI doc coverage

The `AuthModule` must be tagged in Swagger with `@ApiTags("Auth")` and `@ApiSecurity("bearer")` on protected routes. The Zod-to-OpenAPI conversion handles request/response shapes automatically; add `@ApiCookieAuth()` for web-facing refresh endpoints. The generated spec is checked in CI (`GET /api/v1/openapi.json` shape must match `packages/contracts`).

### Cross-link: consent on profile access

Once authenticated, an employer or recruiter accessing a candidate's profile or report is further gated by `ConsentGuard` (see [architecture/05-security-privacy.md §3.4](../../architecture/05-security-privacy.md)). The auth module does not handle consent — it only asserts identity and role.

### Cross-link: profiles module

After registration, a `candidate` user should create a `CandidateProfile` before submitting answers or triggering a score run. See [modules/profiles.md](./profiles.md) for the profile lifecycle, claimable profile flow, and the employer-submission path.
