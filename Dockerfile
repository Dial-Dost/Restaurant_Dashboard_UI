# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 - Builder
# Pinned to Node 22 LTS, and it must stay identical to the node-version in
# .github/workflows/dashboard-ci.yml. CI used to test on 25 while this image
# built on 20, so "tests passed" said nothing about the artifact that shipped:
# different V8, different npm major, different platform-specific optional
# binaries (sharp). Restaurant_Backend/Dockerfile.node already builds and runs
# on 22, so 22 is the one version the whole stack shares. 20 is an expired LTS
# line and 25 is a non-LTS line; neither is a place to land.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install build tools and libvips for Sharp (image optimization)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    make \
    g++ \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

# No trailing "*" on package-lock.json, deliberately. With the glob, a lock that
# is missing from the build context matches zero files and COPY still SUCCEEDS
# (package.json matched), silently falling back to an unpinned install. That is
# exactly what used to happen: .dockerignore excluded package-lock.json, so the
# image re-resolved every "^" range from the registry at build time and the
# tested tree and the shipped tree were never the same. Without the glob a
# missing lock is a hard build failure, which is the correct outcome.
COPY package.json package-lock.json ./

# npm ci, not npm install: install rewrites the lock to whatever the registry
# offers today, ci installs the locked tree exactly and refuses to run at all if
# package-lock.json and package.json have drifted.
#
# --legacy-peer-deps is genuinely required and must stay. Verified 2026-08-22 by
# running npm ci against only package.json + package-lock.json in an isolated
# directory: without the flag npm exits 1 with ERESOLVE, because next-themes@0.3.0
# declares peer react@"^16.8 || ^17 || ^18" and this project is on react@19.2.5
# (react-day-picker@8.10.1 is a second offender). With the flag: 912 packages,
# exit 0. Dropping the flag does not "clean up" anything, it breaks the build.
RUN npm ci --legacy-peer-deps

COPY . .

# 1. Accept the build arguments from Railway
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_FEEDBACK_FORM_URL
# 2. Make them available as env vars for Next.js to bake into the client JS
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_FEEDBACK_FORM_URL=$NEXT_PUBLIC_FEEDBACK_FORM_URL

# 3. BACKEND_INTERNAL_URL is ALSO a build-time value, despite not being
#    NEXT_PUBLIC_*. next.config.ts uses it as the destination of the
#    /backend-api/:path* rewrite, and `output: 'standalone'` serialises that
#    rewrite into the build manifest — runtime env does NOT reach it. Without
#    this ARG, a build from this Dockerfile bakes localhost:3001 and every guest
#    page (/order, /queue, /reserve, /cfd, /feedback) breaks in production,
#    because a guest's phone cannot resolve the server's localhost.
#
#    The default is deliberate and must stay. `ENV X=$ARG` with an unset,
#    default-less ARG produces an EMPTY STRING, and next.config.ts reads it with
#    `?? 'http://localhost:3001'` — which does not fire on "" — so the rewrite
#    destination would collapse to "/:path*" and proxy to itself. Repeating the
#    same default here keeps a plain `docker build` behaving exactly as before.
#    In production CI passes the compose service name (http://backend:3001).
ARG BACKEND_INTERNAL_URL=http://localhost:3001
ENV BACKEND_INTERNAL_URL=$BACKEND_INTERNAL_URL

# Because output: 'standalone' is set in next.config.ts, this build emits a
# minimal self-contained server (.next/standalone) with only required deps.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 - Runtime (minimal, non-root)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# Runtime libvips for Sharp (libvips, not libvips-dev). wget is used by HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips \
    wget \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# The standalone server respects PORT (injected by Railway). Default to 3000.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000

# 1. Public assets (images/favicon)
COPY --from=builder /app/public ./public

# 2. Standalone server (server.js + isolated node_modules)
COPY --from=builder /app/.next/standalone ./

# 3. Static Next.js build output (CSS + client chunks) - not in standalone by default
COPY --from=builder /app/.next/static ./.next/static

# Run as the unprivileged "node" user shipped in the official image.
# Ensure the app tree is owned by it so any runtime writes succeed.
RUN chown -R node:node /app
USER node

# Liveness probe: the Next.js standalone server answers on / once ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT}/" || exit 1

# Start the optimized standalone server directly with Node.
CMD ["node", "server.js"]
