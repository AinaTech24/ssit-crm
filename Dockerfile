# syntax=docker/dockerfile:1
#
# One image, two roles:
#   - web    → `npm run start`        (next start, port 3000, GET /api/health)
#   - worker → `npm run worker:prod`  (tsx src/workers/index.ts)
#   - tasks  → `npm run migrate:all` / `npm run seed` / backfills (one-off ECS tasks)
#
# Build once, run with different CMD/entrypoint per ECS service. tsx is a runtime
# dependency so the worker + migration scripts run straight from source — no
# separate compile step.

# ---- deps: install node_modules (cached on package-lock) ----------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the Next.js app ------------------------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time — must be passed
# as build args (public URLs only; never secrets).
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_S3_PUBLIC_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_S3_PUBLIC_URL=$NEXT_PUBLIC_S3_PUBLIC_URL
# Build-time placeholders so module-load guards (db/client, redis, auth) don't
# throw while `next build` collects page data. NO database/redis is contacted —
# every data route is force-dynamic — and the REAL values are injected only at
# runtime via env_file. These never reach the runtime stage (separate FROM).
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    REDIS_URL=redis://127.0.0.1:6379 \
    NEXTAUTH_SECRET=build-time-placeholder-not-used-at-runtime
# Bound V8's old-space heap for the build. Inside the container Node can't read
# the host's real memory, so it picks a default ceiling too low for a cold
# `next build` and OOMs ("Ineffective mark-compacts near heap limit"). Scoped to
# the build stage only — the runtime stage is a separate FROM.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build

# ---- runtime: lean image that runs either role -------------------------------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# curl for the container healthcheck; run as non-root.
# fontconfig + DejaVu/Liberation fonts so server-side SVG→PNG branding
# (sharp/librsvg, used by the content-library co-brand strip) actually renders
# text — without a font installed every glyph falls back to tofu (□) boxes.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl fontconfig fonts-dejavu-core fonts-liberation \
      fonts-noto-core fonts-noto-ui-core \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f \
    && groupadd -r app && useradd -r -g app -m app
COPY --from=build --chown=app:app /app ./
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1
# Default command = web. The worker ECS service overrides this with:
#   command: ["npm","run","worker:prod"]
CMD ["npm", "run", "start"]
