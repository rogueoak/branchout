import { defineConfig } from 'tsup';

// Two entry points: the root (the game-facing contract - lifecycle types, the plugin/DI
// interface, and the asset loaders) and `./testing` (test-only helpers: a manual scheduler,
// a seeded rng, in-memory services, and the stub game). Keeping them separate means a game's
// production bundle never pulls in the test fixtures.
export default defineConfig({
  entry: ['src/index.ts', 'src/testing.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['@branchout/protocol'],
});
