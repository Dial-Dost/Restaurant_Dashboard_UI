# Stage 1 - Builder
FROM node:25-bookworm-slim AS builder
WORKDIR /app

# Install build tools and libvips for Sharp
RUN apt-get update && apt-get install -y \
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

# 1. Accept the build argument from Railway
ARG NEXT_PUBLIC_BACKEND_URL
ARG NEXT_PUBLIC_FEEDBACK_FORM_URL
# 2. Make it available as an environment variable for Next.js to bake into the JS
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL
ENV NEXT_PUBLIC_FEEDBACK_FORM_URL=$NEXT_PUBLIC_FEEDBACK_FORM_URL

# Because output: 'standalone' is in next.config.js, this build command 
# automatically creates a minimal server containing only required dependencies.
RUN npm run build

# Stage 2 - Runtime
FROM node:25-bookworm-slim AS runtime
WORKDIR /app

# Install runtime libvips for Sharp (libvips instead of libvips-dev)
RUN apt-get update && apt-get install -y libvips && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
# The standalone server respects the PORT environment variable (injected by Railway). 
# We set a default to 3000 just in case.
ENV PORT=3000
EXPOSE 3000

# 1. Copy the public folder (contains your static assets like images/favicon)
COPY --from=builder /app/public ./public

# 2. Copy the standalone directory (contains server.js and isolated node_modules)
# We copy the contents of standalone directly into /app
COPY --from=builder /app/.next/standalone ./

# 3. Copy the static Next.js frontend build files (crucial for CSS and client scripts)
# These are NOT included in the standalone folder by default, so we copy them manually.
COPY --from=builder /app/.next/static ./.next/static

# Start the optimized server directly with Node, bypassing npm completely!
CMD ["node", "server.js"]