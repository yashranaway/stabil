# Stabil

A stability-check platform: it scores how *stable* a person is (role-agnostic, `0–1500`)
from resume + form inputs + optional verified documents, and renders an explainable report
for employers, recruiters, and the candidates themselves.

See **[docs/SCOPE.md](docs/SCOPE.md)** for the full scope, scoring model, phases, and stack rationale.

## Monorepo layout

```
.
├── apps/            # applications (web, mobile, api) — added per phase
├── packages/
│   └── scoring/     # deterministic, fixed-weight scoring engine (@stabil/scoring)
├── docs/            # SCOPE.md + source POC image
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json
```

## Stack

TypeScript-first monorepo (Turborepo + pnpm): Next.js (web) · Expo/React Native (mobile) ·
NestJS (API) · PostgreSQL + Prisma · self-hosted Ollama + Tesseract OCR for parsing ·
MinIO (S3-compatible) storage. See `docs/SCOPE.md` §10.

## Develop

```bash
pnpm install        # install all workspace deps
pnpm test           # run tests across packages (Turborepo)
pnpm typecheck      # type-check all packages
pnpm build          # build all packages
```

Per-package, e.g. the scoring engine:

```bash
pnpm --filter @stabil/scoring test
pnpm --filter @stabil/scoring test:watch
```
