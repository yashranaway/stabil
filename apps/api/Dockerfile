# syntax=docker/dockerfile:1
# Build context is the repo root (see docker-compose.yml).

FROM node:20-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @stabil/api exec prisma generate
# Turbo builds the workspace libs (scoring/types/core) before the API.
RUN pnpm turbo run build --filter=@stabil/api

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
EXPOSE 3001
# Apply pending migrations, then start the server. Invoke the prisma bin
# directly — `pnpm exec` would trigger a Corepack pnpm download at runtime.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
