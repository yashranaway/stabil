# Stabil

A stability-check platform: it scores how *stable* a person is (role-agnostic, `0–1500`)
from form inputs + resume parsing + verified documents, and renders an explainable report
for employers, recruiters, and the candidates themselves.

Full scope and design live in **[docs/](docs/README.md)** (start with [docs/SCOPE.md](docs/SCOPE.md)).

## Monorepo layout

```
apps/
  api/              # NestJS API (auth, profiles, scoring, consent, reports, parsing, verification, account)
  web/              # Next.js 15 app (anonymous scorer + authed flow + employer views)
packages/
  scoring/          # @stabil/scoring — deterministic, fixed-weight engine (unit-tested)
  core/             # @stabil/core — rubric layer: raw answers → [0,1] fractions
  types/            # @stabil/types — shared Zod schemas + TS types (the contract)
docs/               # SCOPE, architecture, phases, frontend, backend, CLOUD, AGENTS
docker-compose.yml  # Postgres + Redis + MinIO + api + web
```

## Run it (Docker)

```bash
cp .env.example .env           # optional; sensible local defaults are baked in
docker compose up -d --build
# web  → http://localhost:3300
# api  → http://localhost:3301/health
# MinIO console → http://localhost:59001   (postgres :55432, redis :56379)
```

Stabil uses a dedicated `5xxxx` host-port range so it never collides with other local stacks.

## Develop (host)

```bash
pnpm install
docker compose up -d postgres redis minio          # infra only
pnpm --filter @stabil/api exec prisma migrate dev   # apply migrations
pnpm --filter @stabil/api start:dev                 # API on :3001
pnpm --filter @stabil/web dev                       # web on :3000
```

## Quality gates

```bash
pnpm turbo run build typecheck test    # what CI runs (.github/workflows/ci.yml)
```

- Scoring engine + rubric: unit-tested (Vitest). API: 44 unit tests + a global RFC 9457
  error filter and rate limiting. Full auth → score → report → consent flow is e2e-verified.

## What works today

- **Anonymous scoring** — `/`: pick mode → form → 0–1500 score + tier + Chart.js gauge report.
- **Accounts** — register/login (JWT + argon2, refresh rotation), profiles (incl. employer-submitted
  claimable profiles), score history (re-scoring).
- **Audience-aware reports** — candidates never see `age`/`maritalStatus`; employers/recruiters do —
  enforced server-side, gated by **explicit per-share consent**.
- **Resume parsing** (`/parse`) — provider-agnostic LLM adapter (OpenRouter; deterministic stub
  without a key) extracts signals → form suggestions.
- **Document verification** — submit docs → admin approves → the verification bonus lifts the score.
- **Employer comparison** (`/compare`) — ranks consented candidates side by side.
- **Data rights** — export + delete-on-request (soft-delete + token revocation).

See [docs/phases/README.md](docs/phases/README.md) for the phase roadmap and what's still planned
(MinIO file upload UI, notifications, PDF export, richer Phase 4, mobile app).
