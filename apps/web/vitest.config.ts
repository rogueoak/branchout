import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Unit tests assert on className strings, not applied styles. Treating CSS imports as no-ops
    // lets a test import layout.tsx (which pulls in globals.css / Tailwind directives) without
    // running the full CSS pipeline in jsdom.
    css: false,
  },
});
