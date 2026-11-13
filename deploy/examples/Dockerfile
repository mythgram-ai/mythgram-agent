# syntax=docker/dockerfile:1
#
# deploy/examples/Dockerfile — correct multi-stage build for the current
# monorepo (packages/mythgram + packages/frontend-main).
#
# The old root Dockerfile/Dockerfile.base are stale; this one builds the backend,
# bundles the console into the backend's dist/web, and runs ONE process that
# serves both on port 8787.
#
# Build (from the repo root):
#   docker build -f deploy/examples/Dockerfile -t mythgram:local .
# Run (localhost only):
#   docker run --rm -p 127.0.0.1:8787:8787 -v mythgram-data:/workspace mythgram:local

# --- Build stage: install deps and compile backend + frontend ---------------
FROM node:22-bookworm-slim AS build

# Toolchain for better-sqlite3 when no prebuilt binary matches this platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Root package (for any shared config), then per-package dependency manifests.
COPY package.json package-lock.json ./
COPY packages/mythgram/package.json packages/mythgram/package-lock.json ./packages/mythgram/
COPY packages/frontend-main/package.json packages/frontend-main/package-lock.json packages/frontend-main/.npmrc ./packages/frontend-main/

RUN npm --prefix packages/mythgram ci --no-audit --no-fund \
 && npm --prefix packages/frontend-main ci --no-audit --no-fund

# Sources, then build: backend → packages/mythgram/dist,
# frontend → packages/mythgram/dist/web (see frontend-main/vite.config.ts).
COPY packages ./packages
RUN npm --prefix packages/mythgram run build \
 && npm --prefix packages/frontend-main run build

# --- Runtime stage: minimal image with the compiled app ---------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8787 \
    WORKSPACE_ROOT=/workspace \
    MYTHGRAM_DATA_DIR=/workspace/.mythgram

WORKDIR /app

COPY --from=build /app/packages/mythgram/package.json ./packages/mythgram/package.json
COPY --from=build /app/packages/mythgram/node_modules ./packages/mythgram/node_modules
COPY --from=build /app/packages/mythgram/dist ./packages/mythgram/dist

# Writable workspace: mounts persist the agent's files and the SQLite database.
RUN mkdir -p /workspace && chown -R node:node /app /workspace

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/mythgram/dist/index.js"]
