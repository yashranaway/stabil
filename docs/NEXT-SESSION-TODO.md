# Next Session — Remaining Work

> **Status:** Snapshot as of 2026-07-03 · **Owner area:** cross-cutting
> **Related:** [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md), [SCOPE.md](SCOPE.md), [architecture/05-security-privacy.md](architecture/05-security-privacy.md)

Live product: **web** https://stabil-web.vercel.app · **API** https://stabil-api.vercel.app
(Vercel + Neon Postgres, verified end-to-end in production.)

This is a punch list to pick back up from — not a spec. Ordered by urgency.

---

## 🔴 Production gaps (actually broken right now)

1. **Document upload/storage fails in prod**
   `StorageService` falls back to `localhost:9000` when `MINIO_*` env vars are
   unset — there's no MinIO next to the API on Vercel, so submitting a
   verification document will error.
   **Fix:** create a Cloudflare R2 API token (Account ID + Access Key +
   Secret), set on `stabil-api` in Vercel: `MINIO_ENDPOINT`,
   `MINIO_PUBLIC_ENDPOINT` (both `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`),
   `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_REGION=auto`. See
   [DEPLOY-VERCEL.md](DEPLOY-VERCEL.md) step 1 for the exact table.

2. **Auto-deploy on git push isn't connected**
   `vercel git connect` failed via CLI (needs the Vercel GitHub App
   installed, which requires a browser click from the account owner).
   **Fix:** in the Vercel dashboard, open `stabil-api` (and `stabil-web`) →
   Settings → Git → Connect Repository → authorize the GitHub App install.
   Until then, deploys are manual (`vercel deploy --prod --yes` from repo
   root for the API, or with `VERCEL_PROJECT_ID` set to the web project).

3. **Redis is provisioned but unused**
   Local Docker Compose runs Redis; nothing in the code reads/writes it, and
   it isn't provisioned in prod at all. Rate limiting (`@nestjs/throttler`)
   is in-memory per serverless instance — a soft guarantee only, given
   Vercel's scale-to-zero model.
   **Fix (when queueing work lands, see below):** provision a free Upstash
   Redis (works over HTTP, Vercel-friendly) or drop the Redis service
   entirely if nothing ends up needing it.

---

## 🟡 Explicitly parked

- **Google Sign-In** — fully built and feature-flagged off. Backend
  (`POST /api/v1/auth/google`) and frontend (`GoogleSignInButton`, hidden
  without a client ID) are done and tested; parked because setting up the
  OAuth consent screen (Internal/External audience, scopes) is its own task.
  **To resume:** Google Cloud Console → OAuth consent screen → choose
  audience → Create OAuth Client ID (Web application) → add JS origins
  `http://localhost:3300` and `https://stabil-web.vercel.app` → set
  `GOOGLE_CLIENT_ID` (API) + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web) in Vercel.

---

## 🟠 Deferred — bigger scope

| Item | Notes |
|---|---|
| Mobile app (Expo) | 0% — not started |
| Weight / tier calibration | All scoring weights are placeholders (SCOPE §13); needs real data or an expert workshop |
| Legal / compliance review | Age & marital-status scoring, DPDP/PII, sending resume text to OpenRouter (third party) — not reviewed |
| OCR (Tesseract) | Resume parsing only accepts pasted text, no file/image upload |
| Async queue (BullMQ) | Parsing / verification / scoring all run synchronously today |
| Real KYC integration | Admin manual review only — no DigiLocker / passport API |
| AI comms assessment + skill tests | Phase 4 leftovers, not built |
| Server-side PDF artifact | Reverted — `@react-pdf/renderer` pins React 18 vs. the web's React 19, causing duplicate `@types/react`. Browser print-to-PDF works as the fallback. Needs dependency isolation (e.g. a separate build target) to revisit |
| Real OpenRouter run | Adapter works; only the deterministic stub has actually been exercised — needs a real `OPENROUTER_API_KEY` + an accuracy pass |
| Full e2e test suite in CI | Only API unit tests run in CI; no Playwright/web tests wired in |
| Observability | No structured logging, error tracking (e.g. Sentry), or metrics in prod |
| Custom domain | Still on `*.vercel.app` subdomains |

---

## ✅ Done and verified

- Scoring engine (`@stabil/scoring`) + rubric layer (`@stabil/core`) — TDD, unit-tested
- Backend: auth (JWT + argon2), profiles (incl. employer-submitted claimable
  profiles), consent/sharing, audience-aware reports, scoring, document
  verification (score bonus wired in), in-app + email notifications, account
  data rights (export/delete)
- Web: full marketing site (landing, pricing, about, security, footer) +
  authed app (dashboard, profile/report, résumé analyzer with prefill,
  employer compare/shared views, admin review queue, account, notifications)
- Precision-minimal "Swiss ledger" design system across every page; nav CTA
  buttons fixed (were a CSS specificity bug)
- Deployed live: Vercel (web native + API as a `Dockerfile.vercel` container
  function) + Neon Postgres — verified with real register/score/report calls
  against production
- CI (GitHub Actions) running build/typecheck/test on push

---

## Suggested order for tomorrow

1. Wire Cloudflare R2 (5 min, unblocks a genuinely broken feature)
2. Connect the Vercel GitHub App for auto-deploy
3. Pick one deferred item to start — recommend either **weight calibration**
   (makes the whole product meaningful) or **OCR + real OpenRouter key**
   (completes the parsing story end-to-end)
