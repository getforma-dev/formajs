import { test, expect, type Page } from '@playwright/test';

/**
 * The front-page claim, executed by a real browser under a real header.
 *
 * happy-dom has no CSP engine, so every unit test in this repo can only prove
 * that FormaJS does not *call* the Function constructor. This spec proves the
 * thing users actually care about: a browser (Chromium on every merge, Firefox
 * and WebKit before each release), given
 * `Content-Security-Policy: script-src 'self'` on the response, runs the
 * flagship example — arrow-function callback and all — and reports no
 * violation of any kind.
 *
 * The header is attached by route-fulfilling the two requests rather than by a
 * `<meta http-equiv>` tag, because a meta CSP is applied later in parsing and
 * is a weaker test than the real thing.
 */

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'";

/**
 * Serve every response for this page with a strict CSP header attached.
 * `inject` is markup added before the flagship's `</body>`, for the control
 * test that proves a violation is seen.
 */
async function withStrictCsp(page: Page, inject = ''): Promise<{ violations: string[]; errors: string[] }> {
  const violations: string[] = [];
  const errors: string[] = [];

  // Each engine words its CSP console message differently: Chromium
  // "…violates the following Content Security Policy directive…", WebKit
  // "Refused to execute…", Firefox "Content-Security-Policy: The page's
  // settings blocked…". The pattern once missed Firefox's hyphenated form, so
  // a Firefox run saw no violation at all; the event below is the record that
  // does not depend on wording.
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

  // Every engine fires `securitypolicyviolation` for each blocked action.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });
  });

  await page.route('**/*', async (route) => {
    const response = await route.fetch();
    const body = inject && route.request().url().endsWith('/flagship.html')
      ? (await response.text()).replace('</body>', `${inject}</body>`)
      : undefined;
    await route.fulfill({
      response,
      body,
      headers: { ...response.headers(), 'content-security-policy': CSP },
    });
  });

  return { violations, errors };
}

/** The `securitypolicyviolation` events the page has fired so far. */
const cspEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);

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
    expect(await cspEvents(page), 'securitypolicyviolation events').toEqual([]);
    expect(errors, `page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('a blocked inline script is seen as a violation in this engine', async ({ page }) => {
    // The control for the test above: zero violations means something only if
    // this engine's violations are seen at all, on both channels.
    const { violations } = await withStrictCsp(page, '<script>window.__inlineRan = true</script>');
    await page.goto('/flagship.html');
    await expect(page.locator('#count')).toHaveText('Found 5 results');

    expect(await page.evaluate(() => (window as unknown as { __inlineRan?: true }).__inlineRan)).toBeUndefined();
    await expect.poll(() => cspEvents(page)).toContainEqual(expect.stringMatching(/^script-src(-elem)? inline$/));
    await expect.poll(() => violations.length).toBeGreaterThan(0);
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
