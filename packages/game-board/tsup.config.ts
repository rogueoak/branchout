import { defineConfig } from 'tsup';

// Bundle the harness to a single ESM entry, leaving the workspace contract (@branchout/game-sdk)
// external so a consumer resolves it from node_modules at run time. This is pure board logic - no
// native/heavy dependency to bundle - so there is nothing to noExternal.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['@branchout/game-sdk'],
});
