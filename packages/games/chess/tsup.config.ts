import { defineConfig } from 'tsup';

// Bundle the game's source to a single ESM entry, leaving the workspace contracts external so the
// engine resolves them from node_modules at run time. Chess is pure board logic - no native/heavy
// dependency to bundle in - so there is nothing to noExternal.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['@branchout/protocol', '@branchout/game-sdk', '@branchout/game-board'],
});
