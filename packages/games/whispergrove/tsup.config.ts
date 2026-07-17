import { defineConfig } from 'tsup';

// Bundle the game's source to a single ESM entry, leaving the workspace contracts external so the
// engine resolves them from node_modules at run time. The word bank is loaded from `data/` at run
// time via the asset loader (not bundled), so the bank can be swapped for the private full bank.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['@branchout/protocol', '@branchout/game-sdk'],
});
