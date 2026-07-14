import { defineConfig } from 'tsup';

// Bundle our own source into a single ESM entry; leave runtime deps (fastify, redis,
// @branchout/protocol) external so Node resolves them from node_modules at run time.
//
// The game packages are listed explicitly, not just left to tsup's implicit externalization of
// dependencies: a game plugin reads its own bundled `data/` (e.g. @branchout/game-trivia's 1600
// questions) from disk, rooted at its package via import.meta.url. Inlining a game into this bundle
// would sever its module from that `data/` and break the load. Every future game package
// (Liar Liar, ...) must stay external here for the same reason.
//
// Two entries (spec 0045): the service (`index.ts`) and the per-session game worker
// (`worker/game-worker.ts`, emitted to dist/worker/game-worker.js, which index.ts resolves + spawns).
// Both keep the game packages external so a worker's inlined trivia/liar-liar still find their data/.
export default defineConfig({
  entry: ['src/index.ts', 'src/worker/game-worker.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: false,
  external: [
    '@branchout/game-sdk',
    '@branchout/game-trivia',
    '@branchout/game-liar-liar',
    '@branchout/game-teeter-tower',
  ],
});
