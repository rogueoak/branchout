<p align="center">
  <img src="assets/branchout-logo.svg" width="320" alt="Branch out" />
</p>

<p align="center"><strong>where game night grows.</strong></p>

<p align="center">
  <a href="https://github.com/rogueoak/branchout/actions/workflows/ci.yml">
    <img src="https://github.com/rogueoak/branchout/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
</p>

## What this is

Branch out is a subscription platform for online shared games - mostly party games you play
together, with a few solo ones. Get friends into a game in seconds, keep it fair and social,
and let people play free without being cornered into paying.

This repo is the monorepo for the whole platform. Everything is TypeScript, on pnpm workspaces
and Turborepo.

```
apps/
  web            Next.js - marketing site + browser game client
  control-plane  Fastify - accounts, rooms, billing (system of record)
  game-engine    Fastify + WebSocket - runs games, holds live state
packages/
  protocol         shared protocol types + the WebSocket transport adapter
  service-runtime  shared Fastify-service helpers (env parsing, Redis client)
  config           shared tsconfig, ESLint, Prettier
infra/
  docker-compose.yml   Postgres + Redis + the three apps, end to end
```

## Quick start

You need Node 22+ and pnpm 11. Docker is only needed to run the whole system at once.

```sh
git clone git@github.com:rogueoak/branchout.git
cd branchout
pnpm install       # set up the workspace
pnpm build         # build every package and app
pnpm lint          # lint everything
pnpm test          # run every test
```

Run the whole system with Postgres, Redis, and all three apps wired together:

```sh
cp infra/.env.example infra/.env
docker compose -f infra/docker-compose.yml up --build
```

Then:

- web: http://localhost:3000
- control-plane health: http://localhost:4000/health
- game-engine health: http://localhost:4001/health

Working on one app? Run it standalone with hot reload (point it at a local or compose
Postgres/Redis first):

```sh
pnpm --filter @branchout/web dev
pnpm --filter @branchout/control-plane dev
pnpm --filter @branchout/game-engine dev
```

## What's new

`0.0.0` - the monorepo scaffold (spec `0001`): the three apps, shared `config` and `protocol`
packages, CI, and a docker-compose that runs the whole system locally. No feature logic yet.

## Documentation

- `docs/overview/` - living docs: project, features, architecture, learnings.
- `docs/specs/` - the spec roadmap. Start at `docs/specs/README.md`.
- `docs/rules/` and `docs/spectra/` - how changes ship (Trellis + Spectra).
- `CONTRIBUTING.md` - how to work in this repo.

## License

MIT. See [LICENSE](LICENSE).
