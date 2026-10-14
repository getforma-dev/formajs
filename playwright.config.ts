import { defineConfig } from '@playwright/test';

// Three engines (decision brief DR-9): Chromium on every merge, Firefox and
// WebKit before each release. `npm run test:e2e` selects the `chromium`
// project only; `npm run test:e2e:engines` (like a bare `npx playwright test`)
// runs all three. The release gate that runs them is
// .github/workflows/e2e-engines.yml.
export default defineConfig({
  testDir: 'e2e',
  timeout: 10000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3456',
    headless: true,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    // WebKit's tests get 30 s, 3x the default (FORMA-179). A worker fixture
    // shares the timeout of the test that starts it, so the first test in each
    // worker pays the engine's launch and first page inside its own timeout.
    // On a slow runner that took more than 10 s: twice the only failures were
    // exactly the first test of each of the two workers, timed out setting up
    // (core 2.0.2's first release run; run 38620367433, whose suite took 1.3
    // minutes where it takes about 30 s).
    { name: 'webkit', use: { browserName: 'webkit' }, timeout: 30_000 },
  ],
  webServer: {
    command: 'npx serve e2e/fixtures -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: true,
  },
});
