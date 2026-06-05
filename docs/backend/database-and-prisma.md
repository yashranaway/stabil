# Database & Prisma

> **Status:** Draft v0.1 · **Phase:** cross-cutting · **Owner area:** backend/data
> **Related:** [architecture/02-data-model.md](../architecture/02-data-model.md), [CLOUD.md](../CLOUD.md), [backend/modules/scoring.md](modules/scoring.md), [architecture/05-security-privacy.md](../architecture/05-security-privacy.md)

This document covers every operational concern for Stabil's PostgreSQL layer: how the Prisma schema is organized and surfaced to NestJS, the migration workflow across all environments, seeding, JSONB snapshot design for `ScoreRun`, indexing strategy, connection pooling, multi-write transactions, the soft-delete + purge lifecycle, and how to write isolated DB tests. Read [architecture/02-data-model.md](../architecture/02-data-model.md) first for the entity catalog, ERD, and full Prisma schema — this document elaborates the operational layer on top of that schema, not the schema itself.

---

## Table of Contents

1. [Schema organization](#1-schema-organization)
2. [PrismaService & repository pattern](#2-prismaservice--repository-pattern)
3. [Migration workflow](#3-migration-workflow)
4. [Seeding](#4-seeding)
5. [JSONB usage — ScoreRun snapshots](#5-jsonb-usage--scorerun-snapshots)
6. [Indexing strategy](#6-indexing-strategy)
7. [Connection pooling & transactions](#7-connection-pooling--transactions)
8. [Soft-delete + purge job](#8-soft-delete--purge-job)
9. [Testing the DB layer](#9-testing-the-db-layer)

---

## 1. Schema organization

### 1.1 Single-file vs. `prismaSchemaFolder`

For the POC and Phase 0–1, all models live in **one file**:

```
packages/db/
└── prisma/
    ├── schema.prisma        ← single authoritative schema
    ├── seed.ts              ← seeding script (§4)
    └── migrations/
        ├── 20260606000000_init/
        │   └── migration.sql
        └── ...
```

Prisma 5.15+ supports [`prismaSchemaFolder`](https://www.prisma.io/docs/orm/prisma-schema/overview/prisma-schema-folder) — split the schema into multiple `.prisma` files when the single file grows unwieldy (typically past ~600 lines). Enable it by adding a `generator` flag and moving models into domain files:

```prisma
// packages/db/prisma/schema.prisma  (entry point when split)
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["prismaSchemaFolder"]
}

// packages/db/prisma/schema/
//   datasource.prisma   ← datasource + generator
//   enums.prisma        ← all shared enums
//   identity.prisma     ← User, AuthIdentity, Session, Role
//   orgs.prisma         ← EmployerOrg, RecruiterOrg
//   profile.prisma      ← CandidateProfile, FormSubmission, Answer
//   scoring.prisma      ← ScoreRun, ReportArtifact
//   documents.prisma    ← Document, VerificationCheck
//   sharing.prisma      ← ShareGrant, Notification, AuditLog
```

> **Rule:** Only split when the single file genuinely hinders navigation. Splitting before it's needed adds complexity without benefit. The migration files remain in `prisma/migrations/` regardless of split status.

### 1.2 Package location in the monorepo

The Prisma schema lives in `packages/db` — a shared internal package — so both the API (`apps/api`) and future CLI tooling can import the generated client from the same source:

```
packages/db/
├── package.json             ← name: "@stabil/db"
├── prisma/
│   ├── schema.prisma
│   └── migrations/
└── src/
    └── index.ts             ← re-exports PrismaClient + helpers
```

```json
// packages/db/package.json
{
  "name": "@stabil/db",
  "version": "0.0.1",
  "scripts": {
    "generate": "prisma generate",
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "db:push": "prisma db push",
    "seed": "ts-node prisma/seed.ts"
  },
  "dependencies": {
    "@prisma/client": "^5.15.0"
  },
  "devDependencies": {
    "prisma": "^5.15.0"
  }
}
```

The NestJS API adds `"@stabil/db": "workspace:*"` to its `package.json` dependencies. After running `pnpm install`, the client is available without a second install step.

### 1.3 `DATABASE_URL` and `SHADOW_DATABASE_URL`

```ini
# apps/api/.env (gitignored)
DATABASE_URL="postgresql://stabil:stabil_dev_pass@localhost:5432/stabil?schema=public"
SHADOW_DATABASE_URL="postgresql://stabil:stabil_dev_pass@localhost:5433/stabil_shadow?schema=public"
```

The shadow database is used only by `prisma migrate dev` locally to detect drift. It is never needed in CI or production (`migrate deploy` does not require it). See [CLOUD.md §1.3](../CLOUD.md#13-canonical-env-var-catalogue) for the full env var catalogue.

---

## 2. PrismaService & repository pattern

### 2.1 PrismaService

A single NestJS `PrismaService` wraps the generated `PrismaClient`. It extends `PrismaClient` and implements `OnModuleInit` / `OnModuleDestroy` for lifecycle management, and installs a middleware that automatically excludes soft-deleted rows from every query.

```typescript
// apps/api/src/db/prisma.service.ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    });

    // Global soft-delete filter: exclude deletedAt IS NOT NULL on every
    // model that carries deletedAt. Override per-query with
    //   prisma.user.findMany({ where: { deletedAt: { not: null } } })
    // when the purge job explicitly needs soft-deleted rows.
    this.$use(async (params, next) => {
      const softDeleteModels = [
        'User',
        'CandidateProfile',
        'Document',
        'ReportArtifact',
        'EmployerOrg',
        'RecruiterOrg',
      ] as const;

      if (
        softDeleteModels.includes(params.model as (typeof softDeleteModels)[number]) &&
        params.action === 'findFirst' ||
        params.action === 'findMany' ||
        params.action === 'findUnique' ||
        params.action === 'count'
      ) {
        params.args ??= {};
        params.args.where = { deletedAt: null, ...params.args.where };
      }
      return next(params);
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

Register it as a global module so every feature module can inject it:

```typescript
// apps/api/src/db/db.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DbModule {}
```

```typescript
// apps/api/src/app.module.ts
@Module({
  imports: [DbModule, /* feature modules */],
})
export class AppModule {}
```

### 2.2 Repository pattern

Each feature module owns a dedicated repository class that wraps `PrismaService`. Repositories encapsulate query logic so that controllers and service classes never build Prisma `where`/`include` objects directly. This keeps the service-layer tests fast (repositories are easily mocked) and the query logic auditable in one place.

```typescript
// apps/api/src/profiles/profiles.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { CandidateProfile, ProfileClaimStatus } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

@Injectable()
export class ProfilesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a new profile (candidate self-onboard or employer submission). */
  async create(data: {
    mode: 'fresher' | 'professional';
    ownerUserId?: string;
    submittedByUserId?: string;
    inviteEmail?: string;
    displayName?: string;
  }): Promise<CandidateProfile> {
    return this.prisma.candidateProfile.create({
      data: {
        id: uuidv7(),
        mode: data.mode,
        ownerUserId: data.ownerUserId ?? null,
        submittedByUserId: data.submittedByUserId ?? null,
        claimStatus: data.ownerUserId ? 'claimed' : 'unclaimed',
        inviteEmail: data.inviteEmail ?? null,
        displayName: data.displayName ?? null,
      },
    });
  }

  /** Latest score run for a profile — the compound index makes this O(log n). */
  async latestScoreRun(profileId: string) {
    return this.prisma.scoreRun.findFirst({
      where: { candidateProfileId: profileId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Score history for the improvement-loop timeline chart. */
  async scoreHistory(profileId: string) {
    return this.prisma.scoreRun.findMany({
      where: { candidateProfileId: profileId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, total: true, tier: true, createdAt: true },
    });
  }

  /** Soft-delete a profile (marks it; purge job hard-deletes later). */
  async softDelete(profileId: string): Promise<void> {
    await this.prisma.candidateProfile.update({
      where: { id: profileId },
      data: { deletedAt: new Date() },
    });
  }

  /** Find unclaimed profiles with a matching invite email (for claim flow). */
  async findByClaimToken(token: string) {
    return this.prisma.candidateProfile.findUnique({
      where: { claimToken: token },
    });
  }
}
```

> **Convention:** repositories return raw Prisma model types or narrow `select` projections — never DTOs. DTO transformation happens in the service or controller layer, keeping repositories framework-agnostic.

---

## 3. Migration workflow

### 3.1 Commands by context

| Context | Command | Notes |
|---------|---------|-------|
| **Local dev — schema change** | `pnpm --filter @stabil/db migrate:dev -- --name <slug>` | Generates migration SQL, applies it to the local DB, regenerates the client. Requires `SHADOW_DATABASE_URL`. |
| **Local dev — quick prototype** | `pnpm --filter @stabil/db db:push` | Pushes schema directly without creating a migration file. **Use only on a throwaway local DB.** Never on shared/staging/prod. |
| **CI (test run)** | `pnpm --filter @stabil/db migrate:deploy` | Applies all pending migrations idempotently against the CI Postgres service container. |
| **Staging deploy** | `pnpm --filter @stabil/db migrate:deploy` | Run in the deploy job before the container swap. See [CLOUD.md §4.2](../CLOUD.md#42-github-actions-workflow). |
| **Production deploy** | `pnpm --filter @stabil/db migrate:deploy` | Always before rolling out a new API container; the deploy job blocks on this step. |
| **Emergency rollback** | Restore from backup → `prisma migrate resolve --rolled-back <migration-name>` | Mark the failed migration as rolled back so `migrate deploy` will retry it cleanly. See §3.4. |

### 3.2 Naming convention for migrations

Migration names are the `--name` slug passed to `migrate dev`. Follow this pattern:

```
<verb>_<entity>_<detail>
```

Examples:

```bash
# Good
prisma migrate dev --name add_candidate_profile
prisma migrate dev --name add_score_run_config_version
prisma migrate dev --name index_share_grant_employer_status
prisma migrate dev --name drop_legacy_score_column

# Bad (avoid)
prisma migrate dev --name update          # not descriptive
prisma migrate dev --name fix_bug         # not tied to schema
prisma migrate dev --name 2026-06-06      # date belongs in the filename prefix, not the slug
```

Prisma automatically prepends a UTC timestamp (`20260606120000_`) to the folder name, so the slug needs only to describe what changed:

```
prisma/migrations/
  20260606000001_init/
    migration.sql
  20260607083012_add_verification_check_bonus_column/
    migration.sql
  20260610110030_index_share_grant_employer_status/
    migration.sql
```

### 3.3 Large / multi-step migrations

For migrations that touch many rows (e.g. backfilling a new column or adding a not-null constraint to an existing table), split the work into multiple migration files deployed in consecutive releases:

1. **Release A** — add the column as nullable (`ALTER TABLE ... ADD COLUMN new_col TEXT`).
2. **Background job** — backfill existing rows (run outside Prisma, with batching to avoid lock contention).
3. **Release B** — apply the not-null constraint (`ALTER TABLE ... ALTER COLUMN new_col SET NOT NULL`).

This keeps each migration fast and lock-safe. For large index creation, use `CREATE INDEX CONCURRENTLY` inside a raw migration file (Prisma writes the SQL; you can edit it before committing):

```sql
-- prisma/migrations/20260610110030_index_share_grant_employer_status/migration.sql
-- CreateIndex (manually edited to use CONCURRENTLY)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ShareGrant_employerOrgId_status_idx"
  ON "ShareGrant"("employerOrgId", "status");
```

Note that `CREATE INDEX CONCURRENTLY` cannot run inside a transaction — Prisma wraps each migration in a transaction by default. To opt out for this migration, add a directive comment at the top of the SQL file:

```sql
-- This migration disables the advisory lock because CONCURRENTLY cannot run in a transaction.
-- prisma-client-js does not wrap this file in a transaction.
BEGIN;
-- ... non-concurrent DDL here
COMMIT;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ShareGrant_employerOrgId_status_idx"
  ON "ShareGrant"("employerOrgId", "status");
```

### 3.4 Rollback strategy

Prisma does **not** generate automatic rollback SQL. Rollback in Stabil is handled by:

1. **Backup restoration** — the primary recovery path (see [CLOUD.md §8](../CLOUD.md#8-backups--disaster-recovery)). Restore the Postgres snapshot taken before the deploy, then redeploy the previous API container image.
2. **Mark as rolled back** — after restoring, tell Prisma the migration did not apply:
   ```bash
   prisma migrate resolve --rolled-back 20260610110030_index_share_grant_employer_status
   ```
3. **Manual down migration** — for simple additive changes (adding a column, adding an index), write a manual `ALTER TABLE ... DROP COLUMN` or `DROP INDEX` as a new forward migration rather than attempting a true rollback. This keeps the migration history linear.

> **Rule:** Never delete or modify an already-applied migration file. `migrate deploy` detects file changes and fails with an integrity error to protect against accidental drift.

---

## 4. Seeding

### 4.1 Seed file location and execution

```
packages/db/prisma/seed.ts
```

Prisma invokes the seed script via the `"prisma"` key in `packages/db/package.json`:

```json
{
  "prisma": {
    "seed": "ts-node --project tsconfig.json prisma/seed.ts"
  }
}
```

Run seeding locally:

```bash
# After migrate dev (Prisma runs the seed automatically on first migrate dev)
pnpm --filter @stabil/db exec prisma db seed

# Or explicitly after any migrate
pnpm --filter @stabil/db exec prisma migrate dev --name my_change
# Prisma will prompt to run the seed script
```

In CI, seed only when testing against a fresh schema — not as part of `migrate deploy` in staging/prod. Use test fixtures (§9) instead of the seed script in integration tests.

### 4.2 What the seed creates

The seed script bootstraps three things required for the application to be operable after a fresh migration:

1. **System roles** — ensures the four `RoleName` enum values are representable (they live as enum values in Prisma, not as rows, but the seed validates the enum is functional).
2. **Admin user** — a single admin account for initial platform operations.
3. **Initial scoring `configVersion`** — a record (stored as a plain configuration constant, not a DB row, but verified at seed time) that the scoring engine expects to find at startup.

```typescript
// packages/db/prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/** The configVersion the scoring engine ships with. Must match
 *  packages/scoring/src/config/v1.ts VERSION constant. */
const INITIAL_CONFIG_VERSION = 'v1.0.0';

async function seedAdmin() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@stabil.app';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;

  if (!adminPassword) {
    console.warn(
      '[seed] SEED_ADMIN_PASSWORD not set — skipping admin creation. ' +
      'Set it in .env to create the initial admin account.',
    );
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    console.log(`[seed] Admin user already exists: ${adminEmail}`);
    return;
  }

  const userId = uuidv7();
  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });

  await prisma.$transaction([
    prisma.user.create({
      data: {
        id: userId,
        email: adminEmail,
        fullName: 'Stabil Admin',
      },
    }),
    prisma.role.create({
      data: {
        id: uuidv7(),
        userId,
        name: 'admin',
      },
    }),
    prisma.authIdentity.create({
      data: {
        id: uuidv7(),
        userId,
        provider: 'password',
        providerUid: adminEmail,
        passwordHash,
      },
    }),
  ]);

  console.log(`[seed] Admin created: ${adminEmail}`);
}

async function verifyConfigVersion() {
  // The configVersion is not stored in Postgres (it lives in the scoring package)
  // but we log it here so the seed output makes the active version visible.
  console.log(`[seed] Active scoring configVersion: ${INITIAL_CONFIG_VERSION}`);
  console.log(
    '[seed] Ensure packages/scoring/src/config/v1.ts VERSION === "' +
    INITIAL_CONFIG_VERSION +
    '"',
  );
}

async function main() {
  console.log('[seed] Starting...');
  await seedAdmin();
  await verifyConfigVersion();
  console.log('[seed] Done.');
}

main()
  .catch((err) => {
    console.error('[seed] Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

### 4.3 Idempotency

The seed script must be **idempotent** — safe to re-run against a database that already has seed data. Use `upsert` or guard with an existence check (`findUnique`) before creating. Never use `create` unconditionally in a seed file.

### 4.4 Dev fixtures vs. seed

The seed creates **minimum viable operational data** (admin account, config verification). It does not create test candidates, dummy profiles, or sample score runs — those belong in fixture factories used by tests (§9.2) or in a separate `pnpm dev:fixtures` script. Keeping them separate means `prisma db seed` is safe to run against any environment without polluting production with fake data.

---

## 5. JSONB usage — ScoreRun snapshots

### 5.1 What is stored and why

The scoring engine (`packages/scoring`) is pure: given a `CandidateInput`, it returns a `ScoreResult`. The API persists that result verbatim into a `ScoreRun`. Four pieces of data are stored as JSONB columns:

| Column | Type in Prisma | Source | Why JSONB, not relational columns |
|--------|----------------|--------|-----------------------------------|
| `breakdown` | `Json` (JSONB in Postgres) | `ScoreResult.breakdown: ParameterScore[]` | The parameter set, labels, weights, and `visibility` flags change across `configVersion`s as calibration improves (SCOPE §13). Storing the literal per-parameter array frozen at run time means an old report renders identically forever — no join against a mutated parameter table, no missing parameter keys. |
| `byBlock` | `Json` | `ScoreResult.byBlock: Record<Block, {awarded, max}>` | A fixed-shape summary of the three blocks (`mode`, `common`, `verification`). Snapshotting avoids recomputing from a potentially updated config. |
| `total` | `Int` (relational column) | `ScoreResult.total` | Promoted to a typed column because it drives queries (latest score per profile, tier filters, employer ranking). It duplicates what `byBlock` implies, but an indexed column is required for the access patterns in §6. |
| `tier` | `Tier` enum column | `ScoreResult.tier` | Same reason as `total` — needed for indexed queries and sorting. |
| `configVersion` | `String` column | Run-time config identifier | Together with `breakdown`, makes a run **reproducible**: running the same engine version against the same `FormSubmission` yields the same numbers. |

### 5.2 Shape of the JSONB fields

```typescript
// Shape of ScoreRun.byBlock (mirrors ScoreResult.byBlock from @stabil/scoring)
type ByBlockSnapshot = {
  mode:         { awarded: number; max: number };
  common:       { awarded: number; max: number };
  verification: { awarded: number; max: number };
};

// Shape of ScoreRun.breakdown (mirrors ScoreResult.breakdown from @stabil/scoring)
// FULL list — includes visibility="employer-only" entries (age, marital status).
// Never pre-filtered. Audience filtering happens on read (SCOPE §6.3).
type ParameterScoreSnapshot = {
  key:        string;          // e.g. "total_experience", "marital_status"
  label:      string;          // human-readable, frozen at run time
  block:      'mode' | 'common' | 'verification';
  visibility: 'all' | 'employer-only';
  awarded:    number;          // integer points awarded
  max:        number;          // integer max possible for this parameter
  fraction:   number;          // normalized [0,1] input from the rubric layer
};
```

### 5.3 Persisting a score run

```typescript
// apps/api/src/scoring/scoring.service.ts (excerpt)
import { PrismaService } from '../db/prisma.service';
import { ScoreRun } from '@prisma/client';
import { score } from '@stabil/scoring';
import { uuidv7 } from 'uuidv7';

async function persistScoreRun(
  prisma: PrismaService,
  profileId: string,
  submissionId: string,
  candidateInput: CandidateInput,
  configVersion: string,
): Promise<ScoreRun> {
  const result = score(candidateInput);          // pure, no DB access

  return prisma.scoreRun.create({
    data: {
      id: uuidv7(),
      candidateProfileId: profileId,
      formSubmissionId: submissionId,
      mode: candidateInput.mode,
      total: result.total,                       // typed Int column
      maxTotal: result.maxTotal,                 // 1500
      tier: result.tier,                         // typed Tier enum column
      byBlock: result.byBlock as object,         // JSONB — full block summary
      breakdown: result.breakdown as object,     // JSONB — full param list (incl. employer-only)
      configVersion,
      verificationBonus: result.byBlock.verification.awarded,
    },
  });
}
```

### 5.4 Re-scoring history

Each time a candidate updates answers or verifies a new document and triggers a re-score, the API writes a **new** `ScoreRun` row and never mutates prior rows. This is load-bearing for three reasons:

- **Score timeline:** the candidate report can chart "your score went 920 → 1040 → 1180" across time (see [frontend/pages/candidate-report.md](../frontend/pages/candidate-report.md)).
- **Defensible audit:** an employer who viewed a report at time T can always retrieve the exact numbers that existed at T — `ScoreRun` rows are immutable.
- **Safe calibration:** bumping `configVersion` (adjusting weights, changing tier bands) does not retro-change historical reports. Old runs carry their `configVersion` and their frozen `breakdown`.

`ScoreRun` therefore has **no** `updatedAt` and **no** `deletedAt`. Runs disappear only via cascade when the owning `CandidateProfile` is hard-purged (§8).

### 5.5 Filtering JSONB on read (audience views)

The full `breakdown` JSON is stored on every run. Audience filtering is applied **on read** in the reports service — never at write time. See [architecture/02-data-model.md §6](../architecture/02-data-model.md#6-visibility-enforcement--store-full-filter-on-read) for the full rationale and pseudocode.

```typescript
// apps/api/src/reports/reports.service.ts (excerpt)
function forAudience(run: ScoreRun, audience: 'candidate' | 'employer' | 'recruiter') {
  const full = run.breakdown as ParameterScoreSnapshot[];
  const visible =
    audience === 'candidate'
      ? full.filter((p) => p.visibility === 'all')   // suppress employer-only items
      : full;                                         // employer/recruiter: full breakdown

  return {
    ...run,
    audience,
    breakdown: visible,
    hiddenParameterCount: full.length - visible.length,
  };
}
```

---

## 6. Indexing strategy

The indexes defined in the Prisma schema (documented fully in [architecture/02-data-model.md §7](../architecture/02-data-model.md#7-indexing--query-patterns)) serve these concrete access patterns:

### 6.1 Latest ScoreRun per profile

The most frequent read pattern — fetching a candidate's current score for their dashboard and for employer report views:

```sql
-- Served by: @@index([candidateProfileId, createdAt]) on ScoreRun
SELECT DISTINCT ON (s."candidateProfileId") s.*
FROM "ScoreRun" s
ORDER BY s."candidateProfileId", s."createdAt" DESC;
```

The compound `(candidateProfileId, createdAt)` index makes `DISTINCT ON` efficient. Prisma ORM equivalent:

```typescript
prisma.scoreRun.findFirst({
  where: { candidateProfileId: profileId },
  orderBy: { createdAt: 'desc' },
});
```

**Phase 4 denormalization:** When the employer comparison/ranking dashboard (SCOPE §9) arrives and needs to filter/sort across thousands of candidates by `total` and `tier`, denormalize `CandidateProfile.latestScoreRunId` (updated transactionally on every new run so it always points to the latest). This avoids per-row `LIMIT 1` subqueries at scale:

```prisma
// Future addition to CandidateProfile (Phase 4)
latestScoreRunId String? @db.Uuid
latestScoreRun   ScoreRun? @relation("LatestRun", fields: [latestScoreRunId], references: [id])
```

### 6.2 Employer candidate search (Phase 4)

Employer search requires filtering across candidates by `tier` and/or `total`. The `ScoreRun @@index([tier])` index supports `WHERE tier = 'settled'` scans. Combined with the denormalized `latestScoreRunId` pointer, the query becomes a single join with no subquery:

```sql
-- Phase 4: filter candidates by tier via latestScoreRunId denormalization
SELECT cp.*, sr.total, sr.tier
FROM "CandidateProfile" cp
JOIN "ScoreRun" sr ON sr.id = cp."latestScoreRunId"
WHERE sr.tier = 'settled'
  AND cp."deletedAt" IS NULL
ORDER BY sr.total DESC;
```

### 6.3 ShareGrant lookups by employer

The `ShareGrant @@index([employerOrgId, status])` index supports the query "which candidates has this employer been granted access to, with an active share":

```typescript
prisma.shareGrant.findMany({
  where: {
    employerOrgId: orgId,
    status: 'active',
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  },
  include: { candidateProfile: true },
});
```

The `@@index([expiresAt])` on `ShareGrant` drives the expiry cron job that flips `status` to `'expired'` for grants past their `expiresAt`.

### 6.4 Soft-deleted rows for the purge job

Every PII-bearing entity has `@@index([deletedAt])`. The nightly purge job uses this to find rows past the grace window:

```typescript
const GRACE_DAYS = 7; // policy/calibration value; see SCOPE §11
const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000);

const toHardDelete = await prisma.user.findMany({
  where: { deletedAt: { lte: cutoff, not: null } },
  select: { id: true },
});
```

---

## 7. Connection pooling & transactions

### 7.1 Connection pooling

A NestJS API running multiple replicas will open one Prisma connection pool per instance. Without a connection pooler in front of Postgres, concurrent replicas can exhaust Postgres's `max_connections` (default 100 on Neon free tier).

**Configuration:**

```ini
# Limit Prisma's pool to 10 connections per API instance.
# With 3 replicas: 30 connections total, safely under the Postgres limit.
DATABASE_URL="postgresql://stabil:pass@db:5432/stabil?schema=public&connection_limit=10&pool_timeout=10"
```

**PgBouncer / Neon pooler:**

For production or staging on Neon, append `?pgbouncer=true` to the connection string and point `DATABASE_URL` at Neon's pooled endpoint (`:5432` → pooled port). Prisma's `pgbouncer=true` flag disables Prisma's own connection pool (since PgBouncer handles pooling) and switches to simple query mode (required for PgBouncer transaction-mode):

```ini
# Neon pooled endpoint (transaction mode)
DATABASE_URL="postgresql://stabil:pass@ep-xxx.us-east-1.aws.neon.tech:5432/stabil?sslmode=require&pgbouncer=true&connection_limit=1"
```

> **Caveat:** PgBouncer transaction mode does not support prepared statements or `LISTEN`/`NOTIFY`. Prisma disables prepared statements automatically when `pgbouncer=true` is set. This has no functional impact on Stabil's query patterns.

See [CLOUD.md §9.4](../CLOUD.md#94-database-connection-pooling) for the rationale and replica context.

### 7.2 `$transaction` — multi-write flows

Any operation that writes to more than one table must be wrapped in `prisma.$transaction()` to ensure atomicity. The two most important multi-write flows are:

#### Form submit → score run

When a candidate submits a form and triggers scoring, three writes must be atomic:

```typescript
// apps/api/src/scoring/scoring.service.ts
async function submitAndScore(
  prisma: PrismaService,
  profileId: string,
  mode: Mode,
  answers: AnswerInput[],
  configVersion: string,
): Promise<ScoreRun> {
  const submissionId = uuidv7();
  const scoreRunId = uuidv7();

  // Build normalized answers (rubric layer in packages/core)
  const normalized = normalizeAnswers(answers, mode);

  // Score synchronously (engine is pure, no I/O)
  const candidateInput: CandidateInput = { mode, values: normalized };
  const result = score(candidateInput);

  return prisma.$transaction(async (tx) => {
    // 1. Persist the form submission
    const submission = await tx.formSubmission.create({
      data: {
        id: submissionId,
        candidateProfileId: profileId,
        mode,
        configVersion,
        source: 'form',
      },
    });

    // 2. Persist each answer
    await tx.answer.createMany({
      data: answers.map((a) => ({
        id: uuidv7(),
        formSubmissionId: submission.id,
        parameterKey: a.key,
        rawValue: a.rawValue,
        normalized: normalized[a.key],
      })),
    });

    // 3. Persist the score run
    const run = await tx.scoreRun.create({
      data: {
        id: scoreRunId,
        candidateProfileId: profileId,
        formSubmissionId: submission.id,
        mode,
        total: result.total,
        maxTotal: result.maxTotal,
        tier: result.tier,
        byBlock: result.byBlock as object,
        breakdown: result.breakdown as object,
        configVersion,
        verificationBonus: result.byBlock.verification.awarded,
      },
    });

    return run;
  });
}
```

#### Consent grant → audit log

Granting a `ShareGrant` and writing the `AuditLog` row must be atomic so no consent is ever recorded without a corresponding audit event:

```typescript
async function grantShare(
  prisma: PrismaService,
  candidateProfileId: string,
  employerOrgId: string,
  consentIp: string,
  consentText: string,
): Promise<ShareGrant> {
  const grantId = uuidv7();

  return prisma.$transaction(async (tx) => {
    const grant = await tx.shareGrant.create({
      data: {
        id: grantId,
        candidateProfileId,
        audience: 'employer',
        employerOrgId,
        scope: ['report', 'breakdown'],
        status: 'active',
        consentedAt: new Date(),
        consentIp,
        consentText,
      },
    });

    await tx.auditLog.create({
      data: {
        id: uuidv7(),
        action: 'consent.grant',
        entityType: 'ShareGrant',
        entityId: grantId,
        metadata: { employerOrgId, scope: ['report', 'breakdown'] },
        ip: consentIp,
      },
    });

    return grant;
  });
}
```

#### Interactive vs. batch transactions

`$transaction(async (tx) => { ... })` is the **interactive** form. For bulk inserts where all operations are known upfront, the **batch** form is faster (one network round-trip instead of N):

```typescript
// Batch form — no interactive callback; all operations built up-front
await prisma.$transaction([
  prisma.user.create({ data: { id: uuidv7(), email: 'a@example.com' } }),
  prisma.role.create({ data: { id: uuidv7(), userId: '...', name: 'candidate' } }),
]);
```

Prefer the batch form for seed data and simple two-table writes; prefer the interactive form whenever the second write depends on the output of the first (e.g., the `scoreRunId` returned by step 3 is needed by later logic).

---

## 8. Soft-delete + purge job

### 8.1 The soft-delete pattern

Every PII-bearing entity carries `deletedAt DateTime?`. When a candidate requests deletion (or an admin removes a profile), the API sets `deletedAt = now()` immediately:

```typescript
// Soft-delete a user and all owned profiles in one transaction
async function softDeleteUser(prisma: PrismaService, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const now = new Date();

    // Mark the user deleted
    await tx.user.update({
      where: { id: userId },
      data: { deletedAt: now },
    });

    // Mark all owned profiles deleted (cascade to documents and report artifacts
    // is handled per-record by the purge job to enable storage cleanup first)
    await tx.candidateProfile.updateMany({
      where: { ownerUserId: userId, deletedAt: null },
      data: { deletedAt: now },
    });

    // Audit
    await tx.auditLog.create({
      data: {
        id: uuidv7(),
        actorId: userId,
        action: 'data.delete',
        entityType: 'User',
        entityId: userId,
        metadata: { reason: 'delete-on-request' },
      },
    });
  });
}
```

After the soft-delete, the `PrismaService` global middleware (§2.1) excludes the row from all standard reads. The user's data is effectively invisible but not yet removed from the database.

### 8.2 The purge job

A nightly Bull cron job (`PurgeProcessor`) hard-deletes rows that have been soft-deleted for longer than `GRACE_DAYS`. The grace window gives the candidate a chance to recover from accidental deletion requests and gives the system time to queue storage deletions.

```typescript
// apps/api/src/purge/purge.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { uuidv7 } from 'uuidv7';

const GRACE_DAYS = parseInt(process.env.PURGE_GRACE_DAYS ?? '7', 10);

@Processor('purge')
export class PurgeProcessor {
  private readonly logger = new Logger(PurgeProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Scheduled nightly by the Bull cron config in PurgeModule. */
  @Process('nightly-purge')
  async runNightlyPurge() {
    const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000);
    this.logger.log(`Running nightly purge. Cutoff: ${cutoff.toISOString()}`);

    await this.purgeDocuments(cutoff);
    await this.purgeReportArtifacts(cutoff);
    await this.purgeProfiles(cutoff);
    await this.purgeUsers(cutoff);
  }

  private async purgeDocuments(cutoff: Date) {
    // Bypass soft-delete middleware for purge queries
    const docs = await this.prisma.$queryRaw<{ id: string; storageKey: string }[]>`
      SELECT id, "storageKey"
      FROM "Document"
      WHERE "deletedAt" IS NOT NULL AND "deletedAt" <= ${cutoff}
    `;

    for (const doc of docs) {
      try {
        await this.storage.delete(doc.storageKey);               // delete from MinIO
        await this.prisma.$executeRaw`
          DELETE FROM "Document" WHERE id = ${doc.id}::uuid
        `;
        this.logger.verbose(`Purged Document ${doc.id}`);
      } catch (err) {
        this.logger.error(`Failed to purge Document ${doc.id}`, err);
        // Continue — idempotent on next run
      }
    }
  }

  private async purgeReportArtifacts(cutoff: Date) {
    const artifacts = await this.prisma.$queryRaw<{ id: string; storageKey: string }[]>`
      SELECT id, "storageKey"
      FROM "ReportArtifact"
      WHERE "deletedAt" IS NOT NULL AND "deletedAt" <= ${cutoff}
    `;

    for (const artifact of artifacts) {
      try {
        await this.storage.delete(artifact.storageKey);
        await this.prisma.$executeRaw`
          DELETE FROM "ReportArtifact" WHERE id = ${artifact.id}::uuid
        `;
      } catch (err) {
        this.logger.error(`Failed to purge ReportArtifact ${artifact.id}`, err);
      }
    }
  }

  private async purgeProfiles(cutoff: Date) {
    // Cascade handles: FormSubmission, Answer, ScoreRun, ShareGrant, VerificationCheck
    const result = await this.prisma.$executeRaw`
      DELETE FROM "CandidateProfile"
      WHERE "deletedAt" IS NOT NULL AND "deletedAt" <= ${cutoff}
    `;
    this.logger.log(`Purged ${result} CandidateProfile(s)`);
  }

  private async purgeUsers(cutoff: Date) {
    const result = await this.prisma.$executeRaw`
      DELETE FROM "User"
      WHERE "deletedAt" IS NOT NULL AND "deletedAt" <= ${cutoff}
    `;
    this.logger.log(`Purged ${result} User(s)`);

    // Append purge audit event (actor = null → system)
    await this.prisma.auditLog.create({
      data: {
        id: uuidv7(),
        actorId: null,
        action: 'data.purge',
        entityType: 'User',
        entityId: '00000000-0000-0000-0000-000000000000', // system sentinel
        metadata: { cutoff: cutoff.toISOString(), purgedCount: result },
      },
    });
  }
}
```

Register the cron schedule in `PurgeModule`:

```typescript
// apps/api/src/purge/purge.module.ts
import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';
import { PurgeProcessor } from './purge.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'purge' }),
  ],
  providers: [PurgeProcessor],
})
export class PurgeModule {}
```

Add the nightly cron job in the module's `onModuleInit` or via a separate scheduler:

```typescript
// Schedule nightly at 02:00 UTC using @nestjs/schedule
@Cron('0 2 * * *', { name: 'nightly-purge', timeZone: 'UTC' })
async scheduleNightlyPurge() {
  await this.purgeQueue.add('nightly-purge', {}, { removeOnComplete: true });
}
```

### 8.3 Purge job guarantees

| Guarantee | Mechanism |
|-----------|-----------|
| **Idempotent** | Each step uses `DELETE WHERE deletedAt <= cutoff`. Re-running after a partial failure skips already-purged rows. |
| **Storage before DB** | Object deletion happens before the DB row is removed. If storage deletion fails, the job logs the error and continues; the row remains for the next run. |
| **Cascades** | `onDelete: Cascade` on `FormSubmission`, `Answer`, `ScoreRun`, `VerificationCheck`, `ShareGrant` means deleting a `CandidateProfile` hard-deletes all its children automatically. |
| **AuditLog preserved until parent purge** | `AuditLog` has no `deletedAt` and no cascade from `User`. It is removed only when its `actorId` user is hard-deleted — and even then only via cascade. This preserves the audit trail to the last possible moment. |
| **GRACE_DAYS configurable** | Set `PURGE_GRACE_DAYS` in the environment. Default: 7. A short grace allows accidental-deletion recovery; a longer grace is more DPDP/GDPR-conservative. |

---

## 9. Testing the DB layer

### 9.1 Strategy overview

| Layer | Approach | Tool |
|-------|----------|------|
| **Repository unit tests** | Mock `PrismaService` | Vitest + `vi.fn()` |
| **Service unit tests** | Mock repositories | Vitest + `vi.fn()` |
| **Repository integration tests** | Real Postgres in Docker | `testcontainers` (Node.js) |
| **API integration tests (supertest)** | Real Postgres; seeded per-test schema | `testcontainers` |
| **CI** | GitHub Actions Postgres service container + `migrate deploy` | See [CLOUD.md §4.2](../CLOUD.md#42-github-actions-workflow) |

### 9.2 Testcontainers — disposable schema per test file

Use `testcontainers` to spin up an ephemeral Postgres instance per test file (or per test suite). Each suite gets its own isolated schema, eliminating state leakage between parallel test files.

```bash
pnpm add -D testcontainers
```

```typescript
// apps/api/test/helpers/db.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;

export async function setupTestDb(): Promise<PrismaClient> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('stabil_test')
    .withUsername('stabil')
    .withPassword('test')
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;

  // Apply all migrations (same as CI / production path)
  execSync('pnpm --filter @stabil/db exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();

  return prisma;
}

export async function teardownTestDb(): Promise<void> {
  await prisma.$disconnect();
  await container.stop();
}
```

```typescript
// apps/api/src/profiles/profiles.repository.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb } from '../../test/helpers/db';
import { ProfilesRepository } from './profiles.repository';
import { PrismaService } from '../db/prisma.service';

// PrismaService is a subclass of PrismaClient; cast for tests.
let prisma: PrismaClient;
let repo: ProfilesRepository;

beforeAll(async () => {
  prisma = await setupTestDb();
  repo = new ProfilesRepository(prisma as unknown as PrismaService);
});

afterAll(() => teardownTestDb());

describe('ProfilesRepository', () => {
  it('creates a fresher profile with unclaimed status', async () => {
    const profile = await repo.create({ mode: 'fresher' });

    expect(profile.mode).toBe('fresher');
    expect(profile.claimStatus).toBe('unclaimed');
    expect(profile.ownerUserId).toBeNull();
  });

  it('returns null for latestScoreRun when no runs exist', async () => {
    const profile = await repo.create({ mode: 'professional' });
    const run = await repo.latestScoreRun(profile.id);
    expect(run).toBeNull();
  });

  it('soft-deletes a profile and hides it from standard reads', async () => {
    const profile = await repo.create({ mode: 'fresher' });
    await repo.softDelete(profile.id);

    // Standard read (soft-delete middleware active) → not found
    const found = await prisma.candidateProfile.findUnique({
      where: { id: profile.id },
    });
    // With the global middleware: deletedAt IS NULL filter applied → null
    expect(found).toBeNull();

    // Raw read bypasses middleware → row still exists
    const raw = await prisma.$queryRaw<{ id: string; deletedAt: Date | null }[]>`
      SELECT id, "deletedAt" FROM "CandidateProfile" WHERE id = ${profile.id}::uuid
    `;
    expect(raw[0].deletedAt).not.toBeNull();
  });
});
```

### 9.3 Lightweight alternative — disposable schema on a shared Postgres

If testcontainers is too slow for your local machine (Docker pull + container start adds ~10 s), an alternative is to create a **unique schema** per test file on the shared local Postgres:

```typescript
// apps/api/test/helpers/schema-db.ts
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export async function setupSchemaDb() {
  const schema = `test_${randomUUID().replace(/-/g, '_')}`;
  const url = `${process.env.DATABASE_URL}&schema=${schema}`;

  // Push the schema using prisma db push (fast; no migration files needed for tests)
  execSync(`pnpm --filter @stabil/db exec prisma migrate deploy`, {
    env: { ...process.env, DATABASE_URL: url },
  });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();

  return {
    prisma,
    teardown: async () => {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await prisma.$disconnect();
    },
  };
}
```

This approach is faster (no container startup) but requires a local Postgres to be running. Use testcontainers in CI where the environment is controlled; use the schema approach locally for speed.

### 9.4 Factory helpers

Write factory functions to create test fixtures with sensible defaults. Keep factories in `apps/api/test/factories/`:

```typescript
// apps/api/test/factories/user.factory.ts
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

export async function createUser(
  prisma: PrismaClient,
  overrides: Partial<{ email: string; fullName: string }> = {},
) {
  return prisma.user.create({
    data: {
      id: uuidv7(),
      email: overrides.email ?? `user-${uuidv7()}@test.stabil.app`,
      fullName: overrides.fullName ?? 'Test User',
    },
  });
}

export async function createCandidateProfile(
  prisma: PrismaClient,
  userId: string,
  overrides: Partial<{ mode: 'fresher' | 'professional' }> = {},
) {
  return prisma.candidateProfile.create({
    data: {
      id: uuidv7(),
      mode: overrides.mode ?? 'fresher',
      ownerUserId: userId,
      claimStatus: 'claimed',
    },
  });
}
```

### 9.5 What not to test at the DB layer

- **Scoring logic** — test that in `packages/scoring` with pure Vitest unit tests (no DB required).
- **HTTP request validation** — test that in controller unit tests or supertest integration tests.
- **Prisma schema validity** — `prisma validate` in CI catches this. No separate test needed.

The DB layer tests focus on: queries return the right rows, indexes are used (use `EXPLAIN ANALYZE` in a dedicated performance test), soft-delete middleware hides deleted rows, and transactions roll back on error.
