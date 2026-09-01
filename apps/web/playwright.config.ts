import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the browser tests.
 *
 * The servers are started by `scripts/test-browser.mjs` and handed to Playwright through
 * `SDR_WEB_URL` / `SDR_API_URL`, so a single process owns the lifecycle and ports can be
 * shifted when the fixed contract ports are already in use.
 */
const webUrl = process.env.SDR_WEB_URL ?? 'http://127.0.0.1:4273';
const apiUrl = process.env.SDR_API_URL ?? 'http://127.0.0.1:4274';

// Exposed for tests through `process.env.SDR_API_URL`.
process.env.SDR_API_URL = apiUrl;

export default defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: webUrl,
    // Surfaced to tests as `process.env.SDR_API_URL` when a step needs to call the API
    // directly (for example to seed a state the UI cannot create).
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
