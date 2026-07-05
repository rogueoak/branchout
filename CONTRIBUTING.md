# Contributing

Thanks for helping build Branch out. This repo runs on two conventions - read them once and
they stay out of your way.

- **Trellis** (`docs/rules/`) - how to write and ship: ASCII-only text, and code that passes
  tests, lint, and build before it merges.
- **Spectra** (`docs/spectra/protocol.md`) - spec-driven development. A feature starts as a
  spec in `docs/specs/`, a bug starts as a doc in `docs/feedback/`.

## Setup

You need Node 20+ and pnpm 11.

```sh
pnpm install
pnpm build
pnpm test
```

## Workflow

1. Route the change (Spectra step 1). Trivial fix, new feature (spec first), or bug (feedback
   doc first).
2. Build on a branch in a worktree, leaving `main` clean:
   `git worktree add .worktrees/<slug> -b <slug>`.
3. Get the checks green **before you commit** - no exceptions:

   ```sh
   pnpm build && pnpm lint && pnpm test && pnpm format:check
   ```

   Every app and package carries at least one real test; add one for the behavior you change.

4. Commit with [Conventional Commits](https://www.conventionalcommits.org): `type(scope):
summary`, imperative and short. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`,
   `build`, `ci`, `perf`.
5. Open a PR to `main`. Spectra personas review it; resolve every comment before merge.
6. Reflect: update the `docs/overview/` living docs for anything that changed.

## Layout

- `apps/*` - deployable services (`web`, `control-plane`, `game-engine`).
- `packages/*` - shared libraries (`protocol`, `config`).
- `infra/` - docker-compose and the local environment.

Shared tooling lives in `@branchout/config` (tsconfig, ESLint, Prettier). Keep versions in step
with rogueoak/canopy so the two repos feel the same.
