import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/icon.ts',
    'src/favicon.ts',
    'src/logo.ts',
    'src/trivia.ts',
    'src/liarliar.ts',
    'src/brand.ts',
  ],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  loader: { '.svg': 'text' },
});
