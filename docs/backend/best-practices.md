# Backend Best Practices

> **Status:** Draft v0.1 · **Phase:** cross-cutting · **Owner area:** backend
> **Related:** [architecture/05-security-privacy.md](../architecture/05-security-privacy.md) · [testing.md](./testing.md) · [api-conventions.md](./api-conventions.md) · [database-and-prisma.md](./database-and-prisma.md) · [architecture/04-api-contracts.md](../architecture/04-api-contracts.md) · [SCOPE.md](../SCOPE.md)

This document is the engineering standards reference for the Stabil NestJS API (`apps/api/`). It is not aspirational — every rule here is a hard requirement. When an implementation decision conflicts with this document, fix the implementation. When this document conflicts with [SCOPE.md](../SCOPE.md), SCOPE.md wins.

The sections map directly to the major risk areas for a platform that handles Aadhaar/PAN numbers, per-share consent records, employment-influencing scores, and Indian DPDP Act obligations.

---

## Table of Contents

1. [Security](#1-security)
2. [Error Handling](#2-error-handling)
3. [Logging](#3-logging)
4. [Configuration & Secrets](#4-configuration--secrets)
5. [Performance](#5-performance)
6. [Background Jobs](#6-background-jobs)
7. [Observability](#7-observability)
8. [Architecture Hygiene](#8-architecture-hygiene)

---

## 1. Security

> See [architecture/05-security-privacy.md](../architecture/05-security-privacy.md) for the full threat model, RBAC permission matrix, consent enforcement, and PII classification tiers. This section focuses on **implementation rules** that every module must follow.

### 1.1 HTTP Security Headers — Helmet

The API mounts `helmet()` globally in `main.ts`. Never remove or weaken it.

```typescript
// apps/api/src/main.ts
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // API returns JSON, not HTML — disable the MIME-sniff protection
      // override only if you add an HTML-serving route
      noSniff: true,
      xssFilter: true,
      hsts: {
        maxAge: 31536000,     // 1 year
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'no-referrer' },
      // Disable frameguard at this level; CSP frameAncestors: none covers it
      frameguard: false,
    }),
  );
}
```

**Do / Don't:**

| Do | Don't |
|----|-------|
| Mount `helmet()` before any route handler. | Remove or bypass helmet on specific routes. |
| Keep `hsts.maxAge` at 1 year or more. | Set `hsts: false` in any environment that runs behind TLS (all of them). |
| Add `frameAncestors: ["'none'"]` to CSP. | Set `contentSecurityPolicy: false`. |

### 1.2 CORS

CORS is configured strictly — only our own web origin is allowed. There is no wildcard `*`.

```typescript
// apps/api/src/main.ts
app.enableCors({
  origin: process.env.WEB_ORIGIN,          // e.g. https://stabil.app
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
  credentials: true,
  maxAge: 600,   // preflight cache: 10 minutes
});
```

`WEB_ORIGIN` is a required env var validated in the config schema (see [§4](#4-configuration--secrets)). In local dev, set it to `http://localhost:3000`; never set it to `*` in staging or production.

**Do / Don't:**

| Do | Don't |
|----|-------|
| Enumerate the exact origin from an env var. | Hard-code the origin string, or allow `*`. |
| Specify `allowedHeaders` explicitly. | Use `allowedHeaders: true` (reflects all headers). |
| Set `credentials: true` (needed for HttpOnly refresh-token cookie). | Remove `credentials: true` — the cookie rotation breaks. |

### 1.3 Rate Limiting

Every public or unauthenticated route and every mutation endpoint is rate-limited using `@nestjs/throttler`. Limits are tighter on auth routes because they are the highest-value brute-force target.

```typescript
// apps/api/src/app.module.ts
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        storage: new ThrottlerStorageRedisService(config.get('REDIS_URL')),
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 60 },
          { name: 'burst',   ttl:  1_000, limit:  5 },
        ],
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
```

Per-route overrides using `@Throttle({ name: 'auth', ttl: 60_000, limit: 10 })`:

| Endpoint | Limit |
|----------|-------|
| `POST /auth/login` | 10 req / 60 s per IP |
| `POST /auth/register` | 5 req / 60 s per IP |
| `POST /auth/refresh` | 20 req / 60 s per user |
| `POST /auth/password-reset` | 3 req / 60 s per IP |
| All other endpoints | 60 req / 60 s (global default) |

Use a Redis-backed throttler store in production so limits survive API restarts and work across multiple instances. See [architecture/05-security-privacy.md §7.3](../architecture/05-security-privacy.md) for account lockout behavior after failed logins.

**Do / Don't:**

| Do | Don't |
|----|-------|
| Use Redis-backed storage in staging/production. | Use the in-memory store beyond local dev (it resets on restart). |
| Respond with `429` + `Retry-After` header (Throttler does this automatically). | Swallow throttle errors silently. |
| Apply stricter limits on auth endpoints with `@Throttle`. | Trust that the global default is tight enough for login routes. |

### 1.4 Input Validation — Zod Everywhere

Every incoming HTTP body, query parameter, and path parameter is validated with a **Zod schema from `packages/contracts`** before the handler runs. The Zod pipe is registered globally.

```typescript
// apps/api/src/common/pipes/zod-validation.pipe.ts
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema, ZodError } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        type: 'https://stabil.app/problems/validation-error',
        title: 'Validation Error',
        status: 422,
        detail: 'Request body failed schema validation.',
        errors: result.error.flatten(),
      });
    }
    return result.data;
  }
}
```

Usage at the controller level:

```typescript
@Post('profiles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('candidate')
async createProfile(
  @Body(new ZodValidationPipe(CreateCandidateProfileSchema)) dto: CreateCandidateProfileDTO,
  @Req() req: AuthenticatedRequest,
) { ... }
```

- Schemas live in `packages/contracts/src/` and are imported by the API, web, and mobile clients. One source of truth.
- String fields that accept free text (e.g. names, resume text blobs) must have **max-length constraints** in the Zod schema. Unbounded strings are an injection/DoS vector.
- Enum fields must use `z.enum([...])`, not `z.string()`, so values outside the allowed set are rejected.

**Do / Don't:**

| Do | Don't |
|----|-------|
| Apply `ZodValidationPipe` to every `@Body()`, `@Query()`, and `@Param()`. | Skip validation on "internal" or "admin-only" endpoints. |
| Set `maxLength` on all free-text string fields. | Use `z.string()` alone for user-supplied text. |
| Return validation errors as RFC 9457 problem+json (see [§2](#2-error-handling)). | Return raw Zod error objects to the client. |
| Keep schemas in `packages/contracts` — never define them inline in a controller. | Duplicate a schema across the API and the frontend. |

### 1.5 Password Hashing — argon2id

See [architecture/05-security-privacy.md §7.1](../architecture/05-security-privacy.md) for the full parameter rationale. Implementation rule: the `AuthService` is the **only** code that calls `argon2`. Every other module receives a user object whose password field is already omitted by the Prisma select.

```typescript
// apps/api/src/modules/auth/auth.service.ts
import * as argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024,  // 64 MB
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

async hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

async verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain, ARGON2_OPTIONS);
}
```

The Prisma `User` model must never return the `passwordHash` column outside of `AuthService`. Use a `select` that excludes it everywhere else:

```typescript
const user = await this.prisma.user.findUniqueOrThrow({
  where: { id },
  select: {
    id: true, email: true, role: true, name: true, status: true,
    // passwordHash intentionally excluded
  },
});
```

### 1.6 JWT Access/Refresh Rotation

Full rotation mechanics are documented in [architecture/05-security-privacy.md §7.2](../architecture/05-security-privacy.md). Implementation rules:

- **Never** embed sensitive claims (Aadhaar, PAN, raw profile fields) in a JWT payload.
- Refresh tokens are stored as `SHA-256(token)` in the `RefreshToken` table — never the raw token value.
- The `jti` (JWT ID) claim is included in both token types so individual tokens can be revoked.
- On refresh-token reuse detection: revoke **all** tokens for that user (log out everywhere) and emit a `SECURITY_ALERT` log event at `error` level.

```typescript
// On reuse detection (the token's DB record is already revoked/consumed)
await this.prisma.refreshToken.updateMany({
  where: { userId, revokedAt: null },
  data: { revokedAt: new Date() },
});
this.logger.error({
  event: 'security.refresh_token_reuse_detected',
  userId,
  ip: req.ip,
});
throw new UnauthorizedException({ type: 'token-reuse-detected' });
```

### 1.7 IDOR Prevention — Always Scope Queries by Owner / Consent

Insecure Direct Object Reference (IDOR) is the highest-likelihood critical bug in this system. Every query that touches a resource owned by or related to a specific user **must** include that user's ID in the `where` clause.

**The rule:** a candidate may only read their own data. An employer/recruiter may only read data they hold an active `ConsentRecord` for. The `ConsentGuard` enforces the latter — see [architecture/05-security-privacy.md §3.4](../architecture/05-security-privacy.md).

```typescript
// CORRECT — ownership enforced in the query itself
async getScoreRun(id: string, requestorId: string): Promise<ScoreRun> {
  const run = await this.prisma.scoreRun.findUniqueOrThrow({
    where: { id, candidateId: requestorId },   // <-- scope by owner
  });
  return run;
}

// WRONG — fetches by ID alone, then checks ownership in application code
async getScoreRun(id: string, requestorId: string): Promise<ScoreRun> {
  const run = await this.prisma.scoreRun.findUniqueOrThrow({ where: { id } });
  if (run.candidateId !== requestorId) throw new ForbiddenException(); // race-prone
  return run;
}
```

The correct pattern combines the ownership check with the database lookup — a not-found row and an unauthorized row both return `404` (no information leakage about whether the resource exists for another user).

**Do / Don't:**

| Do | Don't |
|----|-------|
| Include `candidateId: req.user.id` (or equivalent) in every Prisma `where` for candidate-scoped resources. | Fetch by `id` alone and check ownership after the fact in service code. |
| Apply `ConsentGuard` on every employer/recruiter cross-candidate read before any DB access. | Check consent in the service layer after the data has already been loaded. |
| Return `404` for both "not found" and "found but not yours" cases. | Return `403` for unauthorized access to a resource — it leaks existence. |
| Use UUID v7 primary keys (time-sortable, unguessable) — enforced in [architecture/04-api-contracts.md §1.1](../architecture/04-api-contracts.md). | Use sequential integer IDs that can be guessed by incrementing. |

### 1.8 Sensitive-Attribute Visibility Enforcement

Age and marital status are scored but must never appear in any API response to a `candidate`-role request. The enforcement is three-layered — see [architecture/05-security-privacy.md §1.3](../architecture/05-security-privacy.md) for the full specification. The backend implementation rule:

- The `ReportsService.assembleReport()` function must filter `employer-only` parameters **before** constructing any DTO.
- A `SerializationInterceptor` provides a defence-in-depth second pass that strips any field marked with `@EmployerOnly()` decorator from responses to `candidate`-role sessions.
- Integration tests (see [testing.md](./testing.md)) must assert that `GET /api/v1/candidates/me/report` never includes `age` or `maritalStatus` keys in the response body, regardless of what parameters are in the `ScoreRunParameter` table.

---

## 2. Error Handling

### 2.1 The Cardinal Rule: No Silent Failures

Silent failures — catching an error and either doing nothing, returning `null`, or returning a misleading success — are **banned**. They cause data corruption, hide bugs, and make the system undebuggable.

```typescript
// BANNED — silently swallows a DB error and returns as if successful
async triggerScoreRun(candidateId: string) {
  try {
    await this.scoringService.compute(candidateId);
    return { ok: true };
  } catch (e) {
    return { ok: true };   // <-- catastrophically wrong
  }
}

// BANNED — misleading fallback
async getProfile(id: string) {
  try {
    return await this.prisma.candidateProfile.findUniqueOrThrow({ where: { id } });
  } catch {
    return {};   // <-- caller cannot tell "profile not found" from "profile found but empty"
  }
}
```

**The right pattern:** let errors propagate. If recovery is needed, recover explicitly — log what happened, then throw a typed domain error (see §2.2) or rethrow.

```typescript
// CORRECT — explicit recovery with a domain error
async getProfile(id: string, requestorId: string) {
  const profile = await this.prisma.candidateProfile.findUnique({
    where: { id, userId: requestorId },
  });
  if (!profile) {
    throw new ProfileNotFoundException(id);
  }
  return profile;
}
```

### 2.2 Typed Domain Errors → RFC 9457

Every module defines its own typed error classes that extend `HttpException`. The `GlobalExceptionFilter` maps them to [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` responses. Never throw generic `Error` or untyped `HttpException` from a service.

```typescript
// apps/api/src/common/errors/base.error.ts
import { HttpException } from '@nestjs/common';

export interface ProblemDetail {
  type: string;       // URI identifying the problem type
  title: string;      // human-readable, stable summary
  status: number;
  detail?: string;    // human-readable description of this specific occurrence
  instance?: string;  // URI identifying this specific occurrence
  [key: string]: unknown;
}

export class StabilHttpException extends HttpException {
  constructor(public readonly problem: ProblemDetail) {
    super(problem, problem.status);
  }
}
```

```typescript
// apps/api/src/modules/profiles/profiles.errors.ts
import { StabilHttpException } from '../../common/errors/base.error';

export class ProfileNotFoundException extends StabilHttpException {
  constructor(id: string) {
    super({
      type: 'https://stabil.app/problems/profile-not-found',
      title: 'Profile Not Found',
      status: 404,
      detail: `No candidate profile with id ${id} exists or you do not have access to it.`,
    });
  }
}

export class ProfileAlreadyExistsException extends StabilHttpException {
  constructor() {
    super({
      type: 'https://stabil.app/problems/profile-already-exists',
      title: 'Profile Already Exists',
      status: 409,
      detail: 'A profile for this user already exists.',
    });
  }
}
```

```typescript
// apps/api/src/common/filters/global-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res
        .status(status)
        .header('Content-Type', 'application/problem+json')
        .json(typeof body === 'object' ? body : { title: body, status });
      return;
    }

    // Unhandled / unexpected error — fail loudly
    this.logger.error({
      event: 'unhandled_exception',
      message: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
      requestId: req.headers['x-request-id'],
      path: req.path,
    });

    res
      .status(500)
      .header('Content-Type', 'application/problem+json')
      .json({
        type: 'https://stabil.app/problems/internal-error',
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred. The error has been logged.',
        instance: req.headers['x-request-id'],
      });
  }
}
```

Register the filter globally in `main.ts`:

```typescript
app.useGlobalFilters(new GlobalExceptionFilter());
```

**Do / Don't:**

| Do | Don't |
|----|-------|
| Define a typed error class per domain error in the module's `*.errors.ts` file. | Throw `new Error('something went wrong')` from a service. |
| Include `type` (a stable URI), `title`, and `status` in every problem+json response. | Return `{ error: true, message: '...' }` — that is not RFC 9457. |
| Log every unhandled exception with `error` level before sending a 500. | Return a 500 with no logging. |
| Propagate errors from Prisma (translate `PrismaClientKnownRequestError` P2025 → `NotFoundException`, etc.). | Let raw Prisma errors reach the client. |
| Use `findUniqueOrThrow` and `findFirstOrThrow` so Prisma throws when a row is expected. | Use `findUnique` and then check `if (!result)` — it is easy to miss. |

#### Prisma error translation

Translate Prisma errors at the repository / service boundary before they bubble up:

```typescript
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

function handlePrismaError(e: unknown, resourceName: string): never {
  if (e instanceof PrismaClientKnownRequestError) {
    switch (e.code) {
      case 'P2025':   // record not found
        throw new NotFoundException(`${resourceName} not found.`);
      case 'P2002':   // unique constraint violation
        throw new ConflictException(`${resourceName} already exists.`);
      case 'P2003':   // foreign key constraint
        throw new BadRequestException(`Related ${resourceName} does not exist.`);
    }
  }
  throw e;   // rethrow — let GlobalExceptionFilter handle it
}
```

---

## 3. Logging

### 3.1 Structured Logging with Pino

All logging uses **Pino** via `nestjs-pino`. Never use `console.log` in any production code path. Never use the default NestJS `Logger` for anything other than bootstrap messages.

```typescript
// apps/api/src/app.module.ts
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', 'info'),
          transport:
            config.get('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty' }
              : undefined,
          redact: {
            paths: [
              // HTTP request/response fields
              'req.headers.authorization',
              'req.headers.cookie',
              // PII fields in request bodies — see §3.2
              'req.body.password',
              'req.body.aadhaarNumber',
              'req.body.panNumber',
              'req.body.passportNumber',
              'req.body.dateOfBirth',
              'req.body.maritalStatus',
              'req.body.email',
              // Nested profile fields
              'req.body.profile.email',
              'req.body.profile.aadhaarNumber',
              'req.body.profile.panNumber',
            ],
            censor: '[REDACTED]',
          },
          serializers: {
            req(req) {
              return {
                id: req.id,
                method: req.method,
                url: req.url,
                // Do NOT include req.body in the serializer — body is logged
                // only at debug level by the route handler when needed,
                // and only after redaction.
              };
            },
          },
          genReqId: (req) =>
            (req.headers['x-request-id'] as string) ?? randomUUID(),
          autoLogging: {
            ignore: (req) => req.url === '/health',
          },
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
```

### 3.2 PII Redaction Paths

The following data **must never appear in any log line** in plain text:

| Data element | Classification | Redaction method |
|---|---|---|
| Passwords / password hashes | Highly sensitive | `redact` path in Pino config |
| Aadhaar number | Highly sensitive | `redact` path; mask to last-4 if logging is needed for debugging |
| PAN number | Highly sensitive | `redact` path |
| Passport / national ID number | Highly sensitive | `redact` path |
| Email addresses | Sensitive | `redact` path; use user ID in logs instead |
| Full name | Sensitive | Use user ID in logs |
| Date of birth | Sensitive | `redact` path |
| Marital status | Sensitive | `redact` path |
| Raw resume text | Sensitive | Never log full resume text; log `{ documentId, candidateId, action }` |
| Authorization / cookie headers | Sensitive | `redact` path |

If partial values are needed in logs for debugging (e.g. confirming the last 4 digits of an Aadhaar):

```typescript
// Mask all but the last 4 characters
function maskId(value: string): string {
  if (value.length <= 4) return '****';
  return '*'.repeat(value.length - 4) + value.slice(-4);
}
// log: maskId('123456789012') → '********9012'
```

### 3.3 Correlation IDs

Every request carries a **correlation ID** (`X-Request-Id` header). It is generated at the HTTP ingress layer if absent, attached to all Pino log lines via `genReqId`, and returned in the response header.

Service-to-service calls (e.g. from the NestJS API to Ollama, to a background worker) must propagate the correlation ID in an `X-Request-Id` header so a single user-initiated action can be traced across the system.

```typescript
// In services that make HTTP calls (e.g. OllamaAdapter):
async parseResume(rawText: string, correlationId: string): Promise<ParsedResumeDTO> {
  const response = await fetch(`${this.ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': correlationId,
    },
    body: JSON.stringify({ ... }),
  });
  ...
}
```

**Do / Don't:**

| Do | Don't |
|----|-------|
| Log a structured object with `event`, `userId`, `correlationId`, and relevant IDs. | Log free-form strings like `logger.info('User 123 did something')`. |
| Use the Pino logger injected by `nestjs-pino` (via `PinoLogger` or `Logger`). | Use `console.log`, `console.error`, or NestJS built-in `Logger` in service code. |
| Set `LOG_LEVEL=debug` in development, `info` in production. | Log at `debug` level in production — it generates too much noise and risks PII exposure. |
| Emit a structured `error` event (with `stack`) for every unhandled exception. | Log errors without a stack trace. |
| Redact PII before it reaches any log sink. | Log then redact — the log has already been written by then. |

### 3.4 Structured Log Events

Use a consistent `event` field across all structured logs so log aggregators (Grafana Loki, Datadog, etc.) can filter by event type:

```typescript
// Standard event naming: <domain>.<action>
this.logger.log({ event: 'score_run.started',   candidateId, mode });
this.logger.log({ event: 'score_run.completed', candidateId, total, tier });
this.logger.warn({ event: 'consent.expired',    consentId, candidateId });
this.logger.error({ event: 'verification.upload_failed', documentId, reason: e.message });
this.logger.error({ event: 'security.refresh_token_reuse_detected', userId, ip });
```

---

## 4. Configuration & Secrets

### 4.1 @nestjs/config + Validated Env Schema

All configuration is loaded via `@nestjs/config` with a Zod-validated environment schema. The application **must not start** if a required env var is absent or invalid.

```typescript
// apps/api/src/config/env.schema.ts
import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Server
  PORT: z.coerce.number().int().min(1024).default(3000),
  WEB_ORIGIN: z.string().url(),

  // Database
  DATABASE_URL: z.string().url().startsWith('postgresql://'),

  // Auth
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY:  z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('30d'),

  // Storage
  MINIO_ENDPOINT:        z.string().url(),
  MINIO_ACCESS_KEY:      z.string().min(1),
  MINIO_SECRET_KEY:      z.string().min(1),
  MINIO_BUCKET_DOCUMENTS: z.string().min(1),

  // AI parsing
  AI_PROVIDER:    z.enum(['ollama', 'managed']).default('ollama'),
  OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),

  // Redis (throttler / queues)
  REDIS_URL: z.string().url().startsWith('redis'),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;
```

```typescript
// apps/api/src/config/config.module.ts
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { EnvSchema } from './env.schema';

export const ConfigModule = NestConfigModule.forRoot({
  isGlobal: true,
  validate: (raw) => {
    const result = EnvSchema.safeParse(raw);
    if (!result.success) {
      console.error('❌  Invalid environment variables:', result.error.flatten());
      process.exit(1);    // hard crash — never start with a broken config
    }
    return result.data;
  },
});
```

### 4.2 No Secrets in Code

**No secret, credential, key, or token of any kind appears in source code, committed `.env` files, or Docker images.**

| Location | Rule |
|----------|------|
| Source code (`*.ts`, `*.json`, `*.yaml`) | Zero secrets. Throw a build-time linting error if a known secret pattern is found. |
| `.env` files | `.env` is `.gitignore`d. Only `.env.example` (with dummy values) is committed. |
| Docker images | Secrets are injected at runtime via environment variables from the container host, not baked into the image. |
| Logs | Env vars containing secrets are never logged — the `ConfigService` is not logged; only the resolved config shape (with secrets masked) is logged at startup. |

**At startup, log config shape — mask secrets:**

```typescript
// apps/api/src/main.ts (after app creation)
logger.log({
  event: 'app.config_loaded',
  nodeEnv:    config.get('NODE_ENV'),
  port:       config.get('PORT'),
  aiProvider: config.get('AI_PROVIDER'),
  minioEndpoint: config.get('MINIO_ENDPOINT'),
  // Deliberately NOT logging: DATABASE_URL, JWT secrets, MINIO keys
});
```

### 4.3 Secret Rotation

- JWT secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) must be rotated if a breach is suspected. Rotation invalidates all outstanding tokens — plan for a forced re-login.
- MinIO access keys should be rotated on a schedule (quarterly in production). Use MinIO's built-in IAM key management.
- Database passwords are rotated via the container host's secrets manager (e.g. Coolify environment variables, Doppler, or equivalent).

**Do / Don't:**

| Do | Don't |
|----|-------|
| Validate env vars at startup with a hard crash if they are missing/invalid. | Use `process.env.FOO ?? 'default-secret'` as a fallback for secret values. |
| Use `ConfigService` to access env vars — never `process.env` directly in service code. | Access `process.env` directly in modules other than the config layer. |
| Keep `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` distinct (different secrets). | Use the same secret for both token types. |
| Store secrets in the container host's env var / secrets manager. | Commit `.env` with real values, or embed secrets in `docker-compose.yml`. |

---

## 5. Performance

### 5.1 Database Indexes

Every `WHERE` and `ORDER BY` clause that runs in a hot path must be backed by a database index. Define indexes in the Prisma schema using `@@index`; never add raw migration SQL for indexes without a matching Prisma definition.

Critical indexes for Stabil:

```prisma
// Critical hot-path indexes — all must exist before Phase 1 ships

model User {
  id        String   @id @default(uuid()) @db.Uuid
  email     String   @unique           // login lookup
  role      Role
  status    String
  deletedAt DateTime?
  @@index([role, status])              // admin queries by role
  @@index([deletedAt])                 // purge job (nightly cron)
}

model CandidateProfile {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @unique @db.Uuid   // join from User — 1:1
  mode        Mode
  @@index([mode])                          // admin analytics
}

model ScoreRun {
  id          String   @id @default(uuid()) @db.Uuid
  candidateId String   @db.Uuid
  scoredAt    DateTime
  @@index([candidateId, scoredAt(sort: Desc)])  // latest score per candidate
}

model ConsentRecord {
  id          String   @id @default(uuid()) @db.Uuid
  candidateId String   @db.Uuid
  grantedToId String   @db.Uuid
  status      String
  expiresAt   DateTime?
  @@index([candidateId, status])        // consent guard lookup
  @@index([grantedToId, status])        // employer's active consents
  @@index([expiresAt])                  // nightly expiry cron
}

model RefreshToken {
  id         String   @id @default(uuid()) @db.Uuid
  userId     String   @db.Uuid
  tokenHash  String   @unique             // lookup on refresh
  revokedAt  DateTime?
  @@index([userId, revokedAt])           // revoke all for user
}

model AuditLog {
  id         String   @id @default(uuid()) @db.Uuid
  actorId    String   @db.Uuid
  occurredAt DateTime
  @@index([actorId, occurredAt(sort: Desc)])
  @@index([occurredAt(sort: Desc)])      // admin log viewer
}
```

See [database-and-prisma.md](./database-and-prisma.md) for the full schema and migration strategy.

### 5.2 Avoid N+1 — Prisma Include/Select

Every service query must load all the data it needs in **a single round-trip**. Never loop over an array of IDs and issue one query per ID.

```typescript
// WRONG — N+1 (one query per score run parameter)
const runs = await this.prisma.scoreRun.findMany({ where: { candidateId } });
for (const run of runs) {
  run.parameters = await this.prisma.scoreRunParameter.findMany({
    where: { scoreRunId: run.id },
  });
}

// CORRECT — single query with include
const runs = await this.prisma.scoreRun.findMany({
  where: { candidateId },
  include: {
    parameters: {
      include: { parameter: { select: { key: true, label: true, visibility: true } } },
    },
  },
  orderBy: { scoredAt: 'desc' },
  take: 10,
});
```

Use `select` over `include` when you only need a subset of columns — it reduces the data transferred from the database and avoids accidentally returning `passwordHash` or other sensitive columns:

```typescript
const profile = await this.prisma.candidateProfile.findUniqueOrThrow({
  where: { id, userId: requestorId },
  select: {
    id: true, mode: true, location: true, relocatable: true,
    workModePreference: true, aiExposure: true,
    user: { select: { id: true, name: true, email: true } },
    // NOT: user: { include: { refreshTokens: true } }
  },
});
```

### 5.3 Pagination

Every list endpoint is paginated. The default page size is 20; the maximum is 100. Use cursor-based pagination for large, frequently-updated tables (score runs, audit logs); use offset pagination only for small, stable datasets (parameter definitions).

```typescript
// Cursor-based pagination (preferred for ScoreRun, AuditLog)
const runs = await this.prisma.scoreRun.findMany({
  where: { candidateId },
  take: limit + 1,       // fetch one extra to determine hasNextPage
  cursor: cursor ? { id: cursor } : undefined,
  skip: cursor ? 1 : 0,
  orderBy: { scoredAt: 'desc' },
});

const hasNextPage = runs.length > limit;
const page = hasNextPage ? runs.slice(0, limit) : runs;
const nextCursor = hasNextPage ? page[page.length - 1].id : null;

return { data: page, nextCursor, hasNextPage };
```

The response envelope for all list endpoints:

```typescript
interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasNextPage: boolean;
  total?: number;   // only include when it can be computed cheaply
}
```

### 5.4 Caching

Cache computed values that are expensive to recompute and change infrequently. Score runs are the primary candidate — a score is computed once per run; the result is immutable.

```typescript
// Use NestJS CacheModule (Redis) for hot reads
@Injectable()
export class ReportsService {
  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private readonly prisma: PrismaService,
  ) {}

  async getLatestReport(candidateId: string, audience: Audience): Promise<ReportDTO> {
    const cacheKey = `report:${candidateId}:${audience}`;
    const cached = await this.cache.get<ReportDTO>(cacheKey);
    if (cached) return cached;

    const report = await this.assembleReport(candidateId, audience);
    // Invalidate on next score run — TTL is a safety net, not the primary invalidation
    await this.cache.set(cacheKey, report, 300_000);  // 5 minutes TTL
    return report;
  }

  // Call this after every score run to invalidate stale reports
  async invalidateReportCache(candidateId: string) {
    await Promise.all(
      ['candidate', 'employer', 'recruiter'].map((a) =>
        this.cache.del(`report:${candidateId}:${a}`),
      ),
    );
  }
}
```

Never cache per-request sensitive data (consent checks, auth results). Cache only safe, audience-scoped, already-filtered DTOs — never raw Prisma models with all columns.

### 5.5 Connection Pooling

The Prisma client is a singleton, injected via `PrismaModule` and shared across the application. Never create a new `PrismaClient` in a service or per-request handler.

```typescript
// apps/api/src/prisma/prisma.service.ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Configure the Prisma connection pool via the `DATABASE_URL` query parameter:

```
postgresql://user:pass@host:5432/stabil?connection_limit=20&pool_timeout=10
```

Set `connection_limit` to a value appropriate for the deployment size. A typical POC value is 10–20; tune based on observed `pool_timeout` errors in logs.

**Do / Don't:**

| Do | Don't |
|----|-------|
| Load all needed data in one Prisma query with `include`/`select`. | Run queries inside `Array.map()` or other loops. |
| Use cursor-based pagination for lists. | Return unbounded lists (`findMany` without `take`). |
| Invalidate cache entries on mutations that change the cached data. | Set long TTLs (> 10 min) and rely on TTL expiry for consistency. |
| Index every column used in a `WHERE`, `ORDER BY`, or foreign key join. | Add indexes only to columns that break without them. |
| Use the singleton `PrismaService`. | Instantiate `new PrismaClient()` in a service constructor or handler. |

---

## 6. Background Jobs

Stabil uses background jobs for several critical operations: nightly consent expiry, the 30-day account deletion purge, document processing queues, and score-run orchestration. All jobs use BullMQ (Redis-backed) via `@nestjs/bullmq`.

### 6.1 Idempotency

Every job handler must be safe to run more than once for the same input. This is mandatory because BullMQ guarantees **at-least-once delivery** — a job may be retried after a crash mid-execution.

```typescript
// Pattern: idempotency via DB state check
@Processor('consent-expiry')
export class ConsentExpiryProcessor {
  @Process()
  async handleConsentExpiry(job: Job<{ consentId: string }>) {
    const consent = await this.prisma.consentRecord.findUnique({
      where: { id: job.data.consentId },
      select: { id: true, status: true },
    });

    // Idempotency check — already processed, skip
    if (!consent || consent.status !== 'active') {
      this.logger.log({ event: 'consent_expiry.skipped_already_processed', consentId: job.data.consentId });
      return;
    }

    await this.prisma.consentRecord.update({
      where: { id: job.data.consentId },
      data: { status: 'expired', expiresAt: new Date() },
    });

    this.logger.log({ event: 'consent_expiry.completed', consentId: job.data.consentId });
  }
}
```

For jobs that perform multiple DB writes (e.g. the account deletion pipeline), wrap the writes in a Prisma transaction. If the job crashes mid-transaction, the transaction rolls back and the retry re-runs a clean state.

### 6.2 Retries with Exponential Backoff

Configure BullMQ jobs with retries and backoff. Never configure jobs with zero retries for operations that touch external systems (MinIO, Ollama).

```typescript
// Queue producer — define retry policy per job type
await this.documentQueue.add(
  'parse-resume',
  { documentId, candidateId, correlationId },
  {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },   // 2s, 4s, 8s, 16s, 32s
    removeOnComplete: { count: 100 },
    removeOnFail: false,    // keep failed jobs in the DLQ for inspection
    jobId: `parse-resume:${documentId}`,  // deduplication key (idempotency)
  },
);
```

| Job type | Attempts | Backoff | Notes |
|----------|----------|---------|-------|
| `parse-resume` (Ollama) | 5 | exponential, 2 s base | LLM can be slow/unavailable |
| `send-notification` | 3 | exponential, 5 s base | email/push provider transient errors |
| `consent-expiry` (nightly) | 3 | exponential, 30 s base | low urgency, retry is fine |
| `account-purge` | 3 | exponential, 60 s base | high-stakes; must succeed eventually |
| `score-run` | 2 | fixed, 5 s | scoring is deterministic; failure indicates a bug, not a transient error |

### 6.3 Dead-Letter Queues

Jobs that exhaust all retry attempts move to a **dead-letter queue** (DLQ). The DLQ is a separate BullMQ queue (`<queueName>:dlq`) that accumulates failed jobs for human inspection and replay.

```typescript
// In the BullMQ queue options
const documentQueue = new Queue('document-processing', {
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
  },
  // Move to DLQ on final failure
  ...(await getBullMQOptions(config)),
});

// Companion DLQ consumer — alerts, then awaits human replay
@Processor('document-processing:dlq')
export class DocumentDLQProcessor {
  @Process()
  async handle(job: Job) {
    this.logger.error({
      event: 'job.dead_letter',
      queue: 'document-processing',
      jobId: job.id,
      data: job.data,
      failedReason: job.failedReason,
    });
    // Emit a metric/alert so the on-call engineer knows
    this.metrics.incrementCounter('jobs.dead_letter', { queue: 'document-processing' });
  }
}
```

**Do / Don't:**

| Do | Don't |
|----|-------|
| Make every job handler idempotent — safe to run multiple times for the same input. | Assume a job runs exactly once. |
| Use exponential backoff for jobs that call external services (Ollama, MinIO, email). | Retry immediately with `delay: 0` — it hammers a failing service. |
| Set `removeOnFail: false` so failed jobs are visible in Bull Board / the DLQ. | Set `removeOnFail: true` — failed jobs disappear without a trace. |
| Use a deduplication `jobId` (e.g. `parse-resume:{documentId}`) to prevent duplicate enqueues. | Enqueue the same job twice if the producer is retried. |
| Alert on DLQ entries — a job in the DLQ means a user action failed permanently. | Let DLQ entries accumulate silently. |

### 6.4 Job Visibility (Bull Board)

Mount `@bull-board/nestjs` in non-production environments so developers and admin-role users can inspect queues, failed jobs, and retry them manually. Protect the board route with `admin`-only authentication.

```typescript
// Mount at /api/v1/admin/queues — admin role only
@Module({
  imports: [
    BullBoardModule.forRoot({ route: '/admin/queues', adapter: ExpressAdapter }),
    BullBoardModule.forFeature({ name: 'document-processing' }),
    BullBoardModule.forFeature({ name: 'notifications' }),
    BullBoardModule.forFeature({ name: 'consent-expiry' }),
    BullBoardModule.forFeature({ name: 'account-purge' }),
  ],
})
```

---

## 7. Observability

### 7.1 Health & Readiness Endpoints

The API exposes two endpoints required by the container host:

| Endpoint | Purpose | Checks |
|----------|---------|--------|
| `GET /health/live` | Liveness — is the process running? | Returns `200 { status: 'ok' }` immediately |
| `GET /health/ready` | Readiness — is it safe to route traffic? | Checks Postgres connection + Redis connection |

```typescript
// apps/api/src/health/health.controller.ts
import { HealthCheck, HealthCheckService, PrismaHealthIndicator, MicroserviceHealthIndicator } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: PrismaHealthIndicator,
    private redis: MicroserviceHealthIndicator,
  ) {}

  @Get('live')
  @HealthCheck()
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.pingCheck('redis', { transport: Transport.REDIS, options: { ... } }),
    ]);
  }
}
```

Both endpoints are unauthenticated (marked `@Public()`) and are excluded from rate limiting and access logging.

### 7.2 Metrics

Expose a Prometheus `/metrics` endpoint (or push to a Prometheus Pushgateway) using `@willsoto/nestjs-prometheus`. Key metrics to instrument:

| Metric | Type | Labels | Purpose |
|--------|------|--------|---------|
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Latency per route |
| `http_requests_total` | Counter | `method`, `route`, `status` | Throughput |
| `score_runs_total` | Counter | `mode`, `tier` | Business metric — score distribution |
| `job_queue_depth` | Gauge | `queue` | Queue health |
| `jobs_completed_total` | Counter | `queue` | Job throughput |
| `jobs_failed_total` | Counter | `queue` | Job failure rate |
| `jobs_dead_letter_total` | Counter | `queue` | DLQ accumulation |
| `document_uploads_total` | Counter | `docType`, `status` | Upload success/failure |
| `consent_records_active` | Gauge | — | Active consents (business) |
| `db_query_duration_seconds` | Histogram | `model`, `operation` | Slow query detection |

Register a Prisma query event to emit the `db_query_duration_seconds` metric:

```typescript
// In PrismaService.onModuleInit()
this.$on('query', (e: Prisma.QueryEvent) => {
  this.metrics.histogram('db_query_duration_seconds', e.duration / 1000, {
    labels: { model: e.model ?? 'unknown', operation: e.action },
  });
  if (e.duration > 200) {
    this.logger.warn({ event: 'db.slow_query', durationMs: e.duration, model: e.model, action: e.action });
  }
});
```

### 7.3 Distributed Tracing

In Phase 1 the API is a single service, so traces are primarily useful for identifying slow Prisma queries and Ollama calls. Instrument with OpenTelemetry (`@opentelemetry/sdk-node`):

```typescript
// apps/api/src/tracing.ts — loaded before NestJS bootstrap
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  serviceName: 'stabil-api',
  instrumentations: [getNodeAutoInstrumentations()],
  // Exporter: Jaeger or OTLP → Grafana Tempo
});
sdk.start();
```

Propagate the correlation ID (`X-Request-Id`) as a trace attribute so traces and logs are linkable in the same dashboard.

**Do / Don't:**

| Do | Don't |
|----|-------|
| Expose `/health/live` and `/health/ready` — the container host needs both to manage rolling deployments. | Combine liveness and readiness into one endpoint (different semantics). |
| Track business metrics (score runs, consent grants) not just HTTP metrics. | Only instrument HTTP — you lose visibility into the core product flows. |
| Alert on DLQ depth > 0 and on `jobs_failed_total` rate spike. | Deploy without alerting on job failures. |
| Log slow queries (> 200 ms) at `warn` level with the model and action. | Let slow queries go unnoticed. |

---

## 8. Architecture Hygiene

### 8.1 Module Boundaries — No Cross-Module Repository Access

Each NestJS module (auth, profiles, scoring, reports, consent, documents, verification, notifications) owns its own Prisma access. A module **must not** import another module's repository/service to reach its data directly.

```
apps/api/src/modules/
├── auth/           → owns: User, RefreshToken
├── profiles/       → owns: CandidateProfile
├── scoring/        → owns: ScoreRun, ScoreRunParameter
├── reports/        → owns: no DB writes; reads via ScoreRun + Parameter (through ScoringModule)
├── consent/        → owns: ConsentRecord
├── documents/      → owns: Document (MinIO + VerificationDocument)
├── verification/   → owns: VerificationDocument status transitions
└── notifications/  → owns: NotificationRecord
```

If `ReportsModule` needs the latest score run for a candidate, it imports `ScoringModule` and calls `ScoringService.getLatestRun(candidateId)` — it does **not** import `PrismaService` and query `ScoreRun` directly.

```typescript
// WRONG — ReportsModule reaching into ScoringModule's data
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async assemble(candidateId: string) {
    const run = await this.prisma.scoreRun.findFirst({   // <-- crossed a module boundary
      where: { candidateId }, orderBy: { scoredAt: 'desc' },
    });
  }
}

// CORRECT — ReportsModule depends on ScoringModule's public API
@Injectable()
export class ReportsService {
  constructor(private readonly scoringService: ScoringService) {}

  async assemble(candidateId: string) {
    const run = await this.scoringService.getLatestRun(candidateId);
  }
}
```

This boundary is enforced by:
1. Only `PrismaModule` is `@Global()`. Modules that need it import it explicitly.
2. Code review rejects any Prisma query in a module that touches a model outside its ownership list.
3. See `modules/README.md` for the full ownership table.

### 8.2 DTO ↔ Domain Separation

Controllers receive and return **DTOs**. Services operate on **domain objects**. The mapping happens at the service boundary — never in the controller, never in the Prisma query.

```
HTTP Request body  →  DTO (Zod-validated)  →  Service (domain logic)  →  DTO (response)
                                              ↓
                                        Prisma model (never returned from controller)
```

```typescript
// Controller — receives/returns DTOs only
@Post()
async createProfile(
  @Body(new ZodValidationPipe(CreateCandidateProfileSchema)) dto: CreateCandidateProfileDTO,
  @Req() req: AuthenticatedRequest,
): Promise<CandidateProfileResponseDTO> {
  return this.profilesService.create(dto, req.user.id);
}

// Service — translates DTO → domain operation → response DTO
async create(dto: CreateCandidateProfileDTO, userId: string): Promise<CandidateProfileResponseDTO> {
  const existing = await this.prisma.candidateProfile.findUnique({ where: { userId } });
  if (existing) throw new ProfileAlreadyExistsException();

  const profile = await this.prisma.candidateProfile.create({
    data: { ...dto, userId },
    select: CandidateProfileSelect,   // pre-defined select — never Prisma model with all columns
  });

  return toCandidateProfileDTO(profile);  // explicit mapper — no implicit Prisma model exposure
}
```

Prisma models are **internal**. They are never serialized and returned from a controller directly. A Prisma model has all columns including `passwordHash`, `deletedAt`, internal FK columns — these must never reach the API response.

### 8.3 Dependency Injection — Constructor Injection Only

Use constructor-based DI everywhere. Property injection (`@Inject()` on a property) is only used when constructor injection is impossible (e.g. circular dependencies, which should be resolved by restructuring rather than accepted).

```typescript
// CORRECT — constructor injection
@Injectable()
export class ScoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringEngine: ScoringEngineService,
    private readonly logger: PinoLogger,
    private readonly events: EventEmitter2,
  ) {}
}
```

Circular dependencies between modules are a sign of incorrect boundary placement. Resolve them by:
1. Extracting shared logic into a `CommonModule` or a shared `packages/core` utility.
2. Using `forwardRef()` only as a last resort; document why with a code comment.

### 8.4 Module Encapsulation

Modules export only what other modules legitimately need. Services that are implementation details of a module are not exported.

```typescript
@Module({
  providers: [ScoringService, ScoreRunRepository, ScoreParameterLoader],
  exports: [ScoringService],   // only the service — not the repository or loader
})
export class ScoringModule {}
```

### 8.5 Guard and Interceptor Ordering

Guards and interceptors on a route run in this order. Get it wrong and security checks are bypassed:

```
1. Global guards (JwtAuthGuard → applied to everything not marked @Public())
2. Controller-level guards (@UseGuards(RolesGuard))
3. Route-level guards (@UseGuards(ConsentGuard))
4. Global interceptors (SerializationInterceptor, CorrelationIdInterceptor)
5. Route handler
```

**ConsentGuard must be the last guard before the handler** so that auth and role checks have already run — `ConsentGuard` reads `req.user` which is only populated after `JwtAuthGuard`.

### 8.6 Checklists

**New module checklist:**

- [ ] Module owns a clearly-defined set of Prisma models (documented in `modules/README.md`).
- [ ] Module does not query models owned by another module.
- [ ] Module exports only its public service(s), not repositories or internal helpers.
- [ ] Every controller route has `@UseGuards(JwtAuthGuard)` or is explicitly marked `@Public()`.
- [ ] Every controller route has `@Roles(...)` applied (or `@Roles('admin')` if admin-only).
- [ ] Every body/query/param has a `ZodValidationPipe` applied.
- [ ] Every service method that reads a resource by ID includes the requesting user's ID in the `where` clause (IDOR prevention).
- [ ] Error cases throw typed `StabilHttpException` subclasses — no raw `throw new Error(...)`.
- [ ] All Prisma queries use `select` to exclude columns the endpoint does not need.
- [ ] A `*.spec.ts` unit test file exists and covers the happy path and at least two error paths.

**Before opening a PR checklist:**

- [ ] No `console.log` in any file under `apps/api/src/`.
- [ ] No hard-coded secret, URL, or credential (grep for common patterns: `Bearer `, `password:`, AWS key prefixes).
- [ ] No `findMany` call without a `take` limit.
- [ ] No query loop (Prisma call inside `Array.map()`, `for...of`, or `.forEach()`).
- [ ] No new env var without a corresponding entry in `EnvSchema` with validation.
- [ ] `@EmployerOnly()` applied to any new parameter/field that falls under `employer-only` visibility (SCOPE §6.3).
- [ ] Integration test added for any new endpoint that touches sensitive data.
- [ ] `AuditLog` entry added for any action that modifies or reads `employer-only` data.

---

## Cross-References

| Topic | Where to look |
|-------|---------------|
| Full threat model, RBAC matrix, consent enforcement | [architecture/05-security-privacy.md](../architecture/05-security-privacy.md) |
| PII classification, data retention, deletion pipeline | [architecture/05-security-privacy.md §2, §4](../architecture/05-security-privacy.md) |
| Aadhaar/PAN storage, MinIO encryption, signed URLs | [architecture/05-security-privacy.md §5](../architecture/05-security-privacy.md) |
| JWT access/refresh mechanics, argon2id parameters | [architecture/05-security-privacy.md §7](../architecture/05-security-privacy.md) |
| RFC 9457 error model, idempotency, versioning | [architecture/04-api-contracts.md §1.5, §1.6](../architecture/04-api-contracts.md) |
| Unit, integration, and e2e test strategy | [testing.md](./testing.md) |
| Prisma schema, migrations, full index list | [database-and-prisma.md](./database-and-prisma.md) |
| Module ownership table and phase mapping | [modules/README.md](./modules/README.md) |
| API REST conventions, pagination envelope, auth headers | [api-conventions.md](./api-conventions.md) |
| Scoring engine boundary (`@stabil/scoring`) | [architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md) |
| Sensitive-attribute visibility model (SCOPE §6.3) | [SCOPE.md §6](../SCOPE.md) |
