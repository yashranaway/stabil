# Deploying Stabil free — Vercel + Neon + Cloudflare R2

> **Status:** Runbook v1 · **Phase:** cross-cutting · **Owner area:** infra
> **Related:** [CLOUD.md](CLOUD.md), [.env.example](../.env.example)

The whole stack on free tiers, using Vercel's container-function support
(June 2026: any `Dockerfile.vercel` runs as a Function on Fluid compute).

| Piece | Service | Free tier notes |
|---|---|---|
| Web (Next.js) | Vercel — native build | Hobby plan |
| API (NestJS) | Vercel — container function (`Dockerfile.vercel` at repo root) | scales to zero after 5 min idle → brief cold start |
| Postgres | Neon | free tier, does not expire |
| Object storage | Cloudflare R2 | 10 GB free, S3-compatible — works with our existing storage client |
| Redis | — skipped | nothing consumes it at runtime yet |
| Email | — skipped (dev JSON transport) | set `SMTP_URL` later if wanted |

## 0. One-time accounts
1. **Neon** (neon.tech): create a project → copy the **pooled connection string**.
2. **Cloudflare R2**: create bucket names are auto-created by the API on boot, so just
   create an **R2 API token** (Object Read & Write) → note `Account ID`, `Access Key ID`,
   `Secret Access Key`. Endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. **Vercel**: sign in with the GitHub account that owns `yashranaway/stabil`.

## 1. API project (container function)
Vercel → **Add New → Project** → import `yashranaway/stabil`:
- **Root Directory:** repository root (leave as `.`) — Vercel auto-detects `Dockerfile.vercel`.
- **Environment variables:**

| Key | Value |
|---|---|
| `PORT` | `3001` (Vercel routes traffic to this port) |
| `DATABASE_URL` | Neon pooled connection string |
| `JWT_ACCESS_SECRET` | long random string |
| `JWT_REFRESH_SECRET` | long random string (different) |
| `MINIO_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `MINIO_PUBLIC_ENDPOINT` | same as `MINIO_ENDPOINT` |
| `MINIO_ROOT_USER` | R2 Access Key ID |
| `MINIO_ROOT_PASSWORD` | R2 Secret Access Key |
| `MINIO_REGION` | `auto` |
| `MINIO_BUCKET_DOCUMENTS` | `stabil-documents` |
| `MINIO_BUCKET_REPORTS` | `stabil-reports` |
| `OPENROUTER_API_KEY` | *(optional — resume parsing falls back to the stub without it)* |

Deploy → note the URL, e.g. `https://stabil-api.vercel.app`.
Check `https://stabil-api.vercel.app/health` → `{"status":"ok","db":"up"}`.

## 2. Web project (native Next.js)
**Add New → Project** → import the same repo again:
- **Root Directory:** `apps/web` (Vercel detects Next.js + Turborepo and builds the
  workspace libs first; if the build can't find `@stabil/*` dist, override Build
  Command with `cd ../.. && pnpm turbo run build --filter=@stabil/web`).
- **Environment variables:**

| Key | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | the API URL from step 1 |
| `API_URL` | same |

Deploy → the site is live at `https://<project>.vercel.app`.

## 3. Afterwards
- Every push to `main` redeploys both projects automatically.
- Custom domains: add in each Vercel project (web → apex, api → `api.` subdomain),
  then update `NEXT_PUBLIC_API_URL`/`API_URL`.
- Migrations run automatically on API container boot (`prisma migrate deploy`).

## Gotchas
- **Cold starts:** the API container scales to zero after 5 min idle on Hobby; the
  first request after idle pays a short spin-up.
- **Do not** put age-restricted secrets in `NEXT_PUBLIC_*` — only the API URL.
- R2 presigned URLs (uploads/downloads) come from `MINIO_PUBLIC_ENDPOINT`, so keep it
  the public R2 endpoint, not an internal alias.
