import { defineConfig } from 'tsup';

// Bundle our own source into a single ESM entry; leave runtime deps (fastify, redis,
// @branchout/protocol) external so Node resolves them from node_modules at run time.
//
// The game packages are listed explicitly, not just left to tsup's implicit externalization of
// dependencies: a game plugin reads its own bundled `data/` (e.g. @branchout/game-trivia's 1600
// questions) from disk, rooted at its package via import.meta.url. Inlining a game into this bundle
// would sever its module from that `data/` and break the load. Every future game package
// (Liar Liar, ...) must stay external here for the same reason.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: false,
  external: ['@branchout/game-sdk', '@branchout/game-trivia'],
});
