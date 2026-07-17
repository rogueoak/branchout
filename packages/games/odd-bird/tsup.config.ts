import { defineConfig } from 'tsup';

// Bundle the game's source to a single ESM entry, leaving the workspace contracts external so the
// engine resolves them from node_modules at run time. The roost data under `data/` is read from disk
// at run time (via the injected asset loader), never bundled - hence it is not an entry here.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['@branchout/protocol', '@branchout/game-sdk'],
});
