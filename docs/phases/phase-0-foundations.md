# Phase 0 — Foundations

> **Status:** Draft v0.1 · **Phase:** 0 · **Owner area:** infra / backend / frontend
> **Related:** [SCOPE.md](../SCOPE.md) · [CLOUD.md](../CLOUD.md) · [backend/README.md](../backend/README.md) · [frontend/README.md](../frontend/README.md) · [architecture/01-overview.md](../architecture/01-overview.md) · [Phase 1](./phase-1-core-scoring.md)

Phase 0 is the **plumbing sprint**: every runtime, package boundary, tool, and CI gate that every later phase builds on. When this phase is done the workspace compiles cleanly, the local dev environment boots from a single command, and a real HTTP request (register → login → JWT) traverses the full stack. Nothing product-facing is built yet; this phase exists so Phase 1 never has to stop and wire infrastructure.

---

## Goal & outcomes

| # | Outcome | Observable evidence |
|---|---------|---------------------|
| 1 | All packages and apps build with Turborepo | `pnpm build` exits 0, all `dist/` artefacts present |
| 2 | TypeScript is strict across the monorepo | `pnpm typecheck` exits 0 |
| 3 | Lint + format pass | `pnpm lint` exits 0; `prettier --check` passes |
| 4 | All package unit tests pass | `pnpm test` exits 0 |
| 5 | Local infra boots | `docker compose up -d` → Postgres, MinIO, Ollama healthy |
| 6 | Database is migrated | `prisma migrate deploy` applies the baseline migration; `User` + `AuthIdentity` tables exist |
| 7 | Auth vertical slice works | `POST /api/v1/auth/register` + `POST /api/v1/auth/login` return a signed JWT |
| 8 | CI is green | GitHub Actions workflow passes on every push to `main` and every PR |

---

## In scope / Out of scope

### In scope

- Monorepo tooling: pnpm workspaces, Turborepo, root scripts
- Shared packages: `packages/types`, `packages/config`, `packages/core` (rubric layer scaffold)
- App scaffolds that build and run as empty shells: `apps/api`, `apps/web`, `apps/mobile`
- Prisma schema + first migration (`User`, `AuthIdentity` tables)
- Thin auth vertical slice: register / login → JWT (proves the stack end-to-end)
- Local `docker-compose.yml`: Postgres, MinIO, Ollama
- GitHub Actions CI: install → lint → typecheck → test → build, with Turborepo remote cache
- Tooling: ESLint, Prettier, Commitlint + Husky (conventional commits)
- Baseline error model (RFC 9457 `application/problem+json`) in the API
- Structured JSON logging in `apps/api` (Pino)

### Out of scope (Phase 1+)

- Any scoring logic beyond what `packages/scoring` already provides
- The rubric layer implementation inside `packages/core` (scaffold only here; logic in Phase 1)
- Profile, report, document-upload, or consent flows
- MinIO file operations (wired in Phase 2)
- Ollama / AI parsing (wired in Phase 2)
- `packages/ui` shared component library (optional; can be added mid-Phase 1 if needed)
- Playwright e2e tests (Phase 1)
- PDF generation (Phase 1)

---

## Workstreams

| Workstream | What it covers |
|------------|----------------|
| **WS-A** Shared packages | `packages/types`, `packages/config`, `packages/core` scaffold |
| **WS-B** App scaffolds | `apps/api`, `apps/web`, `apps/mobile` empty shells |
| **WS-C** Data layer | Prisma schema, first migration, Postgres in Docker |
| **WS-D** Auth slice | `auth` NestJS module: register / login / JWT guard |
| **WS-E** Infra | `docker-compose.yml`, MinIO, Ollama (no usage yet) |
| **WS-F** CI | GitHub Actions workflow, Turborepo remote cache config |
| **WS-G** Tooling | ESLint, Prettier, Commitlint, Husky, `.editorconfig` |
| **WS-H** Observability foundations | Pino logger, RFC 9457 error filter |

WS-A must land before WS-B; WS-C must land before WS-D. Everything else can proceed in parallel once WS-A is done.

---

## Detailed task breakdown

### WS-A · Shared packages

#### A1 · `packages/config` — shared tooling configs

```
packages/config/
├── package.json            # name: @stabil/config, private: true
├── eslint/
│   └── base.js             # shared flat ESLint config (re-exported)
├── typescript/
│   └── base.json           # extends ../../tsconfig.base.json
│   └── nestjs.json         # extends base, lib: ["ES2022","dom.iterable"]
│   └── nextjs.json         # extends base, adds "dom", jsx: "preserve"
│   └── react-native.json   # extends base for Expo
└── prettier/
    └── index.js            # single shared Prettier config
```

- [ ] Create `packages/config/package.json`:
  ```json
  {
    "name": "@stabil/config",
    "version": "0.0.0",
    "private": true,
    "exports": {
      "./eslint/base": "./eslint/base.js",
      "./typescript/*": "./typescript/*.json",
      "./prettier": "./prettier/index.js"
    }
  }
  ```
- [ ] Write shared ESLint flat config (`eslint/base.js`) — rules: `@typescript-eslint/recommended`, `no-console` as warn, `import/order` enforced, `prettier` last.
- [ ] Write `prettier/index.js` — `{ semi: true, singleQuote: true, trailingComma: "all", printWidth: 100, tabWidth: 2 }`.
- [ ] Write `typescript/base.json` extending `../../tsconfig.base.json`.
- [ ] Write `typescript/nestjs.json`, `typescript/nextjs.json`, `typescript/react-native.json` extending base with environment-specific lib/jsx adjustments.
- [ ] Verify: `pnpm --filter @stabil/config build` (no build needed — config only; add a no-op `build` script that exits 0).

#### A2 · `packages/types` — shared Zod schemas + TS types

```
packages/types/
├── package.json            # name: @stabil/types
├── tsconfig.json           # extends @stabil/config/typescript/base
├── src/
│   ├── index.ts
│   ├── auth.ts             # RegisterDto, LoginDto, TokenPayload schemas
│   ├── user.ts             # UserRole enum, UserDto schema
│   └── common.ts           # ProblemDetail (RFC 9457), PaginatedResponse, UuidV7
└── vitest.config.ts
```

- [ ] Create `packages/types/package.json`:
  ```json
  {
    "name": "@stabil/types",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "test": "vitest run"
    },
    "dependencies": { "zod": "^3.23.8" },
    "devDependencies": {
      "@stabil/config": "workspace:*",
      "typescript": "^5.7.3",
      "vitest": "^2.1.8"
    }
  }
  ```
- [ ] Define `UserRole`:
  ```ts
  export const UserRole = z.enum(["candidate", "employer", "recruiter", "admin"]);
  export type UserRole = z.infer<typeof UserRole>;
  ```
- [ ] Define `RegisterDto`:
  ```ts
  export const RegisterDto = z.object({
    email: z.string().email(),
    password: z.string().min(8).max(128),
    role: UserRole,
    displayName: z.string().min(1).max(120),
  });
  export type RegisterDto = z.infer<typeof RegisterDto>;
  ```
- [ ] Define `LoginDto`:
  ```ts
  export const LoginDto = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  export type LoginDto = z.infer<typeof LoginDto>;
  ```
- [ ] Define `TokenPayload`:
  ```ts
  export const TokenPayload = z.object({
    sub: z.string().uuid(),   // user.id (UUID v7)
    email: z.string().email(),
    role: UserRole,
    iat: z.number().optional(),
    exp: z.number().optional(),
  });
  export type TokenPayload = z.infer<typeof TokenPayload>;
  ```
- [ ] Define `ProblemDetail` (RFC 9457):
  ```ts
  export const ProblemDetail = z.object({
    type: z.string().url().optional(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string().optional(),
    instance: z.string().optional(),
  });
  export type ProblemDetail = z.infer<typeof ProblemDetail>;
  ```
- [ ] Write unit tests in `src/auth.test.ts` validating schema parse / refine edge cases (invalid email, short password, unknown role).
- [ ] `pnpm --filter @stabil/types test` green.

#### A3 · `packages/core` — rubric layer scaffold

`packages/core` is the **rubric layer**: it maps raw answers (GPA bands, years of experience, boolean flags, etc.) into normalized `[0,1]` fractions that `@stabil/scoring` consumes. The engine boundary is: **`@stabil/scoring` only sees fractions; raw-to-fraction conversion belongs here** (see README.md conventions cheat-sheet).

In Phase 0 this package is a **scaffold** — the directory and interface contracts are established, but parameter-specific rubric implementations are stubs returning `0`. Full implementations land in Phase 1.

```
packages/core/
├── package.json            # name: @stabil/core
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── types.ts            # RubricInput, RubricOutput, IRubric<T> interface
│   ├── rubrics/
│   │   ├── index.ts        # barrel
│   │   ├── academics.ts    # stub → returns 0
  │   │   ├── tenure.ts       # stub → returns 0
  │   │   └── ... (one stub per parameter from SCOPE.md §4.3–4.5)
  │   └── normalize.ts      # normalizeAnswers(input, config): ParameterValues
  └── __tests__/
      └── normalize.test.ts # verifies output keys are in [0,1]; stubs return 0
```

- [ ] Create `packages/core/package.json`:
  ```json
  {
    "name": "@stabil/core",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
    "scripts": {
      "build": "tsc -p tsconfig.json",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "test": "vitest run"
    },
    "dependencies": {
      "@stabil/scoring": "workspace:*",
      "@stabil/types": "workspace:*"
    },
    "devDependencies": {
      "@stabil/config": "workspace:*",
      "typescript": "^5.7.3",
      "vitest": "^2.1.8"
    }
  }
  ```
- [ ] Define `IRubric<TInput>` interface:
  ```ts
  export interface IRubric<TInput> {
    /** The parameter key this rubric maps to (matches ParameterDefinition.key). */
    readonly key: string;
    /** Map raw answer → normalized fraction in [0, 1]. */
    toFraction(input: TInput): number;
  }
  ```
- [ ] Define `normalizeAnswers(rawAnswers: RawAnswers, rubrics: IRubric<unknown>[]): ParameterValues` — iterates rubrics, calls `toFraction`, clamps result to `[0, 1]`, returns a `ParameterValues` record.
- [ ] Add one stub per SCOPE.md parameter (§4.3–4.5): academics, projects, certifications, aiFamiliarity, cloudExposure, relocation, flexibility, workMode, programmingLanguages, totalExperience, tenure, spokenLanguages, maritalStatus, age, communication, location, verificationStatus. Each stub: `toFraction(_: unknown): number { return 0; }`.
- [ ] Unit tests: `normalizeAnswers` clamps values to `[0,1]`, returns 0 for stubs, returns keys matching config.
- [ ] Turbo: `packages/core` builds after `@stabil/scoring` and `@stabil/types`.

---

### WS-B · App scaffolds

#### B1 · `apps/api` — NestJS shell

```
apps/api/
├── package.json
├── tsconfig.json           # extends @stabil/config/typescript/nestjs
├── tsconfig.build.json     # excludes test files
├── nest-cli.json
├── src/
│   ├── main.ts             # bootstrap; listens on PORT env var (default 3001)
│   ├── app.module.ts       # root module
│   └── health/
│       ├── health.controller.ts   # GET /api/v1/health → { status: "ok" }
│       └── health.module.ts
├── test/
│   └── app.e2e-spec.ts     # supertest: GET /api/v1/health → 200
└── .env.example
```

- [ ] Scaffold with NestJS CLI:
  ```bash
  pnpm dlx @nestjs/cli new apps/api --package-manager pnpm --skip-git --strict
  ```
  Then strip the generated boilerplate down to the structure above.
- [ ] Set global API prefix in `main.ts`:
  ```ts
  app.setGlobalPrefix("api/v1");
  ```
- [ ] Enable `ValidationPipe` globally with `whitelist: true, forbidNonWhitelisted: true, transform: true`.
- [ ] Add `@stabil/types` and `@stabil/config` as workspace deps.
- [ ] Wire `ConfigModule.forRoot({ isGlobal: true, envFilePath: ".env" })`.
- [ ] `GET /api/v1/health` returns `200 { status: "ok", version: "0" }`.
- [ ] Verify: `pnpm --filter @stabil/api build` and `pnpm --filter @stabil/api test:e2e` green.

#### B2 · `apps/web` — Next.js 15 shell

```
apps/web/
├── package.json
├── tsconfig.json           # extends @stabil/config/typescript/nextjs
├── next.config.ts
├── tailwind.config.ts
├── postcss.config.mjs
├── src/
│   └── app/
│       ├── layout.tsx      # root layout, Inter font, Tailwind base
│       ├── page.tsx        # landing stub: "Stabil — coming soon"
│       └── globals.css
└── components.json         # shadcn/ui config
```

- [ ] Create with:
  ```bash
  pnpm dlx create-next-app@latest apps/web \
    --typescript --tailwind --eslint --app --src-dir \
    --import-alias "@/*" --no-git
  ```
- [ ] Initialize shadcn/ui:
  ```bash
  pnpm --filter @stabil/web dlx shadcn@latest init
  ```
  Accept defaults; choose Slate base color; CSS variables on.
- [ ] Add `@stabil/types` as a workspace dep.
- [ ] `next.config.ts` — set `transpilePackages: ["@stabil/types", "@stabil/core"]`.
- [ ] Confirm `pnpm --filter @stabil/web build` exits 0.

#### B3 · `apps/mobile` — Expo shell

```
apps/mobile/
├── package.json
├── tsconfig.json           # extends @stabil/config/typescript/react-native
├── app.json                # Expo config: name "Stabil", slug "stabil"
├── babel.config.js         # expo preset + NativeWind
├── metro.config.js
├── tailwind.config.js      # NativeWind; content: ./app/**/*.tsx
├── global.css              # Tailwind base directive
└── app/
    ├── _layout.tsx         # Expo Router root layout
    └── index.tsx           # stub screen: <Text>Stabil</Text>
```

- [ ] Create with:
  ```bash
  pnpm dlx create-expo-app@latest apps/mobile --template blank-typescript
  ```
- [ ] Install NativeWind:
  ```bash
  pnpm --filter @stabil/mobile add nativewind tailwindcss
  pnpm --filter @stabil/mobile add -D prettier-plugin-tailwindcss
  ```
- [ ] Install Expo Router:
  ```bash
  pnpm --filter @stabil/mobile add expo-router
  ```
- [ ] Set `main` in `package.json` to `expo-router/entry`.
- [ ] Add `@stabil/types` as workspace dep.
- [ ] Confirm `pnpm --filter @stabil/mobile typecheck` exits 0 (Expo build is device-only; CI checks typecheck only).

---

### WS-C · Data layer

#### C1 · Prisma schema

File: `apps/api/prisma/schema.prisma`

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

/// Every person who has an account in the system.
model User {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email       String   @unique @db.VarChar(254)
  displayName String   @map("display_name") @db.VarChar(120)
  role        UserRole @default(candidate)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  authIdentities AuthIdentity[]

  @@map("users")
}

/// One row per authentication method for a User (local password, future OAuth).
model AuthIdentity {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId       String   @map("user_id") @db.Uuid
  provider     String   @db.VarChar(32)   // "local" | "google" | …
  providerId   String   @map("provider_id") @db.VarChar(254)
  /// bcrypt hash; null for OAuth-only identities.
  passwordHash String?  @map("password_hash") @db.VarChar(72)
  createdAt    DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerId])
  @@map("auth_identities")
}

enum UserRole {
  candidate
  employer
  recruiter
  admin
}
```

> IDs use PostgreSQL's `gen_random_uuid()` (UUID v4). UUID v7 ordered IDs will be introduced in a later migration once requirements are better understood; the convention in `README.md` covers the future state. Using `gen_random_uuid()` here avoids a custom extension dependency on the initial migration.

- [ ] Create `apps/api/prisma/schema.prisma` with the content above.
- [ ] Run initial migration:
  ```bash
  cd apps/api
  pnpm prisma migrate dev --name init
  ```
  This creates `prisma/migrations/YYYYMMDDHHMMSS_init/migration.sql`.
- [ ] Generate Prisma client:
  ```bash
  pnpm prisma generate
  ```
- [ ] Add `postinstall` script in `apps/api/package.json`:
  ```json
  "postinstall": "prisma generate"
  ```
- [ ] Add `DATABASE_URL` to `apps/api/.env.example`:
  ```
  DATABASE_URL=postgresql://stabil:stabil@localhost:5432/stabil
  ```
- [ ] Wire `PrismaModule` as a global NestJS module exporting `PrismaService`:
  ```ts
  // apps/api/src/prisma/prisma.service.ts
  import { Injectable, OnModuleInit } from "@nestjs/common";
  import { PrismaClient } from "@prisma/client";

  @Injectable()
  export class PrismaService extends PrismaClient implements OnModuleInit {
    async onModuleInit() {
      await this.$connect();
    }
  }
  ```
- [ ] Verify: `pnpm --filter @stabil/api build` picks up generated types; `pnpm prisma validate` passes.

#### C2 · Seeding

- [ ] Create `apps/api/prisma/seed.ts` — inserts one `admin` user with a known bcrypt hash for local dev only. Guarded by `NODE_ENV !== "production"`.
- [ ] Add seed script to `apps/api/package.json`:
  ```json
  "prisma": { "seed": "ts-node -r tsconfig-paths/register prisma/seed.ts" }
  ```

---

### WS-D · Auth vertical slice

#### D1 · `AuthModule` in NestJS

```
apps/api/src/auth/
├── auth.module.ts
├── auth.controller.ts       # POST /auth/register, POST /auth/login
├── auth.service.ts
├── dto/
│   ├── register.dto.ts      # re-exports + adapts @stabil/types RegisterDto → class-validator
│   └── login.dto.ts
├── strategies/
│   └── jwt.strategy.ts      # PassportStrategy(Strategy, "jwt")
├── guards/
│   └── jwt-auth.guard.ts    # extends AuthGuard("jwt")
└── decorators/
    └── current-user.ts      # @CurrentUser() param decorator → TokenPayload
```

- [ ] Install dependencies:
  ```bash
  pnpm --filter @stabil/api add \
    @nestjs/passport @nestjs/jwt passport passport-jwt bcrypt
  pnpm --filter @stabil/api add -D @types/passport-jwt @types/bcrypt
  ```
- [ ] `AuthService.register(dto: RegisterDto)`:
  1. Check `prisma.user.findUnique({ where: { email } })` — throw `ConflictException` if exists.
  2. Hash password with `bcrypt.hash(password, 12)`.
  3. Create `User` + `AuthIdentity` in a single `prisma.$transaction`.
  4. Return `TokenPayload` signed as JWT (15 min access token; refresh out of scope for Phase 0).
- [ ] `AuthService.login(dto: LoginDto)`:
  1. Find user + local identity by email.
  2. `bcrypt.compare(password, hash)` — throw `UnauthorizedException` on mismatch.
  3. Sign and return JWT.
- [ ] `JwtStrategy` validates `TokenPayload` (uses `@stabil/types`).
- [ ] `JwtAuthGuard` guards any route that requires authentication.
- [ ] `POST /api/v1/auth/register` → `201 { accessToken: string }`.
- [ ] `POST /api/v1/auth/login` → `200 { accessToken: string }`.
- [ ] Add a protected smoke-test route: `GET /api/v1/auth/me` → `200 TokenPayload` (requires JWT; proves the guard works).
- [ ] Environment variables required (add to `.env.example`):
  ```
  JWT_SECRET=changeme-at-least-32-chars
  JWT_EXPIRES_IN=15m
  ```

#### D2 · RFC 9457 error filter

- [ ] Create `apps/api/src/common/filters/problem.filter.ts`:
  ```ts
  import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from "@nestjs/common";
  import type { Response } from "express";
  import type { ProblemDetail } from "@stabil/types";

  @Catch(HttpException)
  export class ProblemFilter implements ExceptionFilter {
    catch(exception: HttpException, host: ArgumentsHost) {
      const ctx = host.switchToHttp();
      const res = ctx.getResponse<Response>();
      const status = exception.getStatus();
      const body: ProblemDetail = {
        type: `https://stabil.app/errors/${status}`,
        title: exception.message,
        status,
        detail: typeof exception.getResponse() === "object"
          ? (exception.getResponse() as { message?: string }).message?.toString()
          : undefined,
      };
      res.status(status).type("application/problem+json").json(body);
    }
  }
  ```
- [ ] Register globally in `main.ts`:
  ```ts
  app.useGlobalFilters(new ProblemFilter());
  ```
- [ ] Write a unit test asserting a `404` response has `Content-Type: application/problem+json`.

#### D3 · Structured logging (Pino)

- [ ] Install:
  ```bash
  pnpm --filter @stabil/api add nestjs-pino pino-http pino-pretty
  ```
- [ ] Wire `LoggerModule.forRoot({ pinoHttp: { level: process.env.LOG_LEVEL ?? "info" } })` in `AppModule`.
- [ ] All services use NestJS `Logger` (backed by Pino in production; human-readable `pino-pretty` in dev via `NODE_ENV=development`).
- [ ] Log fields: `requestId` (UUID), `method`, `url`, `statusCode`, `responseTimeMs`.

---

### WS-E · Local infrastructure (`docker-compose.yml`)

File: `docker-compose.yml` at the **monorepo root**.

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: stabil
      POSTGRES_PASSWORD: stabil
      POSTGRES_DB: stabil
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stabil"]
      interval: 5s
      timeout: 3s
      retries: 10

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: stabil
      MINIO_ROOT_PASSWORD: stabil123
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5

  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    # Pull a small model on first start (optional; comment out if offline)
    # entrypoint: ["/bin/sh", "-c", "ollama serve & sleep 5 && ollama pull llama3.2:3b && wait"]

volumes:
  postgres_data:
  minio_data:
  ollama_data:
```

- [ ] Create `docker-compose.yml` at monorepo root with the content above.
- [ ] Create `.env.example` at monorepo root (for developers):
  ```
  # Postgres
  DATABASE_URL=postgresql://stabil:stabil@localhost:5432/stabil

  # MinIO
  MINIO_ENDPOINT=localhost
  MINIO_PORT=9000
  MINIO_ACCESS_KEY=stabil
  MINIO_SECRET_KEY=stabil123

  # Ollama
  OLLAMA_BASE_URL=http://localhost:11434

  # Auth
  JWT_SECRET=changeme-at-least-32-chars
  JWT_EXPIRES_IN=15m
  LOG_LEVEL=info
  ```
- [ ] Document startup in `CLOUD.md` and add a `dev:infra` script to root `package.json`:
  ```json
  "dev:infra": "docker compose up -d"
  ```
- [ ] Verify: `docker compose up -d && docker compose ps` shows all three services `healthy`.

---

### WS-F · CI (GitHub Actions)

File: `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ secrets.TURBO_TEAM }}
  DATABASE_URL: postgresql://stabil:stabil@localhost:5432/stabil
  JWT_SECRET: ci-secret-not-for-production

jobs:
  ci:
    name: Install → Lint → Typecheck → Test → Build
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: stabil
          POSTGRES_PASSWORD: stabil
          POSTGRES_DB: stabil
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready -U stabil"
          --health-interval=5s
          --health-timeout=3s
          --health-retries=10

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run Prisma migrations
        run: pnpm --filter @stabil/api prisma migrate deploy

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build
```

- [ ] Create `.github/workflows/ci.yml` with the content above.
- [ ] Add `TURBO_TOKEN` and `TURBO_TEAM` as GitHub Actions secrets (for Turborepo Remote Cache via Vercel). If remote cache is not yet configured, omit the `TURBO_*` env vars; Turborepo falls back to local cache.
- [ ] Confirm that Turbo's `pipeline` in `turbo.json` correctly declares `^build` deps so packages build in topological order.
- [ ] Verify: first push to `main` produces a green check.

---

### WS-G · Tooling

#### G1 · ESLint

- [ ] Install root-level ESLint dependencies:
  ```bash
  pnpm add -Dw eslint @typescript-eslint/eslint-plugin @typescript-eslint/parser \
    eslint-plugin-import eslint-config-prettier eslint-plugin-prettier
  ```
- [ ] Create `eslint.config.js` at monorepo root (flat config):
  ```js
  import base from "@stabil/config/eslint/base";
  export default [...base];
  ```
- [ ] Each app/package has its own `eslint.config.js` extending base and adding framework-specific rules (NestJS: `@nestjs/eslint-plugin`; Next.js: `eslint-config-next`; Expo: `eslint-config-expo`).
- [ ] Add `"lint"` script to each `package.json`: `"lint": "eslint src --max-warnings 0"`.

#### G2 · Prettier

- [ ] Install:
  ```bash
  pnpm add -Dw prettier
  ```
- [ ] Create `prettier.config.js` at monorepo root re-exporting `@stabil/config/prettier`.
- [ ] Create `.prettierignore`: `dist/`, `node_modules/`, `*.gen.ts`, `prisma/migrations/`.
- [ ] Add `"format:check"` script to root: `"format:check": "prettier --check \"**/*.{ts,tsx,js,json,md}\""`.

#### G3 · Commitlint + Husky (conventional commits)

- [ ] Install:
  ```bash
  pnpm add -Dw @commitlint/config-conventional @commitlint/cli husky
  ```
- [ ] Create `commitlint.config.js`:
  ```js
  export default { extends: ["@commitlint/config-conventional"] };
  ```
- [ ] Initialize Husky:
  ```bash
  pnpm dlx husky init
  ```
- [ ] Add hooks:
  ```bash
  # .husky/commit-msg — enforces conventional commit format
  echo "pnpm commitlint --edit \$1" > .husky/commit-msg

  # .husky/pre-commit — fast checks only
  echo "pnpm lint-staged" > .husky/pre-commit
  ```
- [ ] Install `lint-staged` and add config to root `package.json`:
  ```json
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix --max-warnings 0", "prettier --write"],
    "*.{json,md}": ["prettier --write"]
  }
  ```
- [ ] Valid commit example: `feat(auth): add JWT registration endpoint`
- [ ] Invalid commit must be rejected by hook.

#### G4 · `.editorconfig`

- [ ] Create `.editorconfig` at monorepo root:
  ```ini
  root = true

  [*]
  indent_style = space
  indent_size = 2
  end_of_line = lf
  charset = utf-8
  trim_trailing_whitespace = true
  insert_final_newline = true

  [*.md]
  trim_trailing_whitespace = false
  ```

---

### WS-H · Observability foundations

These are already covered partially in WS-D3 (Pino). Additional checklist:

- [ ] `requestId` middleware in `apps/api` assigns a UUID to each incoming request via `AsyncLocalStorage` so all log lines within a request share the same ID.
- [ ] A `LoggingInterceptor` logs `→ req` at `debug` and `← res` at `info` with `responseTimeMs`.
- [ ] `NODE_ENV` is validated at startup (must be `development` | `test` | `production`); missing fails fast with a clear error.
- [ ] All sensitive env vars (`JWT_SECRET`, `DATABASE_URL`) are validated at startup using a NestJS `ConfigService` + Zod schema; missing or malformed values throw on boot, not at runtime.

---

## Deliverables

| Deliverable | Location | Notes |
|-------------|----------|-------|
| `packages/config` | `packages/config/` | Shared ESLint, Prettier, TSConfig |
| `packages/types` | `packages/types/` | Zod schemas for auth DTOs, ProblemDetail |
| `packages/core` scaffold | `packages/core/` | IRubric interface + stubs; not yet implemented |
| `apps/api` shell | `apps/api/` | NestJS; health + auth endpoints; Pino; RFC 9457 |
| `apps/web` shell | `apps/web/` | Next.js 15 App Router + Tailwind + shadcn/ui |
| `apps/mobile` shell | `apps/mobile/` | Expo + Expo Router + NativeWind |
| Prisma schema + migration | `apps/api/prisma/` | `users` + `auth_identities` tables |
| `docker-compose.yml` | repo root | Postgres, MinIO, Ollama |
| GitHub Actions CI | `.github/workflows/ci.yml` | Full pipeline with Turbo cache |
| Tooling | repo root | ESLint, Prettier, Commitlint, Husky, `.editorconfig` |
| Env example files | repo root + `apps/api/` | `.env.example` with all required vars |

---

## Acceptance criteria (Definition of Done)

All of the following must be true before Phase 0 is closed.

### Build & type safety

- [ ] `pnpm build` exits 0 across all packages and apps (Turborepo topological order).
- [ ] `pnpm typecheck` exits 0 across all packages and apps.
- [ ] No TypeScript `any` escapes in shared packages (`packages/*`); `strict: true` enforced.

### Lint & format

- [ ] `pnpm lint` exits 0 with `--max-warnings 0`.
- [ ] `pnpm format:check` exits 0.

### Tests

- [ ] `pnpm test` exits 0. Minimum coverage:
  - `packages/types` — all Zod schemas parse valid inputs and reject invalid ones.
  - `packages/core` — `normalizeAnswers` clamps to `[0,1]`; each stub returns 0.
  - `packages/scoring` — already passing (not regressed).
  - `apps/api` — RFC 9457 filter unit test; auth service unit tests (register, login, conflict, wrong password).
  - `apps/api` e2e — `GET /api/v1/health → 200`, `POST /api/v1/auth/register → 201`, `POST /api/v1/auth/login → 200 with JWT`, `GET /api/v1/auth/me → 200 with valid token`, `GET /api/v1/auth/me → 401 without token`.

### Infrastructure

- [ ] `docker compose up -d` brings Postgres, MinIO, and Ollama to `healthy` status.
- [ ] `pnpm --filter @stabil/api prisma migrate deploy` applies the baseline migration against the Docker Postgres instance without errors.
- [ ] `psql postgresql://stabil:stabil@localhost:5432/stabil -c "\d"` shows `users` and `auth_identities` tables.

### Auth vertical slice (end-to-end)

- [ ] `POST /api/v1/auth/register` with a valid body returns `201 { accessToken: "<jwt>" }`.
- [ ] Decoding the JWT (e.g. with `jwt.io`) reveals `{ sub, email, role, iat, exp }` matching `TokenPayload`.
- [ ] `POST /api/v1/auth/login` with the same credentials returns `200 { accessToken: "<jwt>" }`.
- [ ] `GET /api/v1/auth/me` with `Authorization: Bearer <jwt>` returns `200 TokenPayload`.
- [ ] `GET /api/v1/auth/me` without a token returns `401 application/problem+json`.

### CI

- [ ] GitHub Actions CI workflow passes (green) on `main` and on a test PR.
- [ ] Turborepo cache hits are visible in CI logs after the second run (task summary shows `FULL TURBO` or cache hit indicators).

### Tooling

- [ ] A commit with a non-conventional message (e.g. `"stuff"`) is rejected by the `commit-msg` Husky hook.
- [ ] A valid commit (`feat(auth): ...`) is accepted.

---

## Test strategy

### Unit tests (Vitest)

Every shared package and the API service layer is unit-tested with Vitest. Tests live in `src/__tests__/` or co-located `*.test.ts` files.

| Target | What is tested |
|--------|----------------|
| `packages/types` auth schemas | Parse/reject: valid email, invalid email, short password, unknown role, extra fields |
| `packages/core` normalize | Clamp to `[0,1]`; missing rubric key returns 0; stub rubrics return 0 |
| `packages/scoring` | Existing tests (must not regress) |
| `apps/api` `AuthService` | Register success, duplicate email conflict, login success, wrong password |
| `apps/api` `ProblemFilter` | 404 → `application/problem+json` with correct shape |

### E2E / integration tests (Supertest + NestJS testing module)

`apps/api/test/` contains integration tests that spin up the NestJS application in-process against a real test database (separate `stabil_test` DB in the same Postgres container; created during CI by `prisma migrate deploy`).

```
DATABASE_URL=postgresql://stabil:stabil@localhost:5432/stabil_test
```

Tests reset state between runs using `prisma.user.deleteMany()` in `beforeEach`.

### No e2e browser tests in Phase 0

Playwright is listed in the stack but not set up until Phase 1, when there are actual pages to test.

### CI matrix

Phase 0 CI runs a single job. Multi-node matrix (e.g. per-app) is introduced in Phase 1 as the test suite grows.

---

## Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| None — Phase 0 is the foundation | — | Everything else depends on Phase 0 |

### External pre-requisites for contributors

- Docker Desktop (or compatible Docker daemon) installed locally.
- Node.js ≥ 20 installed (matches `engines` in root `package.json`).
- pnpm ≥ 9 installed (`npm i -g pnpm` or via `corepack enable`).
- A `TURBO_TOKEN` and `TURBO_TEAM` secret in the GitHub repository settings (optional; CI degrades gracefully to local cache without them).

---

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Expo + NativeWind version conflicts (peer deps can be brittle) | Medium | Medium | Pin to a known-good version triplet from Expo's compatibility table; use `--legacy-peer-deps` only as a last resort, noted in comments |
| NestJS module resolution with ESM-first workspace packages | Medium | High | `@stabil/types` and `@stabil/core` export via `exports` map with `default` pointing to `.ts` source; NestJS compiles with `tsc`, not Vite, so ensure `tsconfig.build.json` includes the right `paths`; test early |
| Prisma client type generation not picked up in CI | Low | High | `postinstall: prisma generate` in `apps/api/package.json` ensures generation on every `pnpm install`; CI runs `pnpm install --frozen-lockfile` which triggers postinstall |
| Docker not available in the CI runner for service containers | Low | Low | GitHub-hosted `ubuntu-latest` runners support Docker service containers natively; no additional setup needed |
| Husky hooks not executable after clone on Windows | Low | Medium | Document `chmod +x .husky/*` in `CLOUD.md`; or add `prepare: "husky"` script (Husky v9 default) which runs on install |
| `gen_random_uuid()` vs UUID v7 mismatch with future plan | Low | Low | Document clearly in the Prisma schema comment; migration to ordered IDs is a later schema migration, not a breaking change |
| `JWT_SECRET` accidentally committed | Low | Critical | `.env` in `.gitignore`; only `.env.example` committed; CI uses a separate dummy secret; secret scanning enabled in GitHub |

---

## Milestones

| Milestone | Deliverables included | Exit condition |
|-----------|----------------------|----------------|
| **M0.1** Tooling complete | WS-G (ESLint, Prettier, Commitlint, Husky), `packages/config` | `pnpm lint` + `pnpm format:check` green on an empty repo |
| **M0.2** Shared packages built | `packages/types`, `packages/core` scaffold | `pnpm build` + `pnpm typecheck` + `pnpm test` green for packages |
| **M0.3** App shells running | `apps/api`, `apps/web`, `apps/mobile` scaffolds | Each app builds; `GET /api/v1/health` returns 200 |
| **M0.4** Infra + data layer | `docker-compose.yml`, Prisma schema, first migration | `docker compose up -d` healthy; tables created |
| **M0.5** Auth slice done | `AuthModule`, JWT, `ProblemFilter`, Pino | Register → Login → JWT fully works; all e2e tests pass |
| **M0.6** CI green | `.github/workflows/ci.yml` | First push: all steps pass; Turbo cache warm on second run |

---

*Next phase: [Phase 1 — Core Scoring](./phase-1-core-scoring.md)*
