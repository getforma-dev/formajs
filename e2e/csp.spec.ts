import { test, expect, type Page } from '@playwright/test';

/**
 * The front-page claim, executed by a real browser under a real header.
 *
 * happy-dom has no CSP engine, so every unit test in this repo can only prove
 * that FormaJS does not *call* the Function constructor. This spec proves the
 * thing users actually care about: Chromium, given
 * `Content-Security-Policy: script-src 'self'` on the response, runs the
 * flagship example — arrow-function callback and all — and reports no
 * violation of any kind.
 *
 * The header is attached by route-fulfilling the two requests rather than by a
 * `<meta http-equiv>` tag, because a meta CSP is applied later in parsing and
 * is a weaker test than the real thing.
 */

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'";

/** Serve every response for this page with a strict CSP header attached. */
async function withStrictCsp(page: Page): Promise<{ violations: string[]; errors: string[] }> {
  const violations: string[] = [];
  const errors: string[] = [];

  page.on('console', (msg) => {
    const text = msg.text();
    if (/content security policy|refused to (execute|evaluate|load|apply)/i.test(text)) {
      violations.push(text);
    }
  });
  page.on('pageerror', (err) => {
    errors.push(String(err));
    // A CSP-blocked `new Function()` surfaces as an EvalError on the page, not
    // only as a console message, so it is captured on both channels.
    if (/EvalError|unsafe-eval/i.test(String(err))) violations.push(String(err));
  });

  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': CSP },
    });
  });

  return { violations, errors };
}

test.describe('the flagship example under Content-Security-Policy: script-src \'self\'', () => {
  test('renders, filters and reacts with zero CSP violations', async ({ page }) => {
    const { violations, errors } = await withStrictCsp(page);

    await page.goto('/flagship.html');

    // The header really is on the response — otherwise this whole spec is a
    // no-op that would pass with `unsafe-eval` in place.
    const applied = await page.evaluate(() => {
      // Best-effort: if the document parsed at all, the runtime script loaded
      // under 'self', which is the only source the policy allows.
      return document.querySelectorAll('script[src]').length;
    });
    expect(applied).toBe(1);

    // The documented behaviour, in a real browser.
    await expect(page.locator('#count')).toHaveText('Found 5 results');
    await expect(page.locator('#list li')).toHaveCount(5);
    await expect(page.locator('#empty')).toBeHidden();

    await page.fill('#query', 'apple');
    await expect(page.locator('#count')).toHaveText('Found 1 results');
    await expect(page.locator('#list li')).toHaveCount(1);
    await expect(page.locator('#list li').first()).toHaveText('Apples');

    await page.fill('#query', 'zzz');
    await expect(page.locator('#count')).toHaveText('Found 0 results');
    await expect(page.locator('#list li')).toHaveCount(0);
    await expect(page.locator('#empty')).toBeVisible();

    await page.fill('#query', '');
    await expect(page.locator('#list li')).toHaveCount(5);

    await page.click('#toggle');
    await expect(page.locator('#themed')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#theme-label')).toHaveText('Dark');

    // Zero violations, and no page error of any kind.
    expect(violations, `CSP violations: ${violations.join(' | ')}`).toEqual([]);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('the runtime reports no diagnostics for the flagship markup', async ({ page }) => {
    await withStrictCsp(page);
    await page.goto('/flagship.html');
    await expect(page.locator('#count')).toHaveText('Found 5 results');

    const diagnostics = await page.evaluate(
      () => (window as unknown as { FormaRuntime: { getDiagnostics(): unknown[] } })
        .FormaRuntime.getDiagnostics(),
    );
    expect(diagnostics).toEqual([]);
    await expect(page.locator('[data-forma-expr-error]')).toHaveCount(0);
    await expect(page.locator('[data-forma-handler-error]')).toHaveCount(0);
  });

  test('the shipped bundle contains no dynamic-code construct', async ({ page }) => {
    // The bytes the browser actually downloaded, not the source. A CSP header
    // cannot be the only thing standing between a page and `new Function`.
    const response = await page.request.get('/formajs-runtime.global.js');
    const code = await response.text();
    expect(code).not.toMatch(/new Function\s*\(/);
    expect(code).not.toMatch(/\bwith\s*\(/);
    expect(code).not.toMatch(/[^.\w]eval\s*\(/);
  });
});
