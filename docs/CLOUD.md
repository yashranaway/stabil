# Stabil — Cloud, Infrastructure & Operations

> **Status:** Draft v0.1 · **Phase:** cross-cutting · **Owner area:** infra
> **Related:** [architecture/01-overview.md](architecture/01-overview.md), [architecture/05-security-privacy.md](architecture/05-security-privacy.md), [SCOPE.md](SCOPE.md)

This document covers every layer between the developer's laptop and a candidate reading their stability report: environments, secrets, topology, containerization, CI/CD, storage lifecycle, observability, backups, and the migration path from free/self-hosted infrastructure to managed cloud services. Read [SCOPE.md §10](SCOPE.md) for stack decisions; this doc explains *how* those decisions are operationalized.

---

## Table of Contents

1. [Environments & Configuration Strategy](#1-environments--configuration-strategy)
2. [Infrastructure Topology](#2-infrastructure-topology)
3. [Containerization](#3-containerization)
4. [CI/CD Pipeline](#4-cicd-pipeline)
5. [Storage Buckets & Lifecycle](#5-storage-buckets--lifecycle)
6. [Secrets Management](#6-secrets-management)
7. [Observability](#7-observability)
8. [Backups & Disaster Recovery](#8-backups--disaster-recovery)
9. [Scaling Notes](#9-scaling-notes)
10. [Cost Posture & Migration Path](#10-cost-posture--migration-path)

---

## 1. Environments & Configuration Strategy

### 1.1 Environment ladder

Stabil runs four environments. Each is an isolated deployment of the full stack — web, API, database, and object storage. AI parsing uses the external **OpenRouter** gateway (no local inference service).

| Env | Purpose | API host | Web host | Database | Object store |
|-----|---------|---------|---------|----------|--------------|
| **local** | Developer workstations; fast feedback | `http://localhost:3001` | `http://localhost:3000` | Docker Postgres `localhost:5432` | Docker MinIO `localhost:9000` |
| **dev** (preview) | Per-PR preview deploys; integration testing | Ephemeral container (Railway preview / Fly preview app) | Vercel preview URL | Ephemeral Postgres (Railway) | Shared MinIO dev bucket |
| **staging** | Pre-release QA; Prisma migration dry-runs | Stable container (Railway staging service) | `staging.stabil.app` (Vercel) | Staging Postgres (Neon branch / Railway Postgres) | MinIO staging bucket |
| **prod** | Live traffic | Stable container (Railway / Fly.io) | `stabil.app` (Vercel) | Production Postgres (Neon / Railway managed) | MinIO prod bucket |

### 1.2 `.env` file conventions

Each app in the monorepo maintains its own `.env.*` files. The pattern follows Vite/Next.js and NestJS conventions.

```
apps/
  web/
    .env.local          ← gitignored; developer overrides; loaded by Next.js
    .env.development    ← committed; safe, non-secret dev defaults
    .env.staging        ← committed; staging-specific non-secrets
    .env.production     ← committed; prod non-secrets (no real secrets here)
  api/
    .env                ← gitignored; local secrets
    .env.development    ← committed; safe defaults
    .env.staging        ← committed
    .env.production     ← committed
```

**Rule:** Only non-secret, non-PII values are committed. Secrets are injected at runtime via the platform (Railway env vars, Vercel environment variables, GitHub Actions secrets). See [§6 Secrets Management](#6-secrets-management).

### 1.3 Canonical env var catalogue

| Variable | App | Description | Example |
|----------|-----|-------------|---------|
| `DATABASE_URL` | api | Prisma connection string | `postgresql://stabil:pass@db:5432/stabil?schema=public` |
| `SHADOW_DATABASE_URL` | api | Prisma shadow DB for migrations | `postgresql://stabil:pass@db:5432/stabil_shadow?schema=public` |
| `JWT_SECRET` | api | HS256 signing secret | 64-char random hex |
| `JWT_EXPIRY` | api | Token lifetime | `7d` |
| `MINIO_ENDPOINT` | api | MinIO/S3-compatible host | `localhost` or `minio.internal` |
| `MINIO_PORT` | api | MinIO port | `9000` |
| `MINIO_USE_SSL` | api | TLS toggle | `false` (local), `true` (prod) |
| `MINIO_ACCESS_KEY` | api | S3 access key ID | injected |
| `MINIO_SECRET_KEY` | api | S3 secret access key | injected |
| `MINIO_BUCKET_DOCUMENTS` | api | Documents bucket name | `stabil-documents` |
| `MINIO_BUCKET_REPORTS` | api | Reports/PDF bucket name | `stabil-reports` |
| `OPENROUTER_API_KEY` | api | OpenRouter API key (injected secret) | injected |
| `OPENROUTER_BASE_URL` | api | OpenRouter base URL | `https://openrouter.ai/api/v1` |
| `OPENROUTER_MODEL` | api | Default LLM model identifier | `openai/gpt-4o-mini` |
| `TESSERACT_DATA_PATH` | api | Tessdata directory | `/usr/share/tessdata` |
| `QUEUE_DRIVER` | api | Job queue backend | `bull` |
| `REDIS_URL` | api | Redis connection for Bull queue | `redis://localhost:6379` |
| `SENTRY_DSN` | api, web | Sentry project DSN | injected |
| `NEXT_PUBLIC_API_BASE_URL` | web | Public API URL consumed by browser | `http://localhost:3001/api/v1` |
| `NEXT_PUBLIC_SENTRY_DSN` | web | Sentry DSN for client-side errors | injected |
| `NODE_ENV` | all | Runtime mode | `development` \| `production` |
| `LOG_LEVEL` | api | Pino log level | `debug` (local), `info` (prod) |

---

## 2. Infrastructure Topology

### 2.1 Service map

```mermaid
graph TB
    subgraph Client layer
        Browser["Browser\n(Next.js 15 / Vercel)"]
        MobileApp["Expo / React Native\n(iOS · Android · EAS)"]
    end

    subgraph API layer
        API["NestJS API\n(container: Railway / Fly.io / Docker)"]
        Queue["Bull Job Queue\n(Redis-backed)"]
        Workers["Async Workers\n(parsing · OCR · PDF · purge)"]
    end

    subgraph AI / ML layer
        OpenRouter["OpenRouter\n(external LLM gateway)\nmodel via OPENROUTER_MODEL"]
        Tesseract["Tesseract OCR\n(sidecar / worker — in-house)"]
    end

    subgraph Data layer
        Postgres["PostgreSQL\n(Neon managed /\nRailway Postgres)"]
        MinIO["MinIO\n(S3-compatible\nobject store)"]
        Redis["Redis\n(queue state)"]
    end

    Browser -->|HTTPS REST /api/v1| API
    MobileApp -->|HTTPS REST /api/v1| API
    API --> Postgres
    API --> MinIO
    API --> Queue
    Queue --> Workers
    Workers -->|HTTPS API| OpenRouter
    Workers --> Tesseract
    Workers --> Postgres
    Workers --> MinIO
    OpenRouter -.->|swappable via adapter| SelfHosted["Self-hosted LLM\n(future: Ollama / vLLM)"]
    MinIO -.->|config-swap| S3["S3-compatible\n(future: Cloudflare R2 / AWS S3)"]
```

### 2.2 Network boundaries

| Traffic | Protocol | Notes |
|---------|----------|-------|
| Browser → API | HTTPS (TLS 1.3) | Vercel edge → origin API; or direct HTTPS on container host |
| Mobile → API | HTTPS | Same API; JWT in `Authorization: Bearer` header |
| API → Postgres | TLS (ssl=require in Prisma URL) | Private VPC network on Railway/Fly; Neon uses TLS by default |
| API → MinIO | HTTPS (prod) / HTTP (local) | Toggle `MINIO_USE_SSL` |
| Workers → OpenRouter | HTTPS | External service; `OPENROUTER_API_KEY` injected at runtime; never logged |
| API → Redis | TLS (prod) / TCP (local) | Redis AUTH required in all non-local envs |
| Workers → external KYC APIs | HTTPS (Phase 3) | Egress-only; key rotated via secrets manager |

---

## 3. Containerization

### 3.1 Dockerfile — NestJS API (`apps/api/Dockerfile`)

Multi-stage build using the official Node LTS image. The `builder` stage compiles TypeScript with Turborepo; the `runner` stage is a lean production image.

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22

# ── Stage 1: dependencies ──────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/scoring/package.json packages/scoring/
COPY packages/core/package.json packages/core/
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# ── Stage 2: builder ───────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm --filter @stabil/api... build

# ── Stage 3: runner (production image) ────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runner
RUN apk add --no-cache tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-hin
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/prisma ./prisma
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1
CMD ["node", "dist/main.js"]
```

> **Tesseract:** bundled into the API image for Phase 2 OCR. The `tesseract-ocr-data-eng` and `tesseract-ocr-data-hin` packages cover English + Hindi; add more `tesseract-ocr-data-*` packages for additional languages.

### 3.2 AI / LLM — OpenRouter (external, no container)

AI parsing is handled by **OpenRouter** — a hosted, provider-agnostic LLM gateway. There is no local Ollama container. Set `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and `OPENROUTER_MODEL` in the environment (see §1.3). No Dockerfile or compose service is required for LLM inference.

To switch models, change `OPENROUTER_MODEL` (e.g. `anthropic/claude-haiku-4` or any model available on `https://openrouter.ai/models`). No code changes are required — the `LlmAdapter` reads from config.

> **Self-hosted fallback:** if stricter PII handling is ever required, swap `OpenRouterAdapter` for an `OllamaAdapter` in the NestJS DI binding and point `LLM_BASE_URL` at a local Ollama instance. No other code changes needed.

### 3.3 `docker-compose.yml` — full local stack

The root `docker-compose.yml` brings up every service a developer needs for full local integration. The NestJS API is left out of compose by default so the developer can run it with `pnpm --filter @stabil/api dev` for hot-reload, while all backing services run in Docker.

```yaml
# docker-compose.yml  (project root)
# Usage:
#   docker compose up -d          # start all backing services
#   pnpm --filter @stabil/api dev # run API with hot-reload
#   pnpm --filter @stabil/web dev # run Next.js dev server

version: "3.9"

services:

  # ── PostgreSQL ─────────────────────────────────────────────────────────────
  postgres:
    image: postgres:16-alpine
    container_name: stabil_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: stabil
      POSTGRES_PASSWORD: stabil_dev_pass
      POSTGRES_DB: stabil
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      # Optional: mount init scripts for seeding
      - ./infra/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stabil -d stabil"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── PostgreSQL shadow DB (Prisma migrate dev requires it) ──────────────────
  postgres_shadow:
    image: postgres:16-alpine
    container_name: stabil_postgres_shadow
    restart: unless-stopped
    environment:
      POSTGRES_USER: stabil
      POSTGRES_PASSWORD: stabil_dev_pass
      POSTGRES_DB: stabil_shadow
    ports:
      - "5433:5432"
    volumes:
      - postgres_shadow_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U stabil -d stabil_shadow"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── MinIO (S3-compatible object storage) ───────────────────────────────────
  minio:
    image: minio/minio:RELEASE.2024-11-07T00-52-20Z
    container_name: stabil_minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: stabil_minio_dev
      MINIO_ROOT_PASSWORD: stabil_minio_dev_pass
    ports:
      - "9000:9000"   # S3 API
      - "9001:9001"   # MinIO Console UI
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 30s
      timeout: 20s
      retries: 3

  # ── MinIO bucket provisioner (runs once, then exits) ──────────────────────
  minio_init:
    image: minio/mc:latest
    container_name: stabil_minio_init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
        mc alias set local http://minio:9000 stabil_minio_dev stabil_minio_dev_pass &&
        mc mb --ignore-existing local/stabil-documents &&
        mc mb --ignore-existing local/stabil-reports &&
        mc anonymous set none local/stabil-documents &&
        mc anonymous set none local/stabil-reports &&
        echo 'Buckets provisioned.'
      "
    restart: "no"

  # ── Redis (Bull job queue) ─────────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    container_name: stabil_redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── OpenRouter (external LLM gateway) ─────────────────────────────────────
  # No local container needed. Set OPENROUTER_API_KEY, OPENROUTER_BASE_URL,
  # and OPENROUTER_MODEL in apps/api/.env (see §1.3).
  # The LlmAdapter makes HTTPS calls to https://openrouter.ai/api/v1 at runtime.

volumes:
  postgres_data:
  postgres_shadow_data:
  minio_data:
  redis_data:

networks:
  default:
    name: stabil_local
```

**Quick-start:**

```bash
# 1. Copy and populate secrets
cp apps/api/.env.example apps/api/.env

# 2. Start all backing services
docker compose up -d

# 3. Run Prisma migrations against local Postgres
pnpm --filter @stabil/api exec prisma migrate dev

# 4. Start API (hot-reload) and web in separate terminals
pnpm --filter @stabil/api dev
pnpm --filter @stabil/web dev
```

---

## 4. CI/CD Pipeline

### 4.1 Pipeline overview

```mermaid
flowchart LR
    PR["Pull Request\n(feature → develop)"] --> CI
    CI --> Build["Build (Turborepo)"]
    Build --> Lint["ESLint + Prettier"]
    Lint --> TypeCheck["tsc --noEmit"]
    TypeCheck --> Tests["Vitest unit +\nsupertest integration"]
    Tests --> E2E["Playwright e2e\n(staging fixture)"]
    E2E --> Preview["Preview deploy\n(Vercel + Railway)"]
    Preview --> Merge["Merge to develop"]
    Merge --> StagingDeploy["Staging deploy\n+ prisma migrate deploy"]
    StagingDeploy --> StagingSmoke["Smoke tests\n(health + score endpoint)"]
    StagingSmoke --> ProdDeploy["Prod deploy\n(manual promote)"]
    ProdDeploy --> ProdMigrate["prisma migrate deploy\n(prod DB)"]
```

### 4.2 GitHub Actions workflow

The monorepo uses a single `ci.yml` for PR checks and a separate `deploy.yml` triggered on merge to `develop` (staging) or a release tag (prod). Turborepo remote cache (self-hosted on S3/R2, or Vercel Remote Cache) ensures incremental builds across CI runs.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop]

env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ secrets.TURBO_TEAM }}
  # Turborepo remote cache endpoint (Vercel Remote Cache or self-hosted)
  TURBO_REMOTE_CACHE_SIGNATURE_KEY: ${{ secrets.TURBO_REMOTE_CACHE_SIGNATURE_KEY }}

jobs:
  ci:
    name: Install / Lint / Typecheck / Test / Build
    runs-on: ubuntu-latest
    timeout-minutes: 20

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: stabil
          POSTGRES_PASSWORD: ci_pass
          POSTGRES_DB: stabil_ci
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U stabil"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
        options: --health-cmd "redis-cli ping" --health-interval 10s --health-timeout 5s --health-retries 5

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 2   # Turborepo needs parent commit for diff

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint (Turborepo)
        run: pnpm turbo lint --filter=...[HEAD^1]

      - name: Type check (Turborepo)
        run: pnpm turbo typecheck --filter=...[HEAD^1]

      - name: Run unit + integration tests
        env:
          DATABASE_URL: postgresql://stabil:ci_pass@localhost:5432/stabil_ci
          SHADOW_DATABASE_URL: postgresql://stabil:ci_pass@localhost:5432/stabil_ci_shadow
          REDIS_URL: redis://localhost:6379
          JWT_SECRET: ci_jwt_secret_not_real
          MINIO_ENDPOINT: localhost
          MINIO_PORT: 9000
          MINIO_USE_SSL: "false"
          MINIO_ACCESS_KEY: minioadmin
          MINIO_SECRET_KEY: minioadmin
          MINIO_BUCKET_DOCUMENTS: stabil-documents
          MINIO_BUCKET_REPORTS: stabil-reports
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          OPENROUTER_BASE_URL: https://openrouter.ai/api/v1
          OPENROUTER_MODEL: openai/gpt-4o-mini
          NODE_ENV: test
        run: |
          pnpm --filter @stabil/api exec prisma migrate deploy
          pnpm turbo test --filter=...[HEAD^1]

      - name: Build (Turborepo)
        run: pnpm turbo build --filter=...[HEAD^1]

  # ── Preview deploy (runs after ci job) ────────────────────────────────────
  preview:
    name: Preview deploy
    needs: ci
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy API preview (Railway)
        uses: railwayapp/railway-deploy-action@v1
        with:
          service: api
          environment: pr-${{ github.event.pull_request.number }}
          token: ${{ secrets.RAILWAY_TOKEN }}

      # Vercel preview deploy is automatic via the Vercel GitHub integration.
      # The preview URL is posted as a PR comment by Vercel's bot.
```

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [develop]   # → staging
  push:
    tags: ["v*"]          # → production (manual promote via tag)

jobs:
  deploy-staging:
    if: github.ref == 'refs/heads/develop'
    name: Deploy to staging
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm + Node
        uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Run Prisma migrations (staging DB)
        env:
          DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}
        run: pnpm --filter @stabil/api exec prisma migrate deploy

      - name: Deploy API to Railway (staging)
        uses: railwayapp/railway-deploy-action@v1
        with:
          service: api
          environment: staging
          token: ${{ secrets.RAILWAY_TOKEN }}

      # Vercel staging deploy triggered by push to develop branch
      # via Vercel project settings (branch → environment mapping).

      - name: Staging smoke test
        run: |
          sleep 30   # wait for container to be healthy
          curl -sf https://api-staging.stabil.app/health | jq '.status == "ok"'

  deploy-prod:
    if: startsWith(github.ref, 'refs/tags/v')
    name: Deploy to production
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Run Prisma migrations (prod DB)
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
        run: pnpm --filter @stabil/api exec prisma migrate deploy

      - name: Deploy API to Railway (prod)
        uses: railwayapp/railway-deploy-action@v1
        with:
          service: api
          environment: production
          token: ${{ secrets.RAILWAY_TOKEN }}
```

### 4.3 Turborepo remote cache

Turborepo remote cache is configured in `turbo.json`. The cache backend is either **Vercel Remote Cache** (zero-config when the monorepo is linked to a Vercel project) or a **self-hosted Turborepo cache server** backed by MinIO/S3.

```json
// turbo.json (relevant cache config excerpt)
{
  "$schema": "https://turbo.build/schema.json",
  "remoteCache": {
    "enabled": true,
    "signature": true
  },
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": [".next/**", "dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint":      { "outputs": [] },
    "test":      { "dependsOn": ["^build"], "outputs": ["coverage/**"] }
  }
}
```

### 4.4 Prisma migration strategy

| Trigger | Command | Notes |
|---------|---------|-------|
| Local dev (schema change) | `prisma migrate dev --name <slug>` | Creates migration SQL + updates `_prisma_migrations` |
| CI (test DB) | `prisma migrate deploy` | Applies all pending migrations idempotently |
| Staging deploy | `prisma migrate deploy` (in deploy job, before container swap) | Run against the staging DB before traffic switches |
| Prod deploy | `prisma migrate deploy` (in deploy job, before container swap) | Always before rolling out new API container |
| Emergency rollback | Restore from backup + `prisma migrate resolve --rolled-back` | See §8 DR plan |

> **Rule:** Never use `prisma migrate dev` or `prisma db push` against staging or production databases. Only `prisma migrate deploy` is safe for non-local environments.

---

## 5. Storage Buckets & Lifecycle

### 5.1 Bucket layout

MinIO (local/self-hosted) and any S3-compatible replacement (Cloudflare R2, AWS S3) are organized into two buckets. All paths use UUIDs to avoid enumeration.

```
stabil-documents/
  {candidateId}/
    resume/
      {fileId}.pdf           ← uploaded resume (Phase 2)
      {fileId}.docx
    identity/
      {fileId}.jpg           ← government ID scan (Phase 3; highly sensitive)
      {fileId}.pdf
    supporting/
      {fileId}.*             ← certificates, degree scans, etc.

stabil-reports/
  {candidateId}/
    {scoreRunId}.pdf         ← generated PDF report (@react-pdf/renderer output)
```

**Access model:**

| Bucket | Public access | Who reads | Who writes |
|--------|--------------|-----------|------------|
| `stabil-documents` | None (private) | API service account only | API service account |
| `stabil-reports` | None (private) | API service account only | API service account (PDF generation worker) |

Files are served to clients only via **signed (pre-signed) URLs** generated by the API, with a short expiry (e.g. 15 minutes for document preview, 1 hour for PDF download). The MinIO SDK (`minio` npm package) and the AWS SDK v3 (`@aws-sdk/client-s3`) both produce pre-signed URLs against the same S3 API. See [backend/modules/documents-storage.md](backend/modules/documents-storage.md) for the upload/download flow.

### 5.2 Retention policy (SCOPE §11)

| Object type | Retention rule | Enforcement |
|------------|---------------|-------------|
| Uploaded documents (`stabil-documents`) | Keep while account is active | Soft-delete flag on `Document` Prisma model; hard-delete job runs nightly |
| Generated PDF reports (`stabil-reports`) | Keep while account is active | Linked to `ScoreRun`; deleted with parent run/account |
| **On account deletion request** | **All objects purged within 24 h** | `account-purge` Bull job (see §5.3) |
| Temporary upload staging | 24 hours | MinIO lifecycle rule on `stabil-documents/tmp/` prefix |

> Retention is a confirmed product decision (SCOPE §11: "keep while account active; delete on request") and is a compliance requirement under India DPDP Act and international equivalents. See [architecture/05-security-privacy.md](architecture/05-security-privacy.md) for the legal context.

### 5.3 Delete-on-request purge job

When a candidate requests account deletion, the API queues a Bull job `account:purge:{userId}`. The worker:

1. Marks the `User` record as `status: PENDING_DELETION` immediately (blocks further login and sharing).
2. Lists all `Document` objects in `stabil-documents/{candidateId}/` via `ListObjectsV2`.
3. Issues `DeleteObjects` (batch up to 1 000 keys per call) for all document objects.
4. Deletes all `stabil-reports/{candidateId}/` objects.
5. Hard-deletes the `User`, `CandidateProfile`, `ScoreRun`, `Document`, `ConsentShare` rows (cascaded via Prisma).
6. Marks the job complete and logs a deletion audit event to a separate, append-only `deletion_audit` table (retained for 90 days for compliance evidence — the PII is gone; only the event metadata remains).

The job must be **idempotent**: if it fails mid-way, re-queuing it re-runs each step safely (object deletion is idempotent; the Prisma `deleteMany` with the same filter is idempotent).

### 5.4 MinIO lifecycle rules (via `mc`)

Apply once during environment provisioning:

```bash
# Expire tmp uploads after 24 hours
mc ilm rule add \
  --prefix "tmp/" \
  --expire-days 1 \
  local/stabil-documents

# Expire tmp reports after 24 hours
mc ilm rule add \
  --prefix "tmp/" \
  --expire-days 1 \
  local/stabil-reports
```

---

## 6. Secrets Management

### 6.1 Secret storage by environment

| Environment | Secret store | How injected |
|------------|-------------|-------------|
| Local dev | `.env` file (gitignored) | Developer populates from `.env.example` template |
| Dev (preview) | Railway environment variables (per-service, per-environment) | Railway injects into container at runtime |
| Staging | Railway environment variables | Same mechanism |
| Production | Railway environment variables (or Fly.io secrets via `fly secrets set`) | Same mechanism; secrets are encrypted at rest by the platform |
| GitHub Actions | GitHub repository secrets (encrypted) | Exposed as `${{ secrets.* }}` in workflow env |

### 6.2 Secret categories and handling rules

| Category | Examples | Rules |
|----------|---------|-------|
| **Database credentials** | `DATABASE_URL`, `SHADOW_DATABASE_URL` | Never logged; never in code; rotate on breach |
| **JWT signing secret** | `JWT_SECRET` | ≥ 64 random bytes; one per environment; rotation requires coordinated API rollout |
| **Object storage keys** | `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` | Use service accounts with least-privilege bucket policies, not root credentials |
| **Sentry DSN** | `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Public DSN for browser is not a secret but rate-limit via Sentry's ingest rules |
| **LLM API key** | `OPENROUTER_API_KEY` | Store in Railway/platform secrets; never commit; rotate on suspected leak; restrict to parsing endpoints |
| **API tokens (CI)** | `RAILWAY_TOKEN`, `TURBO_TOKEN` | Scoped tokens; revoke and rotate if the repository is compromised |
| **Future KYC API keys** | Third-party verification API keys (Phase 3) | Store in Railway/platform secrets; never commit; audit access |

### 6.3 Rotation procedure

1. Generate new credential (e.g. rotate Postgres password in Neon dashboard or `ALTER ROLE`).
2. Update the secret in the platform (Railway env var, GitHub secret) **before** the next deploy.
3. Trigger a rolling restart of the API container.
4. Verify health probes pass.
5. Revoke the old credential.

### 6.4 No-commit enforcement

The repository's `.gitignore` excludes all `.env`, `.env.local`, `.env.*.local` files. A pre-commit hook (via `husky` + `lint-staged`) runs `secretlint` or `gitleaks` to catch accidental credential commits before they reach the remote.

---

## 7. Observability

### 7.1 Structured logging

The NestJS API uses **Pino** (`nestjs-pino`) for structured JSON logging. Every log line includes:

```json
{
  "level": "info",
  "time": "2026-06-06T12:34:56.789Z",
  "pid": 1,
  "hostname": "stabil-api-abc123",
  "requestId": "01HZ...",
  "userId": "01HZ...",
  "module": "ScoringService",
  "msg": "Score run completed",
  "scoreRunId": "01HZ...",
  "durationMs": 142
}
```

**Rules:**
- `LOG_LEVEL=debug` locally; `info` in staging/prod.
- Never log raw PII (Aadhaar numbers, passport data, raw form values). Log IDs and aggregate metadata only.
- Log the `requestId` (set by a NestJS `AsyncLocalStorage` middleware) on every log line so traces can be reconstructed from log aggregator queries.

### 7.2 Metrics

Self-hosted: expose Prometheus-compatible metrics from the NestJS API via `@willsoto/nestjs-prometheus`. Scrape with a Prometheus sidecar or Railway's built-in metrics (if available). Key metrics:

| Metric | Type | Labels | Notes |
|--------|------|--------|-------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Request throughput |
| `http_request_duration_seconds` | Histogram | `method`, `route` | P50/P95/P99 latency |
| `score_runs_total` | Counter | `mode`, `tier` | Business metric |
| `queue_jobs_total` | Counter | `queue`, `status` | Bull queue throughput |
| `queue_job_duration_seconds` | Histogram | `queue` | Worker latency |
| `llm_inference_duration_seconds` | Histogram | `model`, `provider` | LLM inference latency (OpenRouter) |
| `storage_upload_bytes_total` | Counter | `bucket` | Storage throughput |

### 7.3 Error tracking — Sentry

Both the NestJS API and Next.js web app integrate **Sentry** (`@sentry/nestjs` and `@sentry/nextjs`):

```typescript
// apps/api/src/main.ts (bootstrap excerpt)
import * as Sentry from '@sentry/nestjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // Never send PII; scrub sensitive fields:
  beforeSend(event) {
    // Strip request body (may contain form answers with PII)
    if (event.request) {
      delete event.request.data;
    }
    return event;
  },
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
});
```

**PII scrubbing rule:** Sentry's `beforeSend` hook must strip `request.data` and any field matching `aadhaar|pan|passport|dob|marital` to prevent PII reaching Sentry's servers (which are outside our infrastructure). See [architecture/05-security-privacy.md](architecture/05-security-privacy.md) for the full PII classification.

### 7.4 Health and readiness probes

The NestJS API exposes two endpoints used by container orchestrators and uptime monitors:

```
GET /health       → 200 { status: "ok", timestamp: "...", uptime: 123 }
GET /health/ready → 200 { db: "ok", redis: "ok", minio: "ok" }
               or → 503 { db: "ok", redis: "error", minio: "ok" }
```

`/health` is the **liveness** probe — checked every 30 s; restart the container if it fails 3× in a row.
`/health/ready` is the **readiness** probe — checked before routing traffic after a deploy; waits for DB, Redis, and MinIO connections to be established.

Implemented with `@nestjs/terminus` (`HealthModule`, `TypeOrmHealthIndicator` replaced by a raw Prisma ping, `RedisHealthIndicator`, and a custom MinIO indicator).

```typescript
// apps/api/src/health/health.controller.ts
@Get('ready')
@HealthCheck()
check() {
  return this.health.check([
    () => this.prismaHealth.pingCheck('postgres'),
    () => this.redisHealth.pingCheck('redis', { url: this.config.get('REDIS_URL') }),
    () => this.minioHealth.pingCheck('minio'),
  ]);
}
```

### 7.5 Uptime monitoring

Use **Better Uptime** (free tier) or **UptimeRobot** to ping `/health` every 60 s from external locations. Alert to Slack/email on 2× consecutive failures.

---

## 8. Backups & Disaster Recovery

### 8.1 PostgreSQL backups

| Environment | Backup method | Schedule | Retention | RTO target |
|------------|--------------|----------|-----------|------------|
| Local dev | Not backed up | — | — | Recreate from migrations |
| Staging | Platform snapshot (Neon / Railway) | Daily | 7 days | 30 min |
| Production | Platform snapshot **+** logical dump | Daily (snapshot), Weekly (dump) | 30 days | < 1 h |

**Logical dump procedure (production):**

```bash
# Run as a scheduled Railway cron job or GitHub Actions schedule
pg_dump \
  --format=custom \
  --compress=9 \
  --no-acl \
  --no-owner \
  "${DATABASE_URL}" \
  | aws s3 cp - \
    "s3://stabil-backups/postgres/$(date +%Y-%m-%d).dump" \
    --sse AES256
```

Store dumps in a separate bucket (`stabil-backups`) in a different region from primary data. Rotate dumps older than 30 days via S3/R2 lifecycle rules.

**Restore procedure:**

```bash
pg_restore \
  --format=custom \
  --clean \
  --no-acl \
  --no-owner \
  --dbname "${DATABASE_URL}" \
  stabil-2026-06-06.dump
```

After restore, verify the Prisma migration table is consistent: `pnpm --filter @stabil/api exec prisma migrate status`.

### 8.2 MinIO backups

MinIO data (uploaded documents and generated PDFs) is backed up with `mc mirror`:

```bash
# Daily incremental mirror to backup bucket (separate MinIO instance or S3)
mc mirror \
  --overwrite \
  --preserve \
  --remove \
  local/stabil-documents backup/stabil-documents

mc mirror \
  --overwrite \
  --preserve \
  --remove \
  local/stabil-reports backup/stabil-reports
```

For a managed MinIO cluster, enable **MinIO replication** (`mc replicate add`) between the primary and a secondary site.

### 8.3 Recovery time and recovery point objectives

| Service | RPO (max data loss) | RTO (max downtime) |
|---------|--------------------|--------------------|
| PostgreSQL (prod) | 24 h (daily snapshot) | < 1 h |
| MinIO documents (prod) | 24 h (daily mirror) | < 2 h |
| MinIO reports (prod) | 24 h (daily mirror) | < 2 h (regenerable from DB) |
| Redis (queue state) | 0 (queue jobs requeue on restart) | < 5 min |

> PDF reports can be regenerated from the database (score run parameters + user profile) if the MinIO backup is unavailable, so their effective RPO is the database RPO.

### 8.4 Disaster recovery playbook

1. **Postgres failure** → restore snapshot from Neon/Railway dashboard → update `DATABASE_URL` → redeploy API → run `prisma migrate status` → smoke test `/health/ready`.
2. **MinIO total loss** → restore from `mc mirror` backup → re-provision buckets → update `MINIO_*` env vars → redeploy API.
3. **API container failure** → platform auto-restarts (Railway restarts on exit); if persistent, roll back to previous image via Railway's deployment history.
4. **OpenRouter outage** → parsing jobs queue up in Bull (Redis-backed); resume automatically when OpenRouter recovers. For extended outages, set `LLM_PROVIDER=ollama` and provision an Ollama container as a temporary fallback.
5. **Full environment loss** → provision new Railway project → set all env vars from the secrets store (including `OPENROUTER_API_KEY`) → restore Postgres from latest dump → restore MinIO from backup → deploy tagged release → run `prisma migrate deploy` → smoke test.

---

## 9. Scaling Notes

### 9.1 OpenRouter model selection and cost

AI parsing calls are made to **OpenRouter** over HTTPS — no local GPU or CPU sizing is required. The API container needs no additional memory for inference. Resume parsing is an async background job, so latency is not a real-time concern.

**Model selection trade-offs (via `OPENROUTER_MODEL`):**

| Model identifier | Quality | Approx cost/parse | Use case |
|-----------------|---------|------------------|----------|
| `openai/gpt-4o-mini` (default) | Good extraction | ~$0.0003 | POC / production |
| `anthropic/claude-haiku-4` | High quality | ~$0.001 | Better accuracy / nuance |
| `openai/gpt-4o` | Best quality | ~$0.003 | High-stakes review tasks |
| `meta-llama/llama-3.1-8b-instruct` | Good (open model) | ~$0.0001 | Cost-optimised, no-training policy |

Switch models by changing `OPENROUTER_MODEL` env var — no code or infrastructure changes required. Use the [OpenRouter model explorer](https://openrouter.ai/models) to filter by provider data policies (prefer models with `no-training` / `zero-retention` guarantees).

> **Self-hosted fallback:** if stricter PII handling is ever required (e.g. data-residency rules), swap `OpenRouterAdapter` for an `OllamaAdapter` in the DI binding and provision an Ollama container. The `LlmAdapter` interface is unchanged.

### 9.2 Async worker concurrency

Bull queue concurrency is configured per processor in the NestJS worker service:

```typescript
// Default: 5 concurrent parsing jobs (OpenRouter is I/O-bound; no local resource contention)
@Processor({ name: 'parsing', concurrency: 5 })
export class ParsingProcessor { ... }

// PDF generation is CPU-light; allow more concurrency
@Processor({ name: 'pdf', concurrency: 5 })
export class PdfProcessor { ... }

// Purge jobs are I/O-bound; higher concurrency is safe
@Processor({ name: 'purge', concurrency: 10 })
export class PurgeProcessor { ... }
```

Because OpenRouter is a remote HTTPS service (I/O-bound), parsing concurrency is not constrained by local CPU/GPU resources. Tune `concurrency` based on OpenRouter rate limits for your plan (check `X-RateLimit-*` response headers).

### 9.3 API horizontal scaling

The NestJS API is stateless (JWT auth, external state in Postgres/Redis/MinIO). Horizontal scaling is safe:

- **Railway:** set service replicas to ≥ 2 for zero-downtime rolling deploys.
- **Fly.io:** `fly scale count 2 --region bom` (Mumbai) for India-local latency.
- The Bull queue is shared via Redis so multiple API/worker replicas process the same queue without duplication.

### 9.4 Database connection pooling

With multiple API replicas, raw Postgres connections multiply. Use **PgBouncer** (transaction mode) in front of the database, or Neon's built-in connection pooler (`?pgbouncer=true` in the connection string). Keep max connections per API instance at 10 (`connection_limit=10` in `DATABASE_URL`).

---

## 10. Cost Posture & Migration Path

### 10.1 Phase 0–1: free / self-hosted baseline

The entire stack runs at near-zero infrastructure cost in the POC and early production phases. Every component is either free-tier or self-hosted:

| Component | Free / self-hosted choice | Monthly cost (estimate) |
|-----------|--------------------------|------------------------|
| Web (Next.js) | Vercel Hobby / Pro | $0–$20 |
| Mobile (Expo) | Expo EAS Free tier | $0 |
| API (NestJS) | Railway Starter (500 h/mo free) | $0 |
| Database | Neon Free (0.5 GB, 1 compute unit) | $0 |
| Object storage | Self-hosted MinIO on Railway volume | ~$0 (included in compute) |
| LLM inference | OpenRouter (`openai/gpt-4o-mini`) | ~$0–$1 (pay-per-token; ≈ $0.0003/parse) |
| Redis (queue) | Railway free Redis | $0 |
| Error tracking | Sentry Free (5k errors/mo) | $0 |
| CI/CD | GitHub Actions (2 000 min/mo free) | $0 |
| Turborepo cache | Vercel Remote Cache (free with project) | $0 |
| **Total** | | **~$0–$20/mo** |

### 10.2 Migration path — config-only swaps

Every infrastructure boundary is abstracted so migration is a configuration change, not a rewrite:

```mermaid
flowchart LR
    subgraph Storage
        MinIO["MinIO\n(self-hosted)"] -->|MINIO_ENDPOINT\nMINIO_ACCESS_KEY\nMINIO_SECRET_KEY| CR2["Cloudflare R2"]
        MinIO -->|same vars| S3["AWS S3"]
    end

    subgraph LLM
        OR["OpenRouter\n(default)"] -->|OPENROUTER_MODEL| GPT4oMini["openai/gpt-4o-mini"]
        OR -->|OPENROUTER_MODEL| Haiku["anthropic/claude-haiku-4"]
        OR -->|adapter swap| Ollama["Self-hosted Ollama\n(stricter PII)"]
    end

    subgraph Database
        NeonFree["Neon Free"] -->|DATABASE_URL| NeonPro["Neon Pro"]
        NeonFree -->|DATABASE_URL| RDS["AWS RDS\nPostgres"]
        NeonFree -->|DATABASE_URL| Supabase["Supabase Postgres"]
    end
```

**Object storage migration (MinIO → Cloudflare R2 or AWS S3):**

The API uses the MinIO Node.js SDK's S3-compatible interface (`minio` package, `Client.putObject`, `Client.presignedGetObject`). To switch to Cloudflare R2, update three environment variables and the SDK endpoint:

```bash
# Before (MinIO self-hosted)
MINIO_ENDPOINT=minio.internal
MINIO_PORT=9000
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=<minio-key>
MINIO_SECRET_KEY=<minio-secret>

# After (Cloudflare R2) — no code changes
MINIO_ENDPOINT=<account-id>.r2.cloudflarestorage.com
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=<r2-access-key-id>
MINIO_SECRET_KEY=<r2-secret-access-key>
```

Because the MinIO SDK implements the S3 wire protocol, it works against R2 and AWS S3 without modification.

**LLM migration (OpenRouter ↔ self-hosted):**

The `packages/core` AI adapter (`LlmAdapter` interface) has two implementations: `OpenRouterAdapter` (default) and `OllamaAdapter` (self-hosted fallback). Switching is one env var change and a DI binding:

```typescript
// packages/core/src/ai/llm.adapter.ts
export interface LlmAdapter {
  complete(prompt: string, options?: LlmOptions): Promise<string>;
}

// Registered in apps/api/src/app.module.ts
const llmProvider = process.env.LLM_PROVIDER === 'ollama'
  ? OllamaAdapter           // self-hosted fallback (stricter PII)
  : OpenRouterAdapter;      // default: OpenRouter gateway
```

The `OpenRouterAdapter` reads `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, and `OPENROUTER_MODEL` from env. Change `OPENROUTER_MODEL` to switch between any model on OpenRouter without touching code. Set `LLM_PROVIDER=ollama` to fall back to a local Ollama instance.

**Managed Postgres migration:**

Prisma's `DATABASE_URL` is the single point of change. Neon, Supabase, RDS, and CloudSQL all accept the same Postgres connection string format. No schema changes required.

### 10.3 Scale-up cost benchmarks

| Traffic level | Additional costs (beyond free baseline) |
|--------------|----------------------------------------|
| 1 000 candidates/mo | +$0–$10 (Vercel Hobby, Neon Free sufficient; OpenRouter LLM ≈ $0.30) |
| 10 000 candidates/mo | +$50–$155/mo (Neon Pro $19, Vercel Pro $20, Railway paid; OpenRouter ≈ $3) |
| 100 000 candidates/mo | +$300–$800/mo (infra scale-up; OpenRouter ≈ $30; consider volume discounts) |
| OpenRouter `openai/gpt-4o-mini` | ~$0.15/1M input tokens — parsing one resume ≈ 2 000 tokens ≈ $0.0003/parse |

---

## Appendix A: Environment Variable Quick Reference

See [§1.3](#13-canonical-env-var-catalogue) for the full table. A template `.env.example` file lives at `apps/api/.env.example` and `apps/web/.env.example` in the repository. Never copy real secrets into these files — use placeholder values.

## Appendix B: Platform-Specific Deploy Notes

### Railway

- Connect the GitHub repository in the Railway dashboard; select the `apps/api` root directory for the API service.
- Set the start command to `node dist/main.js` and the build command to `pnpm turbo build --filter=@stabil/api`.
- Add a volume mount at `/data` if running MinIO as a Railway service (set `MINIO_VOLUMES=/data`).
- Use Railway's **private networking** (`railway.internal` domain) for API → Postgres, API → Redis, API → MinIO communication; never expose these services publicly.

### Fly.io (alternative to Railway)

```toml
# apps/api/fly.toml
app = "stabil-api"
primary_region = "bom"   # Mumbai — India-first latency

[build]
  dockerfile = "../../apps/api/Dockerfile"

[http_service]
  internal_port = 3001
  force_https = true
  [http_service.concurrency]
    type = "connections"
    hard_limit = 200
    soft_limit = 150

[[vm]]
  size = "shared-cpu-2x"
  memory = "1gb"
```

### Vercel (Next.js web)

- Import the monorepo; set **Root Directory** to `apps/web`.
- Set **Framework Preset** to Next.js.
- Configure environment variables per environment (Development / Preview / Production) in the Vercel dashboard.
- Enable **Vercel Remote Cache** under the project's Turborepo settings to share CI build cache.
- The `NEXT_PUBLIC_API_BASE_URL` variable must match the deployed API URL per environment.

### Expo EAS (mobile)

Mobile build and submit are handled by **Expo Application Services (EAS)**. Configure `eas.json` at `apps/mobile/eas.json`:

```json
{
  "cli": { "version": ">= 10.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_BASE_URL": "http://localhost:3001/api/v1" }
    },
    "staging": {
      "distribution": "internal",
      "env": { "EXPO_PUBLIC_API_BASE_URL": "https://api-staging.stabil.app/api/v1" }
    },
    "production": {
      "distribution": "store",
      "env": { "EXPO_PUBLIC_API_BASE_URL": "https://api.stabil.app/api/v1" }
    }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "...", "ascAppId": "..." },
      "android": { "serviceAccountKeyPath": "./google-service-account.json" }
    }
  }
}
```

EAS secrets (`EXPO_PUBLIC_API_BASE_URL`, push notification keys) are managed via `eas secret:create` — never committed to the repository.
