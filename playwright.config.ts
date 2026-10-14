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
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npx serve e2e/fixtures -l 3456 --no-clipboard',
    port: 3456,
    reuseExistingServer: true,
  },
});
