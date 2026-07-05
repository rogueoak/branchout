import { defineConfig } from 'tsup';

// Two entry points: the root (pure protocol types + message helpers, no transport) and
// `./ws` (the `ws`-backed adapter). Keeping them separate lets web and control-plane import
// the types without pulling the `ws` runtime.
export default defineConfig({
  entry: ['src/index.ts', 'src/ws.ts'],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['ws'],
});
