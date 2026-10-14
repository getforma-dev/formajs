import { test, expect } from '@playwright/test';

/**
 * DR-16 in a real browser: the audit's run 4, as a regression test.
 *
 * `Array.from({length: 12000000})` in a `data-text` binding used to build a
 * twelve-million-element array in a 300 ms task and only then report
 * `FORMA_E_BUDGET`. The preflight refuses it before the native runs, so the
 * binding is refused with the same code, the page keeps its server text, and
 * no task on the page reaches 50 ms. The control binding beside it renders.
 */
test('a hostile Array.from in a binding is refused before it allocates, with no long task', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('/expr-cost.html');
  await expect(page.locator('#control')).toHaveText('1000');
  await expect(page.locator('#hostile')).toHaveText('unset');

  const diagnostics = await page.evaluate(
    () => (window as unknown as { FormaRuntime: { getDiagnostics(): Array<{ code: string; expr: string }> } })
      .FormaRuntime.getDiagnostics(),
  );
  expect(diagnostics.map((d) => [d.code, d.expr])).toEqual([
    ['FORMA_E_BUDGET', 'Array.from({length: 12000000}).length'],
  ]);

  // Let the observer deliver, then read every long task the page had.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  expect(longTasks.filter((ms) => ms >= 50), `long tasks: ${longTasks.join(', ')} ms`).toEqual([]);
  expect(errors).toEqual([]);
});
