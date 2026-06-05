# AGENTS.md

Entry point for humans and AI agents working on **Stabil**.

- **Start here:** [`docs/SCOPE.md`](docs/SCOPE.md) — the authoritative project scope.
- **Docs hub & conventions:** [`docs/README.md`](docs/README.md).
- **Architecture & contributor guide:** [`docs/AGENTS.md`](docs/AGENTS.md).
- **Cloud / infra / deploy:** [`docs/CLOUD.md`](docs/CLOUD.md).

## Ground rules
- Monorepo: **pnpm + Turborepo**, TypeScript everywhere. Install with `pnpm install`.
- Tests: `pnpm test` (Vitest/Playwright). Typecheck: `pnpm typecheck`. Build: `pnpm build`.
- The scoring engine (`packages/scoring`) is **deterministic and unit-tested** — change it
  only via TDD (write the failing test first).
- Do **not** add `Co-Authored-By: Claude` (or any Claude attribution) to commits.
- Follow the authoring contract in `docs/README.md` when writing docs.
