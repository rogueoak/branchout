import { defineConfig, devices } from '@playwright/test';

// One-off config to run the multi-player game e2e against the LIVE site (branchout.games) instead of
// the local docker stack. No globalSetup (no Docker bring-up); baseURL points at production. Used
// for the post-deploy sanity check - drives real 2-player Trivia + Liar Liar games on prod.
export default defineConfig({
  testDir: './tests',
  timeout: 150_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PROD_URL ?? 'https://branchout.games',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'prod-desktop', use: { ...devices['Desktop Chrome'] } }],
});
