# Production image for Mythgram: a TypeScript/Express backend (packages/mythgram/) and a
# React/Vite frontend (packages/frontend-main/) served from a single container.
#
# The backend owns the API on :8787 and the SQLite workspace state. The frontend
# is built to static assets and served by Vite's preview server on :4173, which
# proxies same-origin /api/* requests to the backend (see packages/frontend-main/vite.config.ts).
#
# Build the base image first (see Dockerfile.base), then:
#   docker build -t mythgram .
#
# BASE_IMAGE defaults to the local base tag; point it at your registry image if
# you publish the base image instead.

ARG BASE_IMAGE=mythgram-base:latest

# --- Frontend build: produce the static production bundle -------------------
FROM ${BASE_IMAGE} AS frontend-builder
WORKDIR /app/frontend-main
COPY packages/frontend-main/package.json packages/frontend-main/package-lock.json packages/frontend-main/.npmrc ./
COPY packages/frontend-main/index.html packages/frontend-main/vite.config.ts ./
COPY packages/frontend-main/tsconfig.json packages/frontend-main/tsconfig.app.json packages/frontend-main/tsconfig.node.json ./
COPY packages/frontend-main/src ./src
RUN npm run build

# --- Backend build: type-check the TypeScript sources -----------------------
FROM ${BASE_IMAGE} AS backend-builder
WORKDIR /app/mythgram
COPY packages/mythgram/package.json packages/mythgram/tsconfig.json ./
COPY packages/mythgram/src ./src
RUN npm run build

# --- Runtime ----------------------------------------------------------------
FROM ${BASE_IMAGE} AS runner

# Backend source (node_modules come from the base image).
COPY packages/mythgram/package.json packages/mythgram/tsconfig.json ./mythgram/
COPY packages/mythgram/src ./mythgram/src

# Vite config used by the preview server, plus the built frontend assets.
COPY packages/frontend-main/package.json packages/frontend-main/vite.config.ts ./frontend-main/
COPY --from=frontend-builder /app/frontend-main/dist ./frontend-main/dist

# Writable workspace for the agent's file tools and the SQLite database.
RUN mkdir -p /app/workspace && chown -R node:node /app

USER node
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    WORKSPACE_ROOT=/app/workspace \
    MYTHGRAM_API_URL=http://localhost:8787 \
    VITE_PORT=4173

# 4173 = web console (frontend), 8787 = backend API.
EXPOSE 4173 8787

# Run the backend and the frontend preview server together, forwarding stop
# signals to both processes.
CMD ["sh", "-c", "trap 'kill 0' TERM INT; npm --prefix /app/mythgram start & npm --prefix /app/frontend-main run preview -- --host 0.0.0.0 --port 4173 & wait"]
