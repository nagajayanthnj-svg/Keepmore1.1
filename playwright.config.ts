import { defineConfig, devices } from '@playwright/test';

// Port 3100, so it never collides with the Phase 0 webhook listener on 3000.
const port = 3100;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // On CI, also write the HTML report: the workflow uploads playwright-report/ when a run fails.
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://localhost:${port}`,
    // A fake public client id: the e2e tests replace the PayPal script, so no PayPal call is made.
    // The AI is the test-only fixture (never a real model in e2e, CLAUDE.md); it refuses to run in production.
    env: { NEXT_PUBLIC_PAYPAL_CLIENT_ID: 'e2e-client-id', DISABLE_POLLER: '1', AI_PROVIDER: 'fixture', KEEPMORE_E2E: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
