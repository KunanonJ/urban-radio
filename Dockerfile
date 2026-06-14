# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for the Railway deployment of Sonic Bloom (Wave RM-δ).
#
# Stages:
#   1. deps      — `npm ci` against package-lock; produces the full node_modules.
#   2. builder   — runs `npm run build`; emits `.next/standalone/` etc.
#   3. runner    — minimal Node 22 image carrying only the standalone bundle,
#                  the `public/` tree, and `.next/static/`. No npm, no dev deps.
#
# The middleware is pinned to `runtime: 'nodejs'` (see src/middleware.ts) — jose's
# `CompressionStream` import isn't supported by Next's Edge Runtime. The
# `standalone` output respects that pin.
#
# Build locally with:
#   docker build -t sonic-bloom .
#   docker run -p 3000:3000 \
#     -e DATABASE_URL=postgresql://... \
#     -e AUTH_JWT_SECRET=... \
#     -e STORAGE_ENDPOINT_URL=... \
#     -e STORAGE_BUCKET=... \
#     -e STORAGE_ACCESS_KEY_ID=... \
#     -e STORAGE_SECRET_ACCESS_KEY=... \
#     sonic-bloom
#
# See docs/RAILWAY-CUTOVER-PLAYBOOK.md for the production env contract.

# ---------- 1. deps ----------
FROM node:22-alpine AS deps
WORKDIR /app

# Build deps for native modules (better-sqlite3 etc. used in test/dev — they
# get pruned at runner stage, but the `deps` stage needs to resolve them).
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./
# Use `npm install` rather than `npm ci`. Railway's build environment is
# slightly stricter about lock-file/manifest agreement than local npm — a
# transitive resolved one version ahead trips `npm ci` (e.g. esbuild@0.25.x
# locally vs 0.27.x in Railway's resolution). `npm install` honours the
# lock when consistent and re-resolves otherwise, which is the right
# behaviour for our deploy pipeline.
RUN npm install --no-audit --no-fund

# ---------- 2. builder ----------
FROM node:22-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ---------- 3. runner ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user — Next standalone supports running as nextjs:nodejs out of box.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `next.config.ts` sets `output: 'standalone'` — `.next/standalone/` contains
# `server.js` + the minimum required `node_modules` (only production deps).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# `server.js` is the entrypoint emitted by `next build` for standalone output.
# It reads HOSTNAME/PORT from env and serves the App Router.
CMD ["node", "server.js"]
