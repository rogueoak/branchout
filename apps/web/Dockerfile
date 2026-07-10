# Build context is the repo root (see infra/docker-compose.yml). The whole workspace is copied
# in so pnpm can resolve shared packages; a single image per app keeps the setup simple.
FROM node:22-slim
# curl is used by the compose.site.yml HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo

COPY . .
RUN pnpm install --frozen-lockfile
# NEXT_PUBLIC_* are inlined into the browser bundle at BUILD time. In production the browser
# reaches the backend same-origin through Caddy: /api -> control-plane, /ws -> game-engine.
ARG NEXT_PUBLIC_CONTROL_PLANE_URL=/api
ARG NEXT_PUBLIC_ENGINE_WS_URL=wss://branchout.games/ws
# Seeds metadataBase so og:image URLs are absolute and crawler-reachable. Must be baked at build
# time (NEXT_PUBLIC_* are inlined into the bundle); a runtime env is ignored. Without this it
# falls back to http://localhost:3000 and every share/home unfurl points at an unreachable host.
ARG NEXT_PUBLIC_SITE_URL=https://branchout.games
ENV NEXT_PUBLIC_CONTROL_PLANE_URL=$NEXT_PUBLIC_CONTROL_PLANE_URL
ENV NEXT_PUBLIC_ENGINE_WS_URL=$NEXT_PUBLIC_ENGINE_WS_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
RUN pnpm --filter @branchout/web... build

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://localhost:3000/health -o /dev/null || exit 1
CMD ["pnpm", "--filter", "@branchout/web", "start"]
