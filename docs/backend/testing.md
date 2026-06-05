# Backend Test Strategy

> **Status:** Draft v0.1 · **Phase:** cross-cutting (foundations in Phase 0; coverage grows through Phase 3) · **Owner area:** backend
> **Related:** [best-practices.md](./best-practices.md), [modules/scoring.md](./modules/scoring.md), [modules/consent-sharing.md](./modules/consent-sharing.md), [architecture/03-scoring-engine.md](../architecture/03-scoring-engine.md), [architecture/04-api-contracts.md](../architecture/04-api-contracts.md), [architecture/05-security-privacy.md](../architecture/05-security-privacy.md)

This document is the authoritative test strategy for the Stabil NestJS backend. It covers every tier of the test pyramid, describes the fixture and factory system, defines the concrete guard tests that enforce security invariants, specifies CI wiring, and sets coverage targets. The invariants tested here — particularly the audience-filtering invariant and the ConsentGuard — are trust anchors: they prevent the product's two most legally consequential failure modes (PII leakage and unauthorized report access; see SCOPE §12 and §6.2).

---

## 1. Test Pyramid Overview

```
                 ┌──────────────────────────────┐
                 │    API E2E (supertest)        │  slowest, fewest
                 │    auth · scoring · report    │
                 │    consent · PDF job          │
                 ├──────────────────────────────┤
                 │  Integration (testcontainers) │
                 │  real Postgres · Prisma       │
                 │  repositories · transactions  │
                 │  purge job · share expiry     │
                 ├──────────────────────────────┤
                 │  Unit (Vitest)                │  fastest, most numerous
                 │  @stabil/scoring engine       │
                 │  packages/core rubric layer   │
                 │  NestJS service methods        │
                 └──────────────────────────────┘
```

| Tier | Runner | Speed | Count target | What is doubled |
|------|--------|-------|-------------|-----------------|
| Unit | Vitest | < 5 s total | 200+ | Pure functions, services with mocked deps |
| Integration | Vitest + testcontainers | < 60 s total | 60–80 | Real Postgres, Prisma client, transactions |
| API E2E | Vitest + supertest | < 90 s total | 40–60 | Full HTTP stack, guards, interceptors |
| Contract | Vitest + openapi-fetch | < 10 s total | per-endpoint | OpenAPI spec vs implementation |

---

## 2. Unit Tests (Vitest)

Unit tests cover **pure logic**: the scoring engine, the rubric layer (`packages/core`), and any NestJS service method that can be tested with mocked Prisma/Redis/MinIO. No database, no HTTP, no file system.

### 2.1 File layout

```
packages/
  scoring/src/
    tier.test.ts          # mapTier — boundary values, out-of-range clamp
    score.test.ts         # computeScore — parameter math, mode filter, byBlock, clamp
    audience.test.ts      # filterForAudience — candidate hides employer-only; total/tier unchanged
    config.test.ts        # stabilConfig invariants — scale, uniqueness, per-mode maxes = 1500
  core/src/
    rubrics/
      academics.test.ts
      experience.test.ts
      tenure.test.ts
      languages.test.ts
      verification.test.ts
      communication.test.ts
      age.test.ts            # rubric only; visibility enforcement tested separately
      marital.test.ts

apps/api/src/
  scoring/scoring.service.test.ts       # mocked Prisma + @stabil/scoring
  consent/consent.service.test.ts       # mocked Prisma + ShareGrant state machine
  reports/reports.service.test.ts       # assembly + improvementGuidance derivation
  auth/auth.service.test.ts             # JWT sign/verify + bcrypt (sync) logic
```

### 2.2 Configuration invariants (`packages/scoring`)

These tests exist today and must never be deleted. They are the primary enforcement of the 1500-per-mode invariant (SCOPE §4.1, §4.2).

```ts
// packages/scoring/src/config.test.ts
import { describe, it, expect } from "vitest";
import { stabilConfig } from "./config";

const modes = ["fresher", "professional"] as const;

describe("stabilConfig invariants", () => {
  it("scaleMax is 1500", () => {
    expect(stabilConfig.scaleMax).toBe(1500);
  });

  it("parameter keys are unique", () => {
    const keys = stabilConfig.parameters.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(modes)(
    "applicable parameter maxes sum to the full scale for '%s'",
    (mode) => {
      const sum = stabilConfig.parameters
        .filter((p) => p.appliesTo === mode || p.appliesTo === "both")
        .reduce((acc, p) => acc + p.max, 0);
      expect(sum).toBe(stabilConfig.scaleMax); // 1500
    },
  );

  it.each(modes)(
    "a perfect candidate (all fractions = 1) scores exactly 1500 and 'stable' for '%s'",
    (mode) => {
      const values = Object.fromEntries(
        stabilConfig.parameters.map((p) => [p.key, 1]),
      );
      const result = computeScore({ mode, values }, stabilConfig);
      expect(result.total).toBe(1500);
      expect(result.tier).toBe("stable");
    },
  );

  it("age and maritalStatus are visibility === 'employer-only'", () => {
    const sensitiveKeys = ["age", "maritalStatus"];
    for (const key of sensitiveKeys) {
      const param = stabilConfig.parameters.find((p) => p.key === key)!;
      expect(param.visibility).toBe("employer-only");
    }
  });
});
```

### 2.3 Rubric layer unit tests (`packages/core`)

Every rubric function is a pure `(raw) => number ∈ [0,1]` mapping. Tests follow this pattern:

```ts
// packages/core/src/rubrics/academics.test.ts
import { describe, it, expect } from "vitest";
import { academicsRubric } from "./academics";

describe("academicsRubric", () => {
  it("returns 0 when no academic data is provided", () => {
    expect(academicsRubric({})).toBe(0);
  });

  it("maps 90% to 1.0 (distinction)", () => {
    expect(academicsRubric({ percentage: 90 })).toBe(1.0);
  });

  it("converts GPA to percentage when gpaScale is provided", () => {
    // 3.6 / 4.0 = 90% → 1.0
    expect(academicsRubric({ gpa: 3.6, gpaScale: 4 })).toBe(1.0);
  });

  it("output is always in [0, 1] for any input", () => {
    const extremes = [
      { percentage: -10 },
      { percentage: 150 },
      { gpa: 0, gpaScale: 10 },
      { gpa: 100, gpaScale: 4 },
    ];
    for (const input of extremes) {
      const f = academicsRubric(input);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});
```

Rubric tests to cover for **all parameters**:

| Rubric | Key cases |
|--------|-----------|
| `academicsRubric` | No data → 0; GPA-to-pct conversion; each band boundary; clamp above 100% |
| `experienceRubric` | 0 years → 0; saturation near 12y; monotonic increase |
| `tenureRubric` | Empty jobs → 0; each band; hop-penalty capping; many short stints |
| `projectsRubric` | Zero projects → 0; COUNT_CAP projects × quality = 1; quality clamp |
| `communicationRubric` | Pure self-rating path; cert bonus capped at 0.2; combined cap at 1 |
| `languagesRubric` | 0 → 0; CAP languages → 1; output clamped |
| `verificationRubric` | No docs → 0; govId only = 0.5; all three = 1.0 |
| `ageRubric` | Each age band; `employer-only` visibility enforced by separate test |
| `maritalRubric` | `married` → 1.0; `single` → 0.5; `other` → 0.5 |

### 2.4 Scoring service unit tests

```ts
// apps/api/src/scoring/scoring.service.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Test } from "@nestjs/testing";
import { ScoringService } from "./scoring.service";
import { PrismaService } from "../prisma/prisma.service";
import { computeScore, filterForAudience, stabilConfig } from "@stabil/scoring";

const mockPrisma = {
  scoreRun: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
  formSubmission: { findFirst: vi.fn() },
  $transaction: vi.fn((fn) => fn(mockPrisma)),
};

describe("ScoringService", () => {
  let service: ScoringService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ScoringService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(ScoringService);
    vi.clearAllMocks();
  });

  it("creates a ScoreRun from the current FormSubmission", async () => {
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-1",
      profileId: "prof-1",
      mode: "professional",
      answers: { totalExperienceYears: 7, averageTenureYears: 3 },
    });
    mockPrisma.scoreRun.create.mockResolvedValue({ id: "run-1" });

    const run = await service.runScore({ profileId: "prof-1" });

    expect(mockPrisma.scoreRun.create).toHaveBeenCalledOnce();
    const createArg = mockPrisma.scoreRun.create.mock.calls[0][0];
    // The engine result must be stored unfiltered (full breakdown)
    expect(createArg.data.breakdown).toBeDefined();
    expect(createArg.data.total).toBeGreaterThanOrEqual(0);
    expect(createArg.data.total).toBeLessThanOrEqual(1500);
  });

  it("stores the full unfiltered breakdown regardless of input mode", async () => {
    mockPrisma.formSubmission.findFirst.mockResolvedValue({
      id: "sub-2",
      profileId: "prof-2",
      mode: "professional",
      answers: { age: 32, maritalStatus: "married" },
    });
    mockPrisma.scoreRun.create.mockResolvedValue({ id: "run-2" });

    await service.runScore({ profileId: "prof-2" });

    const breakdown = mockPrisma.scoreRun.create.mock.calls[0][0].data.breakdown;
    const ageInRun = breakdown.some((p: { key: string }) => p.key === "age");
    // employer-only items MUST be persisted in the raw run
    expect(ageInRun).toBe(true);
  });
});
```

---

## 3. Integration Tests (testcontainers + Prisma)

Integration tests run against a **real PostgreSQL container** started and torn down by [`testcontainers`](https://www.testcontainers.org/). They exercise Prisma repositories, transactions, and async jobs — anything that requires a real database.

### 3.1 Setup

```ts
// apps/api/src/test/integration-setup.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "child_process";

let pg: StartedPostgreSqlContainer;

export async function setupPg(): Promise<string> {
  pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("stabil_test")
    .withUsername("stabil")
    .withPassword("stabil")
    .start();

  const url = pg.getConnectionUri();
  process.env.DATABASE_URL = url;

  // Run Prisma migrations against the fresh container
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url } });
  return url;
}

export async function teardownPg(): Promise<void> {
  await pg?.stop();
}

export async function clearAllTables(prisma: PrismaClient): Promise<void> {
  // Order matters: FK-constrained tables first
  await prisma.$executeRaw`TRUNCATE "AuditLog","Notification","ReportArtifact","ShareGrant",
    "VerificationCheck","Document","ScoreRun","FormSubmission","CandidateProfile",
    "Session","AuthIdentity","User" CASCADE`;
}
```

```ts
// vitest.integration.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    globalSetup: "./apps/api/src/test/integration-global-setup.ts",
    poolOptions: { forks: { singleFork: true } }, // one container per suite
    testTimeout: 30_000,
  },
});
```

### 3.2 Repository tests

```ts
// apps/api/src/profiles/profiles.repository.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { setupPg, teardownPg, clearAllTables } from "../test/integration-setup";
import { ProfilesRepository } from "./profiles.repository";
import { UserFactory, ProfileFactory } from "../test/factories";

let prisma: PrismaClient;
let repo: ProfilesRepository;

beforeAll(async () => {
  await setupPg();
  prisma = new PrismaClient();
  repo = new ProfilesRepository(prisma);
});
afterAll(() => teardownPg());
beforeEach(() => clearAllTables(prisma));

describe("ProfilesRepository", () => {
  it("creates a profile and reads it back", async () => {
    const user = await UserFactory.create(prisma, { role: "candidate" });
    const profile = await repo.create({
      ownerUserId: user.id,
      fullName: "Asha R",
      mode: "professional",
    });

    const found = await repo.findById(profile.id);
    expect(found?.fullName).toBe("Asha R");
    expect(found?.mode).toBe("professional");
  });

  it("claimable profile has null ownerUserId", async () => {
    const employer = await UserFactory.create(prisma, { role: "employer" });
    const profile = await repo.createClaimable({
      submittedByUserId: employer.id,
      candidateEmail: "ravi@example.com",
      fullName: "Ravi K",
    });

    expect(profile.ownerUserId).toBeNull();
    expect(profile.claimStatus).toBe("unclaimed");
  });
});
```

### 3.3 Transaction tests

Scoring a profile updates both `ScoreRun` and `CandidateProfile.latestScoreRunId` atomically. The integration test verifies rollback on failure:

```ts
// apps/api/src/scoring/scoring.repository.integration.test.ts
describe("ScoreRun creation — transactional integrity", () => {
  it("rolls back latestScoreRunId update if ScoreRun insertion fails", async () => {
    const { user, profile, submission } = await seedScoringFixture(prisma);

    // Simulate a mid-transaction failure by making the UPDATE raise
    await prisma.$executeRaw`ALTER TABLE "ScoreRun" ADD CONSTRAINT bad_check CHECK (false)`;

    await expect(
      repo.createScoreRun({ profileId: profile.id, submissionId: submission.id }),
    ).rejects.toThrow();

    // Profile.latestScoreRunId must still be null — transaction rolled back
    const refreshed = await prisma.candidateProfile.findUniqueOrThrow({ where: { id: profile.id } });
    expect(refreshed.latestScoreRunId).toBeNull();

    await prisma.$executeRaw`ALTER TABLE "ScoreRun" DROP CONSTRAINT bad_check`;
  });
});
```

### 3.4 Purge job integration test

The data-deletion purge job hard-deletes PII after the grace window. The test manipulates `purgeAfter` directly.

```ts
// apps/api/src/account/purge-job.integration.test.ts
describe("PurgeJob", () => {
  it("hard-deletes user and all FK-constrained children past the grace window", async () => {
    const user = await UserFactory.create(prisma, { role: "candidate" });
    const profile = await ProfileFactory.create(prisma, { ownerUserId: user.id });

    // Schedule deletion with purgeAfter in the past
    await prisma.deletionTicket.create({
      data: { userId: user.id, purgeAfter: new Date(Date.now() - 1000) },
    });

    await purgeJob.run(); // invokes the scheduled task

    const userAfter = await prisma.user.findUnique({ where: { id: user.id } });
    const profileAfter = await prisma.candidateProfile.findUnique({ where: { id: profile.id } });
    expect(userAfter).toBeNull();
    expect(profileAfter).toBeNull();
  });

  it("does NOT delete users whose purgeAfter is in the future", async () => {
    const user = await UserFactory.create(prisma);
    await prisma.deletionTicket.create({
      data: { userId: user.id, purgeAfter: new Date(Date.now() + 3_600_000) },
    });

    await purgeJob.run();

    const userAfter = await prisma.user.findUnique({ where: { id: user.id } });
    expect(userAfter).not.toBeNull();
  });
});
```

### 3.5 ShareGrant expiry test

```ts
// apps/api/src/consent/share-grant-expiry.integration.test.ts
describe("ShareGrant expiry", () => {
  it("marks grants as 'expired' when expiresAt is in the past", async () => {
    const { candidate, employer, profile } = await seedConsentFixture(prisma);
    const grant = await prisma.shareGrant.create({
      data: {
        profileId: profile.id,
        grantedByUserId: candidate.id,
        grantedToEmail: employer.email,
        scope: "report-full",
        status: "accepted",
        expiresAt: new Date(Date.now() - 1),
      },
    });

    await shareExpiryJob.run();

    const refreshed = await prisma.shareGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(refreshed.status).toBe("expired");
  });
});
```

---

## 4. API E2E Tests (supertest)

E2E tests boot the full NestJS application in-process against a real Postgres container (the same container as the integration tier, reused within one CI run) and make real HTTP requests via `supertest`. Guards, interceptors, and pipes all fire.

### 4.1 App bootstrap helper

```ts
// apps/api/src/test/app-bootstrap.ts
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import * as supertest from "supertest";

let app: INestApplication;

export async function bootstrapApp(): Promise<INestApplication> {
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  await app.init();
  return app;
}

export const api = (app: INestApplication) => supertest(app.getHttpServer());
```

### 4.2 Auth E2E

```ts
// apps/api/src/auth/auth.e2e.test.ts
describe("POST /api/v1/auth/register", () => {
  it("201 — creates candidate user and returns tokens", async () => {
    const res = await api(app).post("/api/v1/auth/register").send({
      email: "asha@example.com",
      password: "correct-horse-battery",
      displayName: "Asha R",
      role: "candidate",
    });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.role).toBe("candidate");
  });

  it("409 — duplicate email returns conflict problem+json", async () => {
    await registerCandidate(app, "dup@example.com");
    const res = await api(app).post("/api/v1/auth/register").send({
      email: "dup@example.com",
      password: "correct-horse-battery",
      displayName: "Dup",
      role: "candidate",
    });

    expect(res.status).toBe(409);
    expect(res.body.type).toContain("conflict");
  });

  it("422 — short password returns validation problem+json with errors[]", async () => {
    const res = await api(app).post("/api/v1/auth/register").send({
      email: "x@y.com",
      password: "short",
      displayName: "X",
      role: "candidate",
    });

    expect(res.status).toBe(422);
    expect(res.body.errors).toBeInstanceOf(Array);
    expect(res.body.errors[0].path).toMatch(/password/);
  });

  it("401 — expired token is rejected on a protected endpoint", async () => {
    const expiredToken = signToken({ sub: "fake", role: "candidate" }, { expiresIn: "0s" });
    const res = await api(app)
      .get("/api/v1/profiles/mine")
      .set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
  });
});
```

### 4.3 Score run E2E

```ts
// apps/api/src/scoring/scoring.e2e.test.ts
describe("POST /api/v1/scoring/runs", () => {
  it("201 — returns a ScoreRun with total in [0, 1500]", async () => {
    const { accessToken, profileId } = await seedScoredCandidate(app, "professional");

    const res = await api(app)
      .post("/api/v1/scoring/runs")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", randomUUID())
      .send({ profileId });

    expect(res.status).toBe(201);
    expect(res.body.total).toBeGreaterThanOrEqual(0);
    expect(res.body.total).toBeLessThanOrEqual(1500);
    expect(["unstable", "developing", "somewhat-stable", "settled", "stable"]).toContain(res.body.tier);
  });

  it("400 — missing Idempotency-Key", async () => {
    const { accessToken, profileId } = await seedScoredCandidate(app, "fresher");
    const res = await api(app)
      .post("/api/v1/scoring/runs")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ profileId });

    expect(res.status).toBe(400);
    expect(res.body.type).toContain("idempotency-key-required");
  });

  it("200 — same Idempotency-Key + body replays original run", async () => {
    const { accessToken, profileId } = await seedScoredCandidate(app, "professional");
    const idemKey = randomUUID();
    const body = { profileId };

    const first = await api(app)
      .post("/api/v1/scoring/runs")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", idemKey)
      .send(body);
    expect(first.status).toBe(201);

    const second = await api(app)
      .post("/api/v1/scoring/runs")
      .set("Authorization", `Bearer ${accessToken}`)
      .set("Idempotency-Key", idemKey)
      .send(body);

    expect(second.status).toBe(200);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.body.id).toBe(first.body.id);
  });
});
```

### 4.4 Report E2E

```ts
// apps/api/src/reports/reports.e2e.test.ts
describe("GET /api/v1/profiles/:id/report", () => {
  it("200 candidate view — employer-only items are absent, total is set", async () => {
    const { candidateToken, profileId } = await seedScoredProfessional(app);

    const res = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${candidateToken}`);

    expect(res.status).toBe(200);
    expect(res.body.audience).toBe("candidate");
    const keys = res.body.breakdown.map((p: { key: string }) => p.key);
    expect(keys).not.toContain("age");
    expect(keys).not.toContain("maritalStatus");
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.hiddenLineItemCount).toBeGreaterThan(0);
    expect(res.body.improvementGuidance).toBeInstanceOf(Array);
  });

  it("403 consent-required — employer without a share cannot read the report", async () => {
    const { profileId } = await seedScoredProfessional(app);
    const { accessToken: employerToken } = await registerUser(app, { role: "employer" });

    const res = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${employerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.type).toContain("consent-required");
  });

  it("404 — no score run yet returns not-found", async () => {
    const { candidateToken, profileId } = await seedUnscoredProfile(app);
    const res = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${candidateToken}`);

    expect(res.status).toBe(404);
  });
});
```

---

## 5. Contract Tests vs Generated OpenAPI

The OpenAPI spec at `/api/v1/openapi.json` is generated from the Zod schemas in `packages/contracts` (SCOPE §10, API conventions [04-api-contracts.md](../architecture/04-api-contracts.md)). Contract tests verify that every endpoint's real response matches the spec — preventing the two from drifting. The adapter is [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/).

### 5.1 Setup

```ts
// apps/api/src/test/contract-setup.ts
import createClient from "openapi-fetch";
import type { paths } from "../generated/openapi-types"; // generated by openapi-typescript

export function createContractClient(baseUrl: string) {
  return createClient<paths>({ baseUrl });
}
```

### 5.2 Contract test pattern

```ts
// apps/api/src/test/contract.test.ts
describe("OpenAPI contract — POST /auth/register", () => {
  it("register response matches the OpenAPI schema", async () => {
    const client = createContractClient(`http://localhost:${port}`);
    const { data, error, response } = await client.POST("/api/v1/auth/register", {
      body: {
        email: "contract@test.com",
        password: "contract-password",
        displayName: "Contract Test",
        role: "candidate",
      },
    });

    // openapi-fetch validates the response shape against the generated types at compile-time.
    // The test confirms there is no runtime error (error === undefined) and data is typed.
    expect(error).toBeUndefined();
    expect(response.status).toBe(201);
    expect(data?.user.role).toBe("candidate");
  });
});
```

Run `pnpm openapi-typescript /api/v1/openapi.json -o apps/api/src/generated/openapi-types.d.ts` as a pre-test step; the CI fails if the generated file is stale or the server returns a shape that deviates from it.

---

## 6. Fixtures & Factories

All tests share a factory module in `apps/api/src/test/factories.ts` that builds deterministic, minimal records using real Prisma models. Factories accept partial overrides and supply sensible defaults.

### 6.1 Base factories

```ts
// apps/api/src/test/factories.ts
import { PrismaClient } from "@prisma/client";
import { hash } from "bcrypt";
import { randomUUID } from "crypto";

export const UserFactory = {
  async create(
    prisma: PrismaClient,
    overrides: Partial<{ email: string; role: string; displayName: string }> = {},
  ) {
    const email = overrides.email ?? `user-${randomUUID()}@example.com`;
    const passwordHash = await hash("test-password-123", 10);
    return prisma.user.create({
      data: {
        email,
        displayName: overrides.displayName ?? "Test User",
        authIdentities: {
          create: { provider: "email", credential: passwordHash },
        },
        roles: { create: { name: overrides.role ?? "candidate" } },
      },
      include: { roles: true },
    });
  },
};

export const ProfileFactory = {
  async create(
    prisma: PrismaClient,
    overrides: Partial<{
      ownerUserId: string;
      mode: "fresher" | "professional";
      fullName: string;
    }> = {},
  ) {
    return prisma.candidateProfile.create({
      data: {
        ownerUserId: overrides.ownerUserId ?? null,
        mode: overrides.mode ?? "professional",
        fullName: overrides.fullName ?? "Test Candidate",
        claimStatus: overrides.ownerUserId ? "claimed" : "unclaimed",
      },
    });
  },
};

export const SubmissionFactory = {
  async create(
    prisma: PrismaClient,
    overrides: Partial<{
      profileId: string;
      mode: "fresher" | "professional";
      answers: Record<string, unknown>;
    }> = {},
  ) {
    return prisma.formSubmission.create({
      data: {
        profileId: overrides.profileId!,
        mode: overrides.mode ?? "professional",
        answers: overrides.answers ?? defaultProfessionalAnswers(),
        version: 1,
      },
    });
  },
};

export const ShareGrantFactory = {
  async create(
    prisma: PrismaClient,
    overrides: Partial<{
      profileId: string;
      grantedByUserId: string;
      grantedToEmail: string;
      scope: "report-summary" | "report-full";
      status: "pending" | "accepted" | "revoked" | "expired";
      expiresAt: Date;
    }> = {},
  ) {
    return prisma.shareGrant.create({
      data: {
        profileId: overrides.profileId!,
        grantedByUserId: overrides.grantedByUserId!,
        grantedToEmail: overrides.grantedToEmail ?? "employer@example.com",
        scope: overrides.scope ?? "report-full",
        status: overrides.status ?? "pending",
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 86_400_000 * 30),
      },
    });
  },
};
```

### 6.2 Composite seeds

```ts
// apps/api/src/test/seeds.ts
export async function seedScoredProfessional(app: INestApplication) {
  const prisma = app.get(PrismaService);
  const user = await UserFactory.create(prisma, { role: "candidate" });
  const profile = await ProfileFactory.create(prisma, {
    ownerUserId: user.id,
    mode: "professional",
  });
  const submission = await SubmissionFactory.create(prisma, {
    profileId: profile.id,
    mode: "professional",
    answers: defaultProfessionalAnswers(),
  });
  const accessToken = await mintToken(app, user);

  // Trigger a score run via the HTTP layer so the full pipeline fires
  await api(app)
    .post("/api/v1/scoring/runs")
    .set("Authorization", `Bearer ${accessToken}`)
    .set("Idempotency-Key", randomUUID())
    .send({ profileId: profile.id });

  return { candidateToken: accessToken, profileId: profile.id, userId: user.id };
}

export async function seedConsentFixture(prisma: PrismaClient) {
  const candidate = await UserFactory.create(prisma, { role: "candidate" });
  const employer = await UserFactory.create(prisma, { role: "employer" });
  const profile = await ProfileFactory.create(prisma, { ownerUserId: candidate.id });
  return { candidate, employer, profile };
}
```

### 6.3 Golden-resume fixtures (parsing evaluation)

Golden fixtures are fixed-format resumes stored in `apps/api/src/test/fixtures/resumes/` alongside expected parse outputs. Used in Phase 2 to evaluate the Ollama parsing pipeline without re-running inference:

```
apps/api/src/test/fixtures/resumes/
  fresher-cs-2024-expected.ts        # expected SubmissionAnswers for fresher
  professional-senior-expected.ts    # expected SubmissionAnswers for professional
  sparse-no-gpa-expected.ts          # graceful degradation (missing academic data → 0)
  professional-hopper-expected.ts    # 6 jobs in 4 years → low tenure score
```

Each `*-expected.ts` exports a typed object:

```ts
// apps/api/src/test/fixtures/resumes/professional-senior-expected.ts
import type { SubmissionAnswers } from "@stabil/contracts";

export const expected: Partial<SubmissionAnswers> = {
  totalExperienceYears: 9,
  averageTenureYears: 2.5,
  spokenLanguages: ["en", "hi"],
  communicationSelfRating: 4,
};

// Tolerance for parsed numeric fields (years can vary ±0.5 due to date rounding)
export const tolerance = { totalExperienceYears: 0.5, averageTenureYears: 0.3 };
```

A parsing eval test applies each fixture through the real (or mocked) Ollama adapter and asserts outputs are within tolerance:

```ts
// apps/api/src/parsing/parsing-eval.test.ts
import { describe, it, expect } from "vitest";
import { parseResume } from "./resume-parser";
import * as fixture from "../test/fixtures/resumes/professional-senior-expected";
import resumeText from "../test/fixtures/resumes/professional-senior.txt?raw";

describe("Resume parsing golden fixtures", () => {
  it("professional-senior: extracts experience and tenure within tolerance", async () => {
    const result = await parseResume(resumeText, "professional");

    for (const [key, expectedVal] of Object.entries(fixture.expected)) {
      const tol = fixture.tolerance[key as keyof typeof fixture.tolerance] ?? 0;
      expect(result.answers[key as keyof typeof result.answers]).toBeCloseTo(
        expectedVal as number,
        tol === 0 ? 0 : -Math.log10(tol),
      );
    }
  });
});
```

---

## 7. Guard Tests

### 7.1 RolesGuard

`RolesGuard` enforces the `@Roles(...)` decorator. Unit-test it directly using a mock `ExecutionContext`:

```ts
// apps/api/src/auth/roles.guard.test.ts
import { describe, it, expect } from "vitest";
import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";
import { createMockExecutionContext } from "../test/mock-context";

const reflector = new Reflector();
const guard = new RolesGuard(reflector);

describe("RolesGuard", () => {
  it("allows access when the user's role matches the required role", () => {
    const ctx = createMockExecutionContext({
      user: { sub: "u1", role: "employer" },
      requiredRoles: ["employer", "recruiter"],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("denies access when the user's role is not in the allowed list", () => {
    const ctx = createMockExecutionContext({
      user: { sub: "u1", role: "candidate" },
      requiredRoles: ["employer"],
    });
    expect(guard.canActivate(ctx)).toBe(false);
  });

  it("allows access when no @Roles decorator is present (open endpoint)", () => {
    const ctx = createMockExecutionContext({
      user: { sub: "u1", role: "candidate" },
      requiredRoles: null, // no decorator
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("denies 'admin' when not listed — admin is not implicitly privileged", () => {
    const ctx = createMockExecutionContext({
      user: { sub: "u1", role: "admin" },
      requiredRoles: ["employer"],
    });
    expect(guard.canActivate(ctx)).toBe(false);
  });
});
```

### 7.2 ConsentGuard — no report without a valid ShareGrant

`ConsentGuard` is the critical guard for SCOPE §6.2 and §18: an employer or recruiter **must** have an accepted, non-expired, non-revoked `ShareGrant` for a profile before reading its report. The guard is applied to the report and compare endpoints.

**Unit test (mocked Prisma):**

```ts
// apps/api/src/consent/consent.guard.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsentGuard } from "./consent.guard";
import { PrismaService } from "../prisma/prisma.service";
import { createMockExecutionContext } from "../test/mock-context";
import { ForbiddenException } from "@nestjs/common";

const mockPrisma = {
  shareGrant: { findFirst: vi.fn() },
};

const guard = new ConsentGuard(mockPrisma as unknown as PrismaService);

const makeCtx = (role: string, profileId = "prof-1") =>
  createMockExecutionContext({ user: { sub: "u1", role }, params: { profileId } });

beforeEach(() => vi.clearAllMocks());

describe("ConsentGuard", () => {
  it("passes for a 'candidate' role — candidates access their own report without a grant", async () => {
    const ctx = makeCtx("candidate");
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockPrisma.shareGrant.findFirst).not.toHaveBeenCalled();
  });

  it("passes for 'admin' role — admins bypass consent", async () => {
    const ctx = makeCtx("admin");
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("passes for 'employer' with an accepted, non-expired grant", async () => {
    mockPrisma.shareGrant.findFirst.mockResolvedValue({
      id: "grant-1",
      status: "accepted",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const ctx = makeCtx("employer");
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("throws ForbiddenException (consent-required) for 'employer' with NO grant", async () => {
    mockPrisma.shareGrant.findFirst.mockResolvedValue(null);
    const ctx = makeCtx("employer");
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("throws ForbiddenException for 'employer' with a revoked grant", async () => {
    mockPrisma.shareGrant.findFirst.mockResolvedValue({
      id: "grant-2",
      status: "revoked",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const ctx = makeCtx("employer");
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("throws 410 Gone (share-expired) for an accepted but past-expiry grant", async () => {
    mockPrisma.shareGrant.findFirst.mockResolvedValue({
      id: "grant-3",
      status: "accepted",
      expiresAt: new Date(Date.now() - 1), // expired
    });
    const ctx = makeCtx("employer");

    try {
      await guard.canActivate(ctx);
      throw new Error("Expected guard to throw");
    } catch (err: unknown) {
      // Must throw 410, not 403
      expect((err as { status?: number }).status).toBe(410);
    }
  });

  it("throws ForbiddenException for 'recruiter' with a pending (not accepted) grant", async () => {
    mockPrisma.shareGrant.findFirst.mockResolvedValue({
      id: "grant-4",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const ctx = makeCtx("recruiter");
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
```

**Integration E2E test (full HTTP):**

```ts
// apps/api/src/consent/consent.e2e.test.ts
describe("ConsentGuard — E2E", () => {
  it("403 — employer without any share grant on a profile", async () => {
    const { profileId } = await seedScoredProfessional(app);
    const { accessToken: empToken } = await registerUser(app, { role: "employer" });

    const res = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${empToken}`);

    expect(res.status).toBe(403);
    expect(res.body.type).toContain("consent-required");
  });

  it("410 — employer with an expired accepted share", async () => {
    const prisma = app.get(PrismaService);
    const { profileId, userId: candidateId } = await seedScoredProfessional(app);
    const employer = await UserFactory.create(prisma, { role: "employer" });
    const empToken = await mintToken(app, employer);

    // Create an already-expired accepted share
    await ShareGrantFactory.create(prisma, {
      profileId,
      grantedByUserId: candidateId,
      grantedToEmail: employer.email,
      grantedToUserId: employer.id,
      status: "accepted",
      expiresAt: new Date(Date.now() - 1),
    });

    const res = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${empToken}`);

    expect(res.status).toBe(410);
    expect(res.body.type).toContain("share-expired");
  });

  it("200 — employer with a valid accepted share reads the report", async () => {
    const prisma = app.get(PrismaService);
    const { profileId, userId: candidateId, candidateToken } = await seedScoredProfessional(app);
    const employer = await UserFactory.create(prisma, { role: "employer" });
    const empToken = await mintToken(app, employer);

    // Candidate creates a share
    const shareRes = await api(app)
      .post("/api/v1/consent/shares")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({ profileId, grantedToEmail: employer.email, scope: "report-full", expiresInDays: 30 });
    expect(shareRes.status).toBe(201);

    // Employer accepts the share
    await api(app)
      .post(`/api/v1/consent/shares/${shareRes.body.id}/accept`)
      .set("Authorization", `Bearer ${empToken}`)
      .send({});

    const reportRes = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${empToken}`);

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.audience).toBe("employer");
  });
});
```

---

## 8. The Audience-Filtering Invariant

The audience-filtering invariant is the most legally consequential correctness property in the system (SCOPE §6.3, §12): **a response delivered to a candidate-audience caller must never contain `age` or `maritalStatus` line-items, and the `total` and `tier` must be identical across all audiences for the same score run**.

The invariant is tested at three layers:

### 8.1 Engine unit test (pure function — `packages/scoring`)

Covered already in `audience.test.ts` (§2.2). The critical assertions:

```ts
// packages/scoring/src/audience.test.ts
describe("filterForAudience — candidate view", () => {
  const result = computeScore(
    {
      mode: "professional",
      values: { age: 1, maritalStatus: 1, totalExperience: 1, communication: 1 },
    },
    stabilConfig,
  );

  it("removes employer-only line-items from candidate breakdown", () => {
    const view = filterForAudience(result, "candidate");
    const keys = view.breakdown.map((p) => p.key);
    expect(keys).not.toContain("age");
    expect(keys).not.toContain("maritalStatus");
  });

  it("preserves total and tier — suppression is presentation-only", () => {
    const candidateView = filterForAudience(result, "candidate");
    const employerView = filterForAudience(result, "employer");
    expect(candidateView.total).toBe(employerView.total);
    expect(candidateView.tier).toBe(employerView.tier);
  });

  it("hiddenParameterCount equals the number of employer-only params", () => {
    const view = filterForAudience(result, "candidate");
    const expectedHidden = stabilConfig.parameters.filter(
      (p) => p.visibility === "employer-only" && (p.appliesTo === "professional" || p.appliesTo === "both"),
    ).length;
    expect(view.hiddenParameterCount).toBe(expectedHidden);
  });

  it("employer view has hiddenParameterCount === 0", () => {
    const view = filterForAudience(result, "employer");
    expect(view.hiddenParameterCount).toBe(0);
  });
});
```

### 8.2 Service unit test

```ts
// apps/api/src/reports/reports.service.test.ts
describe("ReportsService.assembleReport — audience invariant", () => {
  it("candidate report never contains employer-only keys", async () => {
    const scoreRun = buildMockScoreRun("professional"); // includes age and maritalStatus
    const report = await service.assembleReport(scoreRun, "candidate", "prof-1");
    const keys = report.breakdown.map((p) => p.key);
    expect(keys).not.toContain("age");
    expect(keys).not.toContain("maritalStatus");
  });

  it("employer-only keys ARE present in employer report", async () => {
    const scoreRun = buildMockScoreRun("professional");
    const report = await service.assembleReport(scoreRun, "employer", "prof-1");
    const keys = report.breakdown.map((p) => p.key);
    expect(keys).toContain("age");
    expect(keys).toContain("maritalStatus");
  });

  it("total is identical across candidate and employer views", async () => {
    const scoreRun = buildMockScoreRun("professional");
    const candidateReport = await service.assembleReport(scoreRun, "candidate", "prof-1");
    const employerReport = await service.assembleReport(scoreRun, "employer", "prof-1");
    expect(candidateReport.total).toBe(employerReport.total);
    expect(candidateReport.tier).toBe(employerReport.tier);
  });
});
```

### 8.3 API E2E test — the definitive gate

```ts
// apps/api/src/reports/audience-invariant.e2e.test.ts
describe("Audience-filtering invariant — E2E (professional mode)", () => {
  let profileId: string;
  let candidateToken: string;
  let employerToken: string;

  beforeAll(async () => {
    const prisma = app.get(PrismaService);
    const seed = await seedScoredProfessional(app);
    profileId = seed.profileId;
    candidateToken = seed.candidateToken;

    // Create employer, accept a share
    const employer = await UserFactory.create(prisma, { role: "employer" });
    employerToken = await mintToken(app, employer);
    const shareRes = await api(app)
      .post("/api/v1/consent/shares")
      .set("Authorization", `Bearer ${candidateToken}`)
      .send({ profileId, grantedToEmail: employer.email, scope: "report-full", expiresInDays: 30 });
    await api(app)
      .post(`/api/v1/consent/shares/${shareRes.body.id}/accept`)
      .set("Authorization", `Bearer ${employerToken}`)
      .send({});
  });

  it("INVARIANT: candidate response MUST NOT contain age or maritalStatus", async () => {
    const res = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${candidateToken}`);

    expect(res.status).toBe(200);
    const keys = res.body.breakdown.map((p: { key: string }) => p.key);
    // Hard-fail if employer-only fields leak through
    expect(keys, "age leaked into candidate report").not.toContain("age");
    expect(keys, "maritalStatus leaked into candidate report").not.toContain("maritalStatus");
    expect(res.body.audience).toBe("candidate");
    expect(res.body.hiddenLineItemCount).toBeGreaterThan(0);
  });

  it("INVARIANT: employer response MUST contain age and maritalStatus", async () => {
    const res = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${employerToken}`);

    expect(res.status).toBe(200);
    const keys = res.body.breakdown.map((p: { key: string }) => p.key);
    expect(keys).toContain("age");
    expect(keys).toContain("maritalStatus");
    expect(res.body.audience).toBe("employer");
  });

  it("INVARIANT: total and tier are byte-for-byte identical across both views", async () => {
    const candidateRes = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${candidateToken}`);

    const employerRes = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${employerToken}`);

    expect(candidateRes.body.total).toBe(employerRes.body.total);
    expect(candidateRes.body.tier).toBe(employerRes.body.tier);
    expect(candidateRes.body.byBlock).toEqual(employerRes.body.byBlock);
    expect(candidateRes.body.scoreRunId).toBe(employerRes.body.scoreRunId);
  });

  it("INVARIANT: candidate improvement guidance never mentions employer-only parameters", async () => {
    const res = await api(app)
      .get(`/api/v1/profiles/${profileId}/report`)
      .set("Authorization", `Bearer ${candidateToken}`);

    const guidanceKeys = res.body.improvementGuidance.map(
      (h: { parameterKey: string }) => h.parameterKey,
    );
    expect(guidanceKeys).not.toContain("age");
    expect(guidanceKeys).not.toContain("maritalStatus");
  });
});
```

> **Why four assertions?** The legal risk (SCOPE §12) requires defense in depth: line-item absence, employer presence, total equality, and guidance safety are each independent failure modes. A refactor that passes three but breaks one is still a compliance violation.

---

## 9. CI Wiring (GitHub Actions)

All test tiers run in CI on every pull request and on every push to `main`.

### 9.1 Workflow file

```yaml
# .github/workflows/api-tests.yml
name: API Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: stabil_test
          POSTGRES_USER: stabil
          POSTGRES_PASSWORD: stabil
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgresql://stabil:stabil@localhost:5432/stabil_test
      REDIS_URL: redis://localhost:6379
      JWT_SECRET: ci-test-secret-not-for-prod
      NODE_ENV: test

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build shared packages
        run: pnpm --filter @stabil/scoring build && pnpm --filter @stabil/contracts build

      - name: Run Prisma migrations
        run: pnpm --filter api exec prisma migrate deploy
        env:
          DATABASE_URL: ${{ env.DATABASE_URL }}

      - name: Unit tests (packages/scoring + packages/core)
        run: pnpm vitest run --project scoring --project core

      - name: Unit tests (API services)
        run: pnpm --filter api vitest run --config vitest.unit.config.ts --coverage

      - name: Integration tests
        run: pnpm --filter api vitest run --config vitest.integration.config.ts --coverage
        # testcontainers starts its own container; the service above is for the
        # direct integration tests that do NOT use testcontainers.
        # Set TESTCONTAINERS_REUSE_ENABLE=true to share across suites if available.

      - name: E2E tests
        run: pnpm --filter api vitest run --config vitest.e2e.config.ts --coverage

      - name: Contract tests
        run: |
          # Start API in background, wait for /health, then run contract suite
          pnpm --filter api start:test &
          npx wait-on http://localhost:3000/api/v1/health --timeout 30000
          pnpm --filter api vitest run --config vitest.contract.config.ts

      - name: Upload coverage
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: apps/api/coverage/
          retention-days: 7

      - name: Check coverage thresholds
        run: pnpm --filter api vitest run --coverage --coverage.thresholds.lines=80
```

### 9.2 Seed and teardown strategy

| Tier | Isolation strategy |
|------|--------------------|
| Unit | No database. Each test is stateless. |
| Integration | `beforeEach: clearAllTables(prisma)` — full truncate within one container. |
| E2E | `beforeAll: await app.init()` + `clearAllTables` between test files via `globalSetup`. |
| Contract | Dedicated schema or database name (`stabil_contract_test`), seeded once per CI run. |

> **Never share data between tests.** Each test that needs a scored profile or a share grant creates its own via the factory layer. Using leftover data from a prior test is a flakiness source.

### 9.3 testcontainers in CI

When testcontainers is in use (integration tests), it starts a Docker container inside the CI job. Ensure the runner has Docker:

```yaml
      - name: Integration tests (testcontainers)
        run: pnpm --filter api vitest run --config vitest.integration.config.ts
        env:
          TESTCONTAINERS_RYUK_DISABLED: "true"   # ryuk not needed in ephemeral CI
          DOCKER_HOST: unix:///var/run/docker.sock
```

For speed, testcontainers uses `GenericContainer` image pull caching via `actions/cache` on the Docker layer cache key.

---

## 10. Coverage Targets

| Package / area | Lines | Branches | Functions |
|----------------|-------|----------|-----------|
| `packages/scoring` | **100%** | **100%** | **100%** |
| `packages/core` (rubric layer) | **90%** | **85%** | **90%** |
| `apps/api` (services + guards) | **80%** | **75%** | **80%** |
| `apps/api` (controllers / E2E) | 60% (covered by E2E) | — | — |

`packages/scoring` and `packages/core` are held to near-100% because they are the deterministic trust anchors of the product (SCOPE §10). API controller coverage is deliberately lower since the E2E suite covers the same paths; duplication at that level yields diminishing returns.

Coverage is enforced in CI via Vitest's `--coverage.thresholds`. Failures block merge.

```ts
// vitest.unit.config.ts (excerpt)
coverage: {
  provider: "v8",
  include: ["src/**/*.ts"],
  exclude: ["src/**/*.test.ts", "src/test/**", "src/generated/**"],
  thresholds: {
    lines: 80,
    branches: 75,
    functions: 80,
  },
},
```

---

## 11. Vitest Configuration Files

```
apps/api/
  vitest.unit.config.ts           # include: **/*.service.test.ts, **/*.guard.test.ts
  vitest.integration.config.ts    # include: **/*.integration.test.ts; singleFork: true
  vitest.e2e.config.ts            # include: **/*.e2e.test.ts; singleFork: true; timeout: 30s
  vitest.contract.config.ts       # include: **/contract.test.ts

packages/scoring/
  vitest.config.ts                # standalone; no testcontainers needed
```

Run all tiers from the monorepo root:

```sh
# Fast feedback (unit only, all packages)
pnpm vitest run --project scoring --project core --project api-unit

# Full suite (mirrors CI)
pnpm vitest run
```

---

## 12. Testing Checklist (per new feature)

When adding or changing a feature, the developer is responsible for:

- [ ] Unit tests for any new service method with mocked dependencies.
- [ ] Unit tests for any new rubric function in `packages/core` — output must be `∈ [0,1]` for all inputs.
- [ ] If a new parameter is added to `stabilConfig`: update `config.test.ts` to check the per-mode 1500-sum invariant still holds; mark `max` as PLACEHOLDER if calibration is pending.
- [ ] If a new parameter has `visibility === "employer-only"`: add it explicitly to the audience invariant test (§8.3) so the CI permanently guards against future leakage.
- [ ] Integration test for any new Prisma repository method that involves a join, an upsert, or a transaction.
- [ ] E2E test for any new endpoint: at least one happy path and one error path (wrong role, missing resource).
- [ ] ConsentGuard coverage: if a new endpoint accesses candidate data on behalf of an employer/recruiter, it must be protected by `ConsentGuard` and have a corresponding guard test.
- [ ] Golden-resume fixture: if the parsing pipeline is changed in Phase 2, re-run the eval suite and commit updated expected outputs if the change is intentional.

---

## 13. Quick Reference — Test Commands

```sh
# Run everything
pnpm vitest run

# Run only the scoring engine (fast, pure)
pnpm --filter @stabil/scoring vitest run

# Run unit tests for the API
pnpm --filter api vitest run --config vitest.unit.config.ts

# Run integration tests (needs Docker)
pnpm --filter api vitest run --config vitest.integration.config.ts

# Run E2E tests (needs Postgres + Redis via docker-compose or CI services)
pnpm --filter api vitest run --config vitest.e2e.config.ts

# Coverage report
pnpm --filter api vitest run --coverage --reporter=html

# Watch mode during development
pnpm --filter api vitest --config vitest.unit.config.ts
```
