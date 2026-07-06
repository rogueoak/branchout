import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'svg-text',
      transform(_code: string, id: string) {
        if (id.endsWith('.svg')) {
          return `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`;
        }
        return undefined;
      },
    },
  ],
  test: {
    environment: 'node',
    globals: true,
  },
});
