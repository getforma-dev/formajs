import { test, expect, type Page } from '@playwright/test';

// data-fetch's timeout in a real browser (FORMA-132, decision brief L-46).
// The page's clock is Playwright's, paused before the page loads, so the 30
// seconds start when the runtime binds and pass only when the test says; the
// endpoint is a route that never answers. Each engine rejects an aborted fetch
// its own way (WebKit ignores the abort's reason), which is why this runs in
// all three.

async function serve(page: Page, body: string): Promise<void> {
  await page.route('**/fetch-timeout.html', (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><html><head><meta charset="utf-8"><title>data-fetch</title></head><body>${body}` +
      '<script src="/formajs-runtime.global.js"></script></body></html>',
  }));
  await page.goto('/fetch-timeout.html');
}

test('a data-fetch to a stalled endpoint aborts at 30 s into its error: target', async ({ page }) => {
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1_000);
  let requests = 0;
  // Never fulfilled: the server does not answer.
  await page.route('**/api/stalled', () => { requests++; });
  await page.route('**/api/answers', (route) => route.fulfill({ contentType: 'application/json', body: '"loaded"' }));
  await serve(page,
    '<div data-forma-state=\'{}\'>' +
    '<div data-fetch="GET /api/stalled → items |loading:busy |error:failed"></div>' +
    '<p id="busy" data-text="{busy}"></p><p id="failed" data-text="{failed}"></p>' +
    '</div>' +
    '<div data-forma-state=\'{}\'>' +
    '<div data-fetch="GET /api/answers → items |loading:busy |error:failed"></div>' +
    '<p id="items2" data-text="{items}"></p><p id="failed2" data-text="{failed}"></p>' +
    '</div>');

  await expect(page.locator('#busy')).toHaveText('true');
  await expect(page.locator('#items2')).toHaveText('loaded');
  await page.clock.fastForward(29_000);
  await expect(page.locator('#busy')).toHaveText('true');
  await expect(page.locator('#failed')).toHaveText('');

  await page.clock.fastForward(1_000);
  await expect(page.locator('#failed')).toHaveText('data-fetch timed out after 30000 ms');
  await expect(page.locator('#busy')).toHaveText('false');
  // The request that was answered is untouched by its own timer.
  await page.clock.fastForward(60_000);
  await expect(page.locator('#items2')).toHaveText('loaded');
  await expect(page.locator('#failed2')).toHaveText('');
  expect(requests).toBe(1);
});
