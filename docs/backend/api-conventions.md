# API Conventions

> **Status:** Draft v0.1 · **Phase:** cross-cutting · **Owner area:** backend
> **Related:** [architecture/04-api-contracts.md](../architecture/04-api-contracts.md), [backend/best-practices.md](./best-practices.md), [backend/modules/auth-accounts.md](./modules/auth-accounts.md), [architecture/05-security-privacy.md](../architecture/05-security-privacy.md)

This document captures the **implementation patterns** every NestJS module in the Stabil API must follow: REST naming, URI versioning, error handling, validation, pagination, idempotency, rate limiting, authentication, audience-aware serialization, HTTP status codes, and correlation IDs. It is the how-to companion to the contract specification in [architecture/04-api-contracts.md](../architecture/04-api-contracts.md), which is authoritative for endpoint shapes and DTOs. Together they form the full API rulebook.

---

## (a) REST Resource Naming and `/api/v1` URI Versioning

### Resource naming rules

All resources follow standard REST conventions applied consistently across the NestJS module tree:

| Rule | Example |
|------|---------|
| Lowercase, hyphen-separated plural nouns | `/profiles`, `/score-runs`, `/consent/shares` |
| Sub-resources are nested under their parent | `/profiles/:profileId/submissions/:mode` |
| Actions that cannot fit a noun are named verbs under the resource | `/profiles/:id/claim`, `/notifications/:id/read` |
| No trailing slashes | `/api/v1/profiles` not `/api/v1/profiles/` |
| Singleton sub-resources use the noun without an ID | `/profiles/:profileId/submissions/current` |

### URI versioning with `@nestjs/common`

Stabil uses **URI versioning** (`/api/v1/...`). The version prefix is set once at bootstrap — not per-controller — so every route inherits it automatically. Breaking changes (field removals, semantic changes) ship as `/api/v2`; additive fields are non-breaking and do not require a new version.

```ts
// apps/api/src/main.ts
import { NestFactory } from "@nestjs/core";
import { VersioningType } from "@nestjs/common";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global /api prefix
  app.setGlobalPrefix("api");

  // URI versioning: every route becomes /api/v1/...
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  await app.listen(3001);
}
bootstrap();
```

Controllers declare the version at the controller level (or per-route when a single controller spans versions):

```ts
// apps/api/src/profiles/profiles.controller.ts
import { Controller, Get, Post, Param, Body, Version } from "@nestjs/common";

@Controller({ path: "profiles", version: "1" })  // → /api/v1/profiles
export class ProfilesController {
  @Post()
  create(@Body() dto: CreateProfileDto) { /* ... */ }

  @Get(":id")
  findOne(@Param("id") id: string) { /* ... */ }
}
```

When a new version is needed for a **single endpoint** while the others remain stable, use the `@Version` decorator on the handler instead:

```ts
@Get(":id")
@Version("2")          // only this handler becomes /api/v2/profiles/:id
findOneV2(@Param("id") id: string) { /* ... */ }
```

---

## (b) RFC 9457 Problem+JSON Error Model and Global Exception Filter

All errors are returned as `application/problem+json` per [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457). This applies to validation failures, auth errors, not-found, rate-limit hits, and internal errors — the client always receives the same shape.

### Error envelope

```ts
// packages/contracts/src/errors.ts
export interface ProblemDetails {
  type: string;          // "https://stabil.app/problems/<slug>"
  title: string;         // short, human-readable summary
  status: number;        // mirrors the HTTP status code
  detail?: string;       // longer human-readable description
  instance?: string;     // the request path that produced the error
  requestId?: string;    // X-Request-Id value for support correlation
  errors?: FieldError[]; // only present on 422 validation failures
}

export interface FieldError {
  path: string;          // dotted path, e.g. "answers.totalExperienceYears"
  message: string;       // Zod-generated user-facing message
  code: string;          // Zod issue code, e.g. "too_small", "invalid_enum_value"
}
```

### Problem type slug registry

| Slug | Status | When |
|------|--------|------|
| `validation-failed` | 422 | Zod schema violation on request body/query/params |
| `unauthenticated` | 401 | Missing, expired, or malformed JWT |
| `token-reuse-detected` | 401 | Replayed refresh token — whole family revoked |
| `forbidden` | 403 | Caller lacks the required role or ownership |
| `consent-required` | 403 | Employer/recruiter lacks an accepted share grant |
| `not-found` | 404 | Unknown resource |
| `conflict` | 409 | Duplicate resource or already-decided state |
| `idempotency-key-conflict` | 409 | Same key, different request body |
| `idempotency-key-required` | 400 | Missing `Idempotency-Key` on `POST /scoring/runs` |
| `share-expired` | 410 | Share grant or claim token has expired |
| `rate-limited` | 429 | Token-bucket limit exceeded |
| `payload-too-large` | 413 | Upload `sizeBytes` exceeds per-kind maximum |
| `unsupported-media-type` | 415 | Content-type not in the allow-list |
| `internal` | 500 | Unhandled exception |
| `upstream-unavailable` | 503 | MinIO or Ollama unreachable |

### Global exception filter implementation

```ts
// apps/api/src/common/filters/problem.filter.ts
import {
  ExceptionFilter, Catch, ArgumentsHost, HttpException,
  HttpStatus, Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ZodValidationException } from "nestjs-zod";
import { ZodError } from "zod";
import { ProblemDetails, FieldError } from "@stabil/contracts";

const BASE = "https://stabil.app/problems";

function slugFor(status: number, exception: unknown): string {
  if (exception instanceof ZodValidationException) return "validation-failed";
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 410) return "share-expired";
  if (status === 422) return "validation-failed";
  if (status === 429) return "rate-limited";
  if (status === 503) return "upstream-unavailable";
  return "internal";
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const requestId: string = req.headers["x-request-id"] as string ?? "";
    const instance = req.url;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = "An unexpected error occurred.";
    let detail: string | undefined;
    let errors: FieldError[] | undefined;
    let slug = "internal";

    if (exception instanceof ZodValidationException) {
      status = 422;
      slug = "validation-failed";
      title = "Request validation failed.";
      const zodError: ZodError = exception.getZodError();
      errors = zodError.errors.map((e) => ({
        path: e.path.join("."),
        message: e.message,
        code: e.code,
      }));
      detail = `${errors.length} field${errors.length === 1 ? " is" : "s are"} invalid.`;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      slug = slugFor(status, exception);
      const body = exception.getResponse();
      title = typeof body === "string" ? body : (body as any).message ?? exception.message;
      detail = typeof body === "object" ? (body as any).detail : undefined;
    } else {
      this.logger.error("Unhandled exception", exception instanceof Error ? exception.stack : String(exception));
    }

    const body: ProblemDetails = {
      type: `${BASE}/${slug}`,
      title,
      status,
      ...(detail && { detail }),
      instance,
      requestId,
      ...(errors && { errors }),
    };

    res
      .status(status)
      .header("Content-Type", "application/problem+json")
      .json(body);
  }
}
```

Register the filter globally in `AppModule` (preferred over `app.useGlobalFilters` so it can receive injected services):

```ts
// apps/api/src/app.module.ts
import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ProblemFilter } from "./common/filters/problem.filter";

@Module({
  providers: [{ provide: APP_FILTER, useClass: ProblemFilter }],
})
export class AppModule {}
```

Example `422` response:

```json
{
  "type": "https://stabil.app/problems/validation-failed",
  "title": "Request validation failed.",
  "status": 422,
  "detail": "1 field is invalid.",
  "instance": "/api/v1/submissions/professional",
  "requestId": "req_01HZ9VABCDE",
  "errors": [
    {
      "path": "answers.totalExperienceYears",
      "message": "Number must be greater than or equal to 0",
      "code": "too_small"
    }
  ]
}
```

---

## (c) Request Validation with Zod via nestjs-zod and Automatic OpenAPI Generation

### Single source of truth: `packages/contracts`

All request and response shapes are defined once as Zod schemas in the shared `packages/contracts` package. Both the API (validation) and clients (web, mobile) import the same schemas — no duplication, no drift.

```ts
// packages/contracts/src/submissions.ts
import { z } from "zod";
import { createZodDto } from "nestjs-zod";

export const SaveSubmissionSchema = z.object({
  answers: z.object({
    // Common block (SCOPE §4.5)
    location: z.string().max(200).optional(),
    communicationSelfRating: z.number().int().min(1).max(5).optional(),
    // Fresher block (SCOPE §4.3)
    academics: z.object({
      degree: z.string().min(1),
      gpa: z.number().min(0).max(10).optional(),
      institution: z.string().max(300).optional(),
    }).optional(),
    aiFamiliarity: z.number().int().min(1).max(5).optional(),
    relocationWilling: z.boolean().optional(),
    workModePreference: z.enum(["remote", "hybrid", "onsite"]).optional(),
    programmingLanguages: z.array(z.string().min(1)).max(30).optional(),
    // Professional block (SCOPE §4.4)
    totalExperienceYears: z.number().min(0).max(60).optional(),
    averageTenureYears: z.number().min(0).max(30).optional(),
    spokenLanguages: z.array(z.string().min(1)).max(30).optional(),
    maritalStatus: z.enum(["single", "married", "other"]).optional(), // employer-only visibility
    age: z.number().int().min(16).max(100).optional(),                // employer-only visibility
  }),
});

// Derive a NestJS DTO class from the Zod schema — one line.
export class SaveSubmissionDto extends createZodDto(SaveSubmissionSchema) {}
```

### Using the DTO in a controller

`nestjs-zod` provides a `ZodValidationPipe` that runs the schema against incoming bodies. Apply it globally so no controller ever forgets to validate:

```ts
// apps/api/src/main.ts  (add to bootstrap)
import { ZodValidationPipe } from "nestjs-zod";

app.useGlobalPipes(new ZodValidationPipe());
```

In a controller, use the generated DTO class as the parameter type — Swagger picks up the schema automatically:

```ts
// apps/api/src/profiles/profiles.controller.ts
import { Controller, Put, Param, Body, HttpCode } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { SaveSubmissionDto } from "@stabil/contracts";
import { SubmissionsService } from "./submissions.service";

@ApiTags("submissions")
@ApiBearerAuth()
@Controller({ path: "profiles", version: "1" })
export class ProfilesController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Put(":profileId/submissions/:mode")
  @HttpCode(200)
  @ApiOperation({ summary: "Save or replace answers for a profile mode" })
  async saveSubmission(
    @Param("profileId") profileId: string,
    @Param("mode") mode: "fresher" | "professional",
    @Body() dto: SaveSubmissionDto,           // ← validated by ZodValidationPipe
  ) {
    return this.submissions.save(profileId, mode, dto.answers);
  }
}
```

On a Zod failure, `ZodValidationPipe` throws a `ZodValidationException`, which the global `ProblemFilter` above converts into a `422` problem+json with `errors[]`.

### OpenAPI / Swagger generation

```ts
// apps/api/src/main.ts  (add to bootstrap, non-prod only)
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { patchNestjsSwagger } from "nestjs-zod";

// Patch swagger to understand Zod schemas
patchNestjsSwagger();

if (process.env.NODE_ENV !== "production") {
  const swaggerConfig = new DocumentBuilder()
    .setTitle("Stabil API")
    .setVersion("1")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/v1/docs", app, document);    // Swagger UI
  // Static JSON: GET /api/v1/openapi.json
}
```

`patchNestjsSwagger()` teaches `@nestjs/swagger`'s `SchemaObjectFactory` to walk Zod schemas and emit correct JSON Schema — no extra `@ApiProperty()` decorators needed on `createZodDto` classes. The generated spec is the build artifact; never hand-edit it.

---

## (d) Cursor-Based Pagination

Stabil list endpoints use **opaque cursor pagination**, not offset/page-number, because offsets become inconsistent as data is inserted or deleted during traversal — especially relevant for the improvement-loop score history.

### Request parameters

| Query param | Type | Default | Constraints |
|-------------|------|---------|-------------|
| `limit` | integer | `20` | 1–100 |
| `cursor` | string (opaque) | absent = first page | base64url-encoded `(createdAt, id)` of last item seen |

### Response envelope

```ts
// packages/contracts/src/pagination.ts
import { z } from "zod";

export const PageSchema = z.object({
  nextCursor: z.string().nullable(),   // null means this is the last page
  limit: z.number().int(),
});

export function PaginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    page: PageSchema,
  });
}

export type Paginated<T> = { data: T[]; page: { nextCursor: string | null; limit: number } };
```

### Cursor encoding/decoding utility

```ts
// apps/api/src/common/pagination.ts
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const CursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export class CursorQueryDto extends createZodDto(CursorQuerySchema) {}

interface CursorPayload { createdAt: string; id: string }

export function encodeCursor(createdAt: Date, id: string): string {
  const payload: CursorPayload = { createdAt: createdAt.toISOString(), id };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as CursorPayload;
  } catch {
    throw new BadRequestException("Invalid cursor value.");
  }
}
```

### Prisma query pattern

```ts
// Example from ScoreRunsService — list score history for a profile
async listRuns(profileId: string, limit: number, cursor?: string): Promise<Paginated<ScoreRun>> {
  const decoded = cursor ? decodeCursor(cursor) : null;

  const rows = await this.prisma.scoreRun.findMany({
    where: {
      profileId,
      ...(decoded && {
        OR: [
          { createdAt: { lt: new Date(decoded.createdAt) } },
          { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
        ],
      }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,        // fetch one extra to detect whether a next page exists
  });

  const hasNextPage = rows.length > limit;
  if (hasNextPage) rows.pop();

  const lastRow = rows.at(-1);
  const nextCursor = hasNextPage && lastRow
    ? encodeCursor(lastRow.createdAt, lastRow.id)
    : null;

  return { data: rows.map(toScoreRunDto), page: { nextCursor, limit } };
}
```

### Example request / response

```
GET /api/v1/scoring/runs?profileId=0190b2...&limit=2
```

```json
{
  "data": [
    { "id": "0190c3...", "total": 1180, "tier": "settled", "createdAt": "2026-06-06T11:00:00.000Z" },
    { "id": "0190b9...", "total": 1040, "tier": "somewhat-stable", "createdAt": "2026-06-05T09:30:00.000Z" }
  ],
  "page": {
    "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTA1VDA5OjMwOjAwLjAwMFoiLCJpZCI6IjAxOTBiOS4uLiJ9",
    "limit": 2
  }
}
```

To get the next page, pass `?cursor=eyJjcmVhdGVkQXQi...` in the next request. When `nextCursor` is `null`, the caller has reached the last page.

---

## (e) Idempotency Keys for Non-Idempotent Operations (Score Runs)

Creating a score run is **expensive** (calls the scoring engine, persists a full breakdown) and must be **safe to retry** — a network timeout should never cause duplicate runs or double-billing of improvement history. Idempotency keys solve this.

### Header convention

```
Idempotency-Key: <client-generated UUID v4 or v7>
```

- **Required** on `POST /scoring/runs`. Missing → `400 idempotency-key-required`.
- **Recommended** (optional) on `POST /profiles/:id/report/pdf` and `POST /consent/shares`.
- Clients must generate a fresh key per logical operation; they **must not** share a key across different intended requests.

### Storage approach

Keys are stored in a **dedicated table** (backed by Postgres, not Redis, to keep the stack simple in the POC):

```prisma
// prisma/schema.prisma
model IdempotencyRecord {
  id              String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  key             String
  userId          String   @db.Uuid
  endpoint        String   // e.g. "POST /api/v1/scoring/runs"
  requestBodyHash String   // SHA-256 hex of the request body
  statusCode      Int
  responseBody    Json
  createdAt       DateTime @default(now())
  expiresAt       DateTime // createdAt + 24h

  @@unique([key, userId, endpoint])
  @@index([expiresAt])   // for periodic purge of expired records
}
```

### Idempotency guard interceptor

```ts
// apps/api/src/common/interceptors/idempotency.interceptor.ts
import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
  ConflictException, BadRequestException, HttpException,
} from "@nestjs/common";
import { Observable, from, of } from "rxjs";
import { switchMap, tap } from "rxjs/operators";
import * as crypto from "crypto";
import { IdempotencyService } from "../services/idempotency.service";

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers["idempotency-key"] as string | undefined;
    if (!key) return next.handle();  // optional on non-scoring endpoints; guard checks required

    const userId: string = req.user?.sub;
    const endpoint = `${req.method} ${req.route?.path ?? req.url}`;
    const bodyHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(req.body))
      .digest("hex");

    return from(this.idempotency.findRecord(key, userId, endpoint)).pipe(
      switchMap((existing) => {
        if (!existing) {
          // First time — run the handler, then persist the result
          return next.handle().pipe(
            tap(async (responseBody) => {
              await this.idempotency.saveRecord({
                key, userId, endpoint, requestBodyHash: bodyHash,
                statusCode: ctx.switchToHttp().getResponse().statusCode,
                responseBody,
              });
            }),
          );
        }

        if (existing.requestBodyHash !== bodyHash) {
          throw new ConflictException({
            detail: "Idempotency key already used with a different request body.",
            type: "https://stabil.app/problems/idempotency-key-conflict",
          });
        }

        // Replay: same key + same body → return cached response
        const res = ctx.switchToHttp().getResponse();
        res.setHeader("Idempotency-Replayed", "true");
        res.status(existing.statusCode);
        return of(existing.responseBody);
      }),
    );
  }
}
```

Apply the interceptor to the scoring controller only (or any controller that requires it):

```ts
@Controller({ path: "scoring", version: "1" })
@UseInterceptors(IdempotencyInterceptor)
export class ScoringController {
  @Post("runs")
  async createRun(
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() dto: CreateScoreRunDto,
    @Req() req: Request,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        type: "https://stabil.app/problems/idempotency-key-required",
        detail: "POST /scoring/runs requires an Idempotency-Key header.",
      });
    }
    return this.scoringService.createRun(dto, req.user);
  }
}
```

### Semantics summary

| Scenario | Response |
|----------|----------|
| New key, first request | Run executes → `201 Created` |
| Same key + same body (retry) | Cached response replayed → `200 OK`, `Idempotency-Replayed: true` |
| Same key + different body | `409 idempotency-key-conflict` |
| Missing key on `POST /scoring/runs` | `400 idempotency-key-required` |
| Record older than 24h (expired) | Treated as new key |

---

## (f) Rate Limiting with `@nestjs/throttler`

Rate limiting uses `@nestjs/throttler` with **per-user** (authenticated) and **per-IP** (public auth) token buckets.

### Module setup

```ts
// apps/api/src/app.module.ts
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          // "default" bucket — overridden per controller/route via @Throttle()
          { name: "default", ttl: 60_000, limit: 300 },
        ],
        // Use authenticated user id when available; fall back to IP
        getTracker: (req) => req.user?.sub ?? req.ip,
        errorMessage: "Too many requests. Please slow down.",
      }),
    }),
  ],
  providers: [
    // Apply throttling globally; mark public auth routes with a tighter config
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
```

### Per-bucket configuration

Buckets are defined once as constants and applied with `@Throttle()`:

```ts
// apps/api/src/common/throttle.config.ts
export const AUTH_THROTTLE   = { auth:    { ttl: 60_000,      limit: 10  } };  // 10/min/IP
export const SCORING_THROTTLE = { scoring: { ttl: 3_600_000,  limit: 20  } };  // 20/hr/user
export const UPLOADS_THROTTLE = { uploads: { ttl: 3_600_000,  limit: 60  } };  // 60/hr/user
```

```ts
// On the scoring controller
import { Throttle } from "@nestjs/throttler";
import { SCORING_THROTTLE } from "../common/throttle.config";

@Post("runs")
@Throttle(SCORING_THROTTLE)
async createRun(/* ... */) { /* ... */ }
```

### Rate-limit response headers

`ThrottlerGuard` automatically sets standard headers on every response:

| Header | Meaning |
|--------|---------|
| `X-RateLimit-Limit` | Bucket maximum |
| `X-RateLimit-Remaining` | Remaining requests in the current window |
| `X-RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Only on `429` — seconds until the next request is allowed |

A `429` response also uses the `ProblemFilter` (problem+json):

```json
{
  "type": "https://stabil.app/problems/rate-limited",
  "title": "Too many requests.",
  "status": 429,
  "detail": "Scoring bucket: 20 runs per hour. Try again in 1800 seconds.",
  "instance": "/api/v1/scoring/runs",
  "requestId": "req_01HZ..."
}
```

---

## (g) Authentication Header Conventions, Refresh Flow, and `RolesGuard` / `@Roles()`

### Access token convention

Every protected endpoint requires:

```
Authorization: Bearer <access-token>
```

The access token is a short-lived JWT (15 min) signed with the API's RS256 private key. It carries the following claims (see [architecture/04-api-contracts.md §1.3](../architecture/04-api-contracts.md)):

```ts
export interface AccessClaims {
  sub: string;       // user id (UUID v7)
  role: Role;        // "candidate" | "employer" | "recruiter" | "admin"
  email: string;
  jti: string;       // JWT ID — used for token revocation tracking
  iat: number;
  exp: number;
}
```

### Refresh flow

| Token | Lifetime | Transport |
|-------|----------|-----------|
| Access | 15 min | `Authorization: Bearer` header |
| Refresh | 30 days (rotating) | Request body to `POST /auth/refresh` (mobile) **or** `HttpOnly` cookie set by the API (web) |

On expiry, clients call `POST /api/v1/auth/refresh` with the old refresh token. The API issues a new access+refresh pair and invalidates the old refresh token. Replaying a consumed refresh token triggers **family revocation** (all tokens for that user are invalidated) and returns `401 token-reuse-detected`.

### `JwtAuthGuard` (global)

```ts
// apps/api/src/auth/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private reflector: Reflector) { super(); }

  canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;           // skip JWT check for @Public() routes
    return super.canActivate(ctx);
  }
}
```

```ts
// apps/api/src/auth/decorators/public.decorator.ts
import { SetMetadata } from "@nestjs/common";
export const IS_PUBLIC_KEY = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### Role enum and `@Roles()` decorator

```ts
// packages/contracts/src/domain.ts  (shared with scoring engine)
export const Role = z.enum(["candidate", "employer", "recruiter", "admin"]);
export type Role = z.infer<typeof Role>;
```

```ts
// apps/api/src/auth/decorators/roles.decorator.ts
import { SetMetadata } from "@nestjs/common";
import { Role } from "@stabil/contracts";
export const ROLES_KEY = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

### `RolesGuard`

```ts
// apps/api/src/auth/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@stabil/contracts";
import { ROLES_KEY } from "../decorators/roles.decorator";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = ctx.switchToHttp().getRequest();
    if (!requiredRoles.includes(user?.role)) {
      throw new ForbiddenException({
        type: "https://stabil.app/problems/forbidden",
        detail: `This endpoint requires one of: ${requiredRoles.join(", ")}.`,
      });
    }
    return true;
  }
}
```

Register both guards globally:

```ts
// apps/api/src/app.module.ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
]
```

### Usage in a controller

```ts
@Post("employer-submit")
@Roles("employer", "recruiter")               // only these roles can reach this handler
@ApiOperation({ summary: "Employer submits a candidate — creates a claimable profile" })
async employerSubmit(@Body() dto: EmployerSubmitCandidateDto, @Req() req: Request) {
  return this.profilesService.employerSubmit(dto, req.user);
}

@Get("openapi.json")
@Public()                                     // no JWT required
async openapiSpec() { /* ... */ }
```

---

## (h) Audience-Aware Serialization: `filterForAudience`

This is the most critical serialization rule in Stabil. Employer-only fields (age, marital status) **must never appear in a candidate-audience response** — enforced server-side, unconditionally (SCOPE §6.3, §9, §8).

### How it works end-to-end

1. Each scoring parameter carries a `visibility: "all" | "employer-only"` field (see `@stabil/scoring` `domain.ts`).
2. The raw `ScoreRun` stored in the database contains the **full** breakdown, including `employer-only` items.
3. When the report endpoint is called, the API determines the **caller's audience** from their role and the presence of an accepted share grant.
4. A `filterForAudience` function strips `employer-only` items from the `breakdown` before the response is serialized — and sets `hiddenLineItemCount` so the candidate knows suppression occurred.
5. The `total` and `tier` are **never recalculated** — they remain identical across audiences; only the itemized `breakdown` differs.

### `filterForAudience` utility

```ts
// apps/api/src/reports/utils/filter-for-audience.ts
import { Audience, Visibility, CandidateReport, EmployerReport, ScoreRun } from "@stabil/contracts";

interface FilterInput {
  run: ScoreRun;
  profileId: string;
  audience: Audience;
  improvementGuidance?: ImprovementHint[];
}

export function filterForAudience(input: FilterInput): CandidateReport | EmployerReport {
  const { run, profileId, audience, improvementGuidance = [] } = input;
  const base = {
    profileId,
    scoreRunId: run.id,
    mode: run.mode,
    total: run.total,           // IDENTICAL regardless of audience
    maxTotal: run.maxTotal,
    tier: run.tier,             // IDENTICAL regardless of audience
    byBlock: run.byBlock,
    isVerifiedUser: run.isVerifiedUser,
    generatedAt: new Date().toISOString(),
  };

  if (audience === "candidate") {
    const visibleItems = run.breakdown.filter(
      (item) => item.visibility === "all" satisfies Visibility,
    );
    const hiddenLineItemCount = run.breakdown.length - visibleItems.length;

    return {
      ...base,
      audience: "candidate",
      breakdown: visibleItems,
      hiddenLineItemCount,
      improvementGuidance,
    } satisfies CandidateReport;
  }

  // audience: "employer" | "recruiter" → full breakdown, no suppression
  return {
    ...base,
    audience,
    breakdown: run.breakdown,  // ALL items, including visibility === "employer-only"
  } satisfies EmployerReport;
}
```

### Wiring via a response interceptor

Rather than calling `filterForAudience` in every service method, a dedicated interceptor applies it automatically to any handler decorated with `@AudienceFiltered()`:

```ts
// apps/api/src/common/interceptors/audience-serializer.interceptor.ts
import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { filterForAudience } from "../../reports/utils/filter-for-audience";
import { deriveAudience } from "../../reports/utils/derive-audience";

export const AUDIENCE_FILTERED_KEY = "audienceFiltered";
export const AudienceFiltered = () => SetMetadata(AUDIENCE_FILTERED_KEY, true);

@Injectable()
export class AudienceSerializerInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isFiltered = this.reflector.getAllAndOverride<boolean>(AUDIENCE_FILTERED_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!isFiltered) return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const audience = deriveAudience(req.user, req.resolvedShare); // set by ShareGuard

    return next.handle().pipe(
      map((data) => {
        if (!data?.run) return data;   // not a report response
        return filterForAudience({ run: data.run, profileId: data.profileId, audience, improvementGuidance: data.improvementGuidance });
      }),
    );
  }
}
```

```ts
// apps/api/src/reports/reports.controller.ts
@Get(":profileId/report")
@AudienceFiltered()                          // interceptor applies filterForAudience
@UseGuards(ShareGuard)                       // resolves & attaches req.resolvedShare
async getReport(@Param("profileId") profileId: string) {
  // Returns { run: ScoreRun, profileId, improvementGuidance } — raw, unfiltered
  return this.reportsService.getLatestRun(profileId);
}
```

### Why client-side filtering is forbidden

The `employer-only` field on each parameter is **not exposed in the candidate API response** — there is no query parameter, header, or flag that allows a candidate to request hidden items. The client receives a response that simply does not contain the sensitive fields. This is enforced by the server-side `filterForAudience` step; the client cannot bypass it.

---

## (i) HTTP Status Code Conventions

Every NestJS handler must return the correct status code. Use `@HttpCode()` on handlers that deviate from the NestJS defaults (`200` for `GET`/`PATCH`/`DELETE`, `201` for `POST`).

| Code | When to use |
|------|-------------|
| `200 OK` | Successful read, update, or replayed idempotent run. |
| `201 Created` | New resource created: register, profile, submission (first save), score run, share grant, document record, verification request. |
| `202 Accepted` | Async job accepted — the result will not be immediately available: PDF render, data-deletion request. |
| `204 No Content` | Successful deletion or logout. No body. |
| `400 Bad Request` | Malformed or structurally invalid request that does not fail schema validation — e.g. missing required `Idempotency-Key`. |
| `401 Unauthorized` | Missing, expired, or invalid JWT; replayed refresh token (`token-reuse-detected`). |
| `403 Forbidden` | Authenticated but insufficient role; not the resource owner; employer/recruiter without an accepted share (`consent-required`). |
| `404 Not Found` | Unknown resource ID. |
| `409 Conflict` | Duplicate resource (e.g. email already registered); state machine violation (already approved/rejected); idempotency key+body mismatch. |
| `410 Gone` | Expired share grant or claim token (`share-expired`). |
| `413 Payload Too Large` | Upload `sizeBytes` exceeds the per-`DocumentKind` limit. |
| `415 Unsupported Media Type` | `contentType` not in the allow-list (only `application/pdf`, `image/png`, `image/jpeg`). |
| `422 Unprocessable Entity` | Zod validation failure on a well-formed request — response always includes `errors[]`. |
| `429 Too Many Requests` | Rate bucket exceeded — response includes `Retry-After`. |
| `500 Internal Server Error` | Unhandled exception. |
| `503 Service Unavailable` | Upstream dependency unreachable (MinIO, Ollama) — response includes `Retry-After`. |

### `@HttpCode` usage pattern

```ts
@Post()
@HttpCode(201)          // NestJS default for POST, shown explicitly for clarity
async create(/* ... */) { /* ... */ }

@Delete(":id")
@HttpCode(204)
async remove(@Param("id") id: string) {
  await this.service.delete(id);
  // return nothing — 204 No Content
}

@Post(":id/accept")
@HttpCode(200)          // action endpoint, not creating a new resource
async accept(/* ... */) { /* ... */ }
```

---

## (j) Correlation / Request IDs

Every request should be traceable from the client log entry to the server log entry to the problem+json error response. Stabil uses **`X-Request-Id`** for this.

### Convention

| Direction | Behavior |
|-----------|----------|
| Client sends `X-Request-Id` | The value is echoed back in the response header and included in `requestId` of any problem+json error. |
| Client omits the header | The API generates a new UUID v7 and treats it as the request id for that request. |
| Response always includes `X-Request-Id` | Regardless of whether the request included one. |

### Middleware implementation

```ts
// apps/api/src/common/middleware/request-id.middleware.ts
import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { generateUUIDv7 } from "../utils/uuid";   // wrapper around your preferred v7 lib

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id = (req.headers["x-request-id"] as string) || generateUUIDv7();
    req.headers["x-request-id"] = id;        // normalize: ensure downstream code always finds it
    res.setHeader("X-Request-Id", id);        // echo back in response
    next();
  }
}
```

Register it globally in `AppModule`:

```ts
// apps/api/src/app.module.ts
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}
```

### Accessing the request ID in services and filters

Since the middleware normalizes `req.headers["x-request-id"]` before the handler runs, any code that has access to the request object can read it:

```ts
// In the ProblemFilter (see §b above) — already shown:
const requestId: string = req.headers["x-request-id"] as string ?? "";

// In a service that needs to attach it to logs:
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  async createRun(dto: CreateScoreRunDto, user: AccessClaims, requestId: string) {
    this.logger.log(`Score run started`, { requestId, profileId: dto.profileId, userId: user.sub });
    // ... scoring logic
  }
}
```

### Structured log format

Every log entry should include the request ID so all log lines for a single request can be correlated in the observability stack:

```json
{
  "level": "info",
  "timestamp": "2026-06-06T11:00:00.000Z",
  "context": "ScoringService",
  "message": "Score run started",
  "requestId": "0190c3fa-...",
  "profileId": "0190b2...",
  "userId": "0190a1..."
}
```

---

## Cross-references

- **Full endpoint catalogue + DTO shapes:** [architecture/04-api-contracts.md](../architecture/04-api-contracts.md) — authoritative.
- **Security, PII handling, consent, and token storage threat model:** [architecture/05-security-privacy.md](../architecture/05-security-privacy.md).
- **NestJS module-by-module implementation guidance:** [backend/modules/](./modules/).
- **Logging, config, secret management, and observability:** [backend/best-practices.md](./best-practices.md).
- **Scoring engine internals, `Visibility` field, and `AudienceScoreResult`:** [architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md).
