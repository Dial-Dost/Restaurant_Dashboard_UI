# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1 - Builder
# Pinned to Node 20 LTS (matches the backend runtime / project stack).
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install build tools and libvips for Sharp (image optimization)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    make \
    g++ \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

# --legacy-peer-deps is required to bypass the React 19 version conflict
RUN npm install --legacy-peer-deps

COPY . .

# 1. Accept the build arguments from Railway
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_FEEDBACK_FORM_URL
# 2. Make them available as env vars for Next.js to bake into the client JS
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_FEEDBACK_FORM_URL=$NEXT_PUBLIC_FEEDBACK_FORM_URL

# Because output: 'standalone' is set in next.config.ts, this build emits a
# minimal self-contained server (.next/standalone) with only required deps.
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 - Runtime (minimal, non-root)
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
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
