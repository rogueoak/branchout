# Build context is the repo root (see infra/docker-compose.yml). The whole workspace is copied in so
# pnpm can resolve shared packages. The admin console (spec 0037) is a plain Next.js SSR service - no
# OG-card rasterizing, so (unlike web) it needs no fonts, just curl for the healthcheck.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# The admin browser reaches control-plane SAME-ORIGIN via /api (Caddy fronts /api on admin.branchout.
# games -> control-plane, spec 0038's `api` snippet), so no NEXT_PUBLIC_* URL is baked. The server-side
# CONTROL_PLANE_URL is a RUNTIME env (compose .env.prod), used by getAdmin/adminFetch.
RUN pnpm --filter @branchout/admin... build

EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://localhost:3002/health -o /dev/null || exit 1
CMD ["pnpm", "--filter", "@branchout/admin", "start"]
