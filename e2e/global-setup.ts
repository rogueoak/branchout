import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upStack, waitForWeb, BASE_URL } from './lib/stack';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Playwright globalSetup: build the workspace, bring the full docker-compose stack up, and wait for
// the web app to answer /health before any spec runs.
export default async function globalSetup(): Promise<void> {
  // Fast local iteration: assume a stack is already up (from a previous E2E_KEEP_STACK run) and
  // only wait for health. Skips the build and `docker compose up` entirely.
  if (process.env.E2E_SKIP_STACK === '1') {
    console.log(`[e2e] E2E_SKIP_STACK=1 - using the already-running stack at ${BASE_URL}`);
    await waitForWeb();
    return;
  }

  // The dev overlay bind-mounts the repo and runs `next dev`, so the container serves the host's
  // built artifacts: @branchout/theme's brand.css, @branchout/brand's generated public PNGs (the
  // share cards), and every package's dist. Build them first (turbo-cached, so reruns are cheap).
  // Skippable for a fast local re-run when the tree is already built.
  if (process.env.E2E_SKIP_BUILD !== '1') {
    console.log('[e2e] building workspace (pnpm build)...');
    execFileSync('pnpm', ['build'], { cwd: repoRoot, stdio: 'inherit' });
  }

  console.log('[e2e] starting docker compose stack (this can take a few minutes on first run)...');
  upStack();

  console.log(`[e2e] waiting for web app at ${BASE_URL} ...`);
  await waitForWeb();
  console.log('[e2e] stack is healthy.');
}
