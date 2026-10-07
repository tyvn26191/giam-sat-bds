# Property Watch worker — Cloud Run image. Build context: repository root.
#   docker build -f apps/worker/Dockerfile -t gsb-worker .
# Default runtime = official Playwright image (Chromium for the JS fallback tier).
# Slim variant without a browser (set ENABLE_BROWSER=false):
#   docker build -f apps/worker/Dockerfile --build-arg RUNTIME_IMAGE=node:22-bookworm-slim --build-arg RUNTIME_USER=node -t gsb-worker .
ARG RUNTIME_IMAGE=mcr.microsoft.com/playwright:v1.56.1-noble
ARG RUNTIME_USER=pwuser

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/parser/package.json packages/parser/
COPY packages/notifications/package.json packages/notifications/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @gsb/worker --ignore-scripts --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN npm run build -w @gsb/worker

FROM ${RUNTIME_IMAGE} AS runtime
ARG RUNTIME_USER
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/parser/package.json packages/parser/
COPY packages/notifications/package.json packages/notifications/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @gsb/worker --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/apps/worker/dist apps/worker/dist
USER ${RUNTIME_USER}
EXPOSE 8080
CMD ["node", "--enable-source-maps", "apps/worker/dist/index.js"]
