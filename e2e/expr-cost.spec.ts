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

/**
 * FORMA-028 and FORMA-025 in a real browser, on a bare page each test mounts
 * its widget into. Every task the widget causes is timed: the mount, and each
 * timer callback the runtime schedules (the task budget's retry), through a
 * setTimeout wrapper installed before the runtime loads. Unthrottled here, so
 * a slow CI runner cannot flip the verdict; the same cases at 4x CPU
 * throttling are measured by scripts/measure-alloc-budget.mjs and recorded in
 * the CHANGELOG.
 */
function timeTasks(): void {
  const real = window.setTimeout.bind(window);
  const w = window as unknown as { __tasks: number[] };
  w.__tasks = [];
  window.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) => real(() => {
    const start = performance.now();
    try {
      fn(...rest);
    } finally {
      w.__tasks.push(performance.now() - start);
    }
  }, ms)) as typeof window.setTimeout;
}

interface Mounted { mountMs: number; texts: string[]; codes: string[] }

async function mountWidget(page: import('@playwright/test').Page, html: string, state = '{}'): Promise<Mounted> {
  return page.evaluate(({ html, state }) => {
    const w = window as unknown as { FormaRuntime: any; __root?: Element };
    w.__root?.remove();
    w.FormaRuntime.clearDiagnostics();
    const root = document.createElement('div');
    root.setAttribute('data-forma-state', state);
    root.innerHTML = html;
    document.body.append(root);
    const start = performance.now();
    w.FormaRuntime.mount(root);
    const mountMs = performance.now() - start;
    w.__root = root;
    return {
      mountMs,
      texts: [...root.querySelectorAll('[data-out]')].map((e) => e.textContent ?? ''),
      codes: (w.FormaRuntime.getDiagnostics() as Array<{ code: string }>).map((d) => d.code),
    };
  }, { html, state });
}

const rope = (k: number): string => `Array.from({length: ${k}}).reduce((a) => a + a, 'x')`;

test('FORMA-028: each round-2 rope case is refused before the long task', async ({ page }) => {
  await page.addInitScript(timeTasks);
  await page.goto('/runtime-bare.html');
  const cases = {
    charCodeAt: `[${rope(19)}].map(big => Array.from({length: 15000}).map(() => (big + 'y').charCodeAt(0)).length)[0]`,
    index: `[${rope(19)}].map(big => Array.from({length: 15000}).map(() => (big + 'y')[0]).length)[0]`,
    equality: `[${rope(19)}].map(big => Array.from({length: 12000}).filter(() => big + 'y' === big + 'z').length)[0]`,
    sort: `[${rope(19)}].map(big => Array.from({length: 2000}).map((_, i) => big + i).sort().length)[0]`,
  };
  for (const [name, src] of Object.entries(cases)) {
    const m = await mountWidget(page, `<p data-out data-text="{${src}}">server</p>`);
    expect(m.codes, name).toEqual(['FORMA_E_BUDGET']);
    expect(m.texts, name).toEqual(['server']);
    expect(m.mountMs, `${name}: a ${m.mountMs.toFixed(1)} ms task`).toBeLessThan(50);
  }
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  expect(longTasks.filter((ms) => ms >= 50), `long tasks: ${longTasks.join(', ')} ms`).toEqual([]);
});

test('FORMA-028: ten bindings at the cap render one task at a time, none over 50 ms', async ({ page }) => {
  await page.addInitScript(timeTasks);
  await page.goto('/runtime-bare.html');
  const binding = '<p data-out data-text="{Array.from({length: 249990}).length}">server</p>';
  const m = await mountWidget(page, binding.repeat(10));
  // One budget per task: the mount task answers one binding; the rest wait.
  expect(m.texts.filter((t) => t === '249990')).toHaveLength(1);
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('[data-out]')].map((e) => e.textContent)))
    .toEqual(Array(10).fill('249990'));
  const r = await page.evaluate(() => ({
    tasks: (window as unknown as { __tasks: number[] }).__tasks,
    codes: ((window as unknown as { FormaRuntime: any }).FormaRuntime.getDiagnostics() as Array<{ code: string }>).map((d) => d.code),
    longTasks: (window as unknown as { __longTasks: number[] }).__longTasks,
  }));
  expect(r.codes).toEqual([]);
  expect(r.tasks.length).toBeGreaterThanOrEqual(9);
  for (const ms of [m.mountMs, ...r.tasks]) expect(ms).toBeLessThan(50);
  expect(r.longTasks.filter((ms) => ms >= 50)).toEqual([]);
});

test('FORMA-025: data-text of a value heavier than the budget is refused before it is converted', async ({ page }) => {
  await page.addInitScript(() => {
    // String() of the hostile list would call join on it: count that.
    const join = Array.prototype.join;
    const w = window as unknown as { __joined: number };
    w.__joined = 0;
    Array.prototype.join = function (this: unknown[], ...a: unknown[]) {
      if (this.length === 1000 && typeof this[0] === 'string' && (this[0] as string).length === 300_000) w.__joined++;
      return Reflect.apply(join, this, a);
    } as typeof join;
  });
  await page.goto('/runtime-bare.html');
  const m = await mountWidget(
    page,
    '<p data-out data-text="{Array.from({length: 1000}).map(() => s)}">server</p>'
      + '<p data-out data-text="{Array.from({length: 3}).map(() => s.slice(0, 2))}">server</p>',
    JSON.stringify({ s: 'x'.repeat(300_000) }),
  );
  expect(m.codes).toEqual(['FORMA_E_BUDGET']);
  expect(m.texts).toEqual(['server', 'xx,xx,xx']);
  expect(await page.evaluate(() => (window as unknown as { __joined: number }).__joined)).toBe(0);
  expect(m.mountMs).toBeLessThan(50);
});
