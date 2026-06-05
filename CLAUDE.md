# CLAUDE.md

Project guidance for Claude Code (and any contributor) working in this repo.
Read alongside [`AGENTS.md`](AGENTS.md) and the docs hub at [`docs/README.md`](docs/README.md).

## What this is

**Stabil** — a stability-check platform. It scores how *stable* a person is (role-agnostic,
`0–1500`) from form inputs + resume/document parsing + verified documents, and renders an
explainable report for **employers, recruiters, and candidates**. Authoritative scope:
[`docs/SCOPE.md`](docs/SCOPE.md).

## Repo layout

```
apps/        web (Next.js) · mobile (Expo) · api (NestJS)   ← added per phase
packages/
  scoring/   @stabil/scoring — deterministic, unit-tested engine (BUILT)
  core/      rubric layer: raw answers → [0,1] fractions     (planned)
  types/     shared Zod schemas + TS types                    (planned)
docs/        SCOPE.md, README.md (docs hub), AGENTS.md, CLOUD.md, architecture/, phases/, frontend/, backend/
```

## Commands

```bash
pnpm install            # install workspace deps
pnpm test               # all packages (Turborepo)
pnpm typecheck          # type-check all
pnpm build              # build all
pnpm --filter @stabil/scoring test         # one package
pnpm --filter @stabil/scoring test:watch
```

## Rules that matter here

- **Commits: never add a `Co-Authored-By: Claude` trailer** (or any Claude attribution). User preference.
- **Scoring engine is deterministic** — change `packages/scoring` only via **TDD** (write the
  failing test first, watch it fail, then implement). See [`docs/architecture/03-scoring-engine.md`](docs/architecture/03-scoring-engine.md).
- **Engine boundary:** `@stabil/scoring` consumes normalized **fractions `[0,1]` per parameter**.
  Mapping raw answers (GPA, years, etc.) → fractions is the **rubric layer** (`packages/core`),
  not the engine. Keep that seam crisp.
- **Sensitive attributes** (age, marital status) are **scored but employer-only** — never
  serialize them to the candidate audience. Filter on read via `filterForAudience`.
- **Conventions:** TypeScript strict, Zod for validation, UUID v7 PKs, integer points,
  RFC 9457 problem+json errors, API base `/api/v1`.
- **Writing docs?** Follow the authoring contract + templates in [`docs/README.md`](docs/README.md).

## Where new code goes

| Change | Where |
|--------|-------|
| New UI page/flow | a `docs/frontend/pages/*` doc → `apps/web` (and `apps/mobile`) |
| New API capability | a `docs/backend/modules/*` doc → `apps/api` module |
| Scoring math change | `packages/scoring` via TDD + update `docs/architecture/03-scoring-engine.md` |
| Raw-answer → fraction logic | `packages/core` (rubric layer) |
| Data model change | `docs/architecture/02-data-model.md` + Prisma migration |

## Canonical facts

The single source of truth is the canonical-facts table in [`docs/README.md`](docs/README.md).
Don't restate or contradict it elsewhere — link to it.
