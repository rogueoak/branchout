# Build context is the repo root (see infra/docker-compose.yml). The whole workspace is copied
# in so pnpm can resolve shared packages; a single image per app keeps the setup simple.
FROM node:22-slim
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @branchout/control-plane... build

EXPOSE 4000
CMD ["pnpm", "--filter", "@branchout/control-plane", "start"]
