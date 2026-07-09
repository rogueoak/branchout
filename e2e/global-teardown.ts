import { downStack } from './lib/stack';

// Playwright globalTeardown: stop the stack and remove its volumes so the next run starts clean.
// Set E2E_KEEP_STACK=1 to leave it up for debugging (inspect logs, re-run a single spec faster).
export default function globalTeardown(): void {
  if (process.env.E2E_KEEP_STACK === '1') {
    console.log('[e2e] E2E_KEEP_STACK=1 - leaving the stack running.');
    return;
  }
  console.log('[e2e] tearing down docker compose stack...');
  downStack();
}
