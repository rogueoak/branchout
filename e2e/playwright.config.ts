import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './lib/stack';

// Playwright drives a real browser against the full docker-compose stack (Postgres + Redis + web +
// control-plane + game-engine). globalSetup builds the workspace and brings the stack up; each spec
// talks to the real services. See e2e/README.md.
export default defineConfig({
  testDir: './tests',
  // The stack takes time to boot; each test still gets a generous-but-bounded budget.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  // No accidental .only reaching CI.
  forbidOnly: !!process.env.CI,
  // Flake guard in CI only; locally a failure fails immediately so it is obvious.
  retries: process.env.CI ? 2 : 0,
  // The stack is shared state (one room namespace, one DB), so run serially.
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // The functional flows run on desktop Chromium, where a host and a joiner both default to the
    // interactive (viewer) mode a game needs. (On a phone UA the host defaults to remote-only, a
    // separate mode-selection flow that a later spec can cover.)
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testMatch: ['share-unfurl.spec.ts', 'trivia-round.spec.ts', 'profile.spec.ts'],
    },
    // The product is mobile-first, so a phone-viewport lane guards that the key surfaces render and
    // fit at ~390px (no horizontal overflow) - the mobile-first non-negotiable, checked in a real
    // small-viewport browser.
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'] },
      testMatch: ['mobile-smoke.spec.ts'],
    },
  ],
});
