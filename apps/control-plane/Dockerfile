# Build context is the repo root (see infra/docker-compose.yml). The whole workspace is copied
# in so pnpm can resolve shared packages; a single image per app keeps the setup simple.
FROM node:22-slim
# curl is used by the compose.site.yml HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @branchout/control-plane... build

EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://localhost:4000/health -o /dev/null || exit 1
CMD ["pnpm", "--filter", "@branchout/control-plane", "start"]
