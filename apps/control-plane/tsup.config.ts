import { defineConfig } from 'tsup';

// Bundle our own source into a single ESM entry; leave runtime deps (express, pg, redis)
// external so Node resolves them from node_modules at run time.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: false,
});
