import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/icon.ts',
    'src/favicon.ts',
    'src/logo.ts',
    'src/trivia.ts',
    'src/liarliar.ts',
    'src/hero-trivia.ts',
    'src/hero-liarliar.ts',
    'src/teeter-tower.ts',
    'src/reversi.ts',
    'src/chess.ts',
    'src/brand.ts',
    'src/avatar-ids.ts',
    'src/avatars.ts',
  ],
  outDir: 'dist',
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: false,
  loader: { '.svg': 'text' },
});
