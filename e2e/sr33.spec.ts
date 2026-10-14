import { test, expect, type CDPSession, type Page } from '@playwright/test';
import { COSTS, DATA_ARGS } from '../src/expr/cost';
import { callables, DATA_CASES, hostileFixtures, SIZE_CASES } from '../src/expr/__tests__/hostile-natives';

/**
 * SR33 (DR-16) in a real browser: for each permitted native, a hostile-size
 * call is refused before it allocates, heap growth stays under the ceiling, and
 * no task passes 50 ms, in Chromium at 4x CPU throttling (FORMA-028, carried
 * from FORMA-137). Firefox and WebKit run the same cases unthrottled, without
 * the heap reading, which only Chromium's DevTools protocol gives.
 *
 * The table is the one native-cost.test.ts checks in Node
 * (src/expr/__tests__/hostile-natives.ts). "Before it allocates" is observed:
 * an init script wraps every allowlisted intrinsic in a call-through Proxy
 * before the runtime loads, so the runtime captures the wrappers, and a
 * wrapper records a call whose receiver or argument is a hostile fixture.
 */

const LONG_TASK_MS = 50;
const HEAP_CEILING = 16 * 1024 * 1024;
const CALLABLES = callables();

interface Case { name: string; src: string }

/** Every native with an argument heavier than the budget, then every cost row at a hostile size. */
const CASES: Case[] = [
  ...CALLABLES.filter((c) => !DATA_ARGS.has(c.name)).map((c) => ({ name: c.name, src: c.call('big') })),
  ...Object.entries(SIZE_CASES).map(([name, src]) => ({ name, src })),
  ...Object.entries(DATA_CASES).map(([name, src]) => ({ name, src })),
];

/** Installed before any page script: wrap each intrinsic, count calls that touch a hostile value. */
function wrapIntrinsics(list: Array<{ name: string; owner: string; key: string }>): void {
  const w = window as unknown as Record<string, unknown>;
  const isArray = Array.isArray;
  const objects = new WeakSet<object>();
  const strings = new Set<string>();
  const hits: Record<string, number> = Object.create(null);
  const hostile = (v: unknown): boolean => {
    if (typeof v === 'string') return strings.has(v);
    if (typeof v !== 'object' || v === null) return false;
    if (objects.has(v)) return true;
    // An array-like built inside the expression: `{length: 12000000}`, `{length: big}`.
    const length = (v as { length?: unknown }).length;
    return !isArray(v) && ((typeof length === 'number' && length > 250_000) || (typeof length === 'object' && length !== null && objects.has(length)));
  };
  for (const c of list) {
    let owner: unknown = window;
    for (const part of c.owner.split('.').filter(Boolean)) owner = Reflect.get(owner as object, part);
    const original = Reflect.get(owner as object, c.key) as (...a: unknown[]) => unknown;
    Reflect.set(owner as object, c.key, new Proxy(original, {
      apply(target, self, args: unknown[]) {
        let touched = hostile(self);
        for (let i = 0; i < args.length && !touched; i++) touched = hostile(args[i]);
        if (touched) hits[c.name] = (hits[c.name] ?? 0) + 1;
        return Reflect.apply(target, self, args);
      },
    }));
  }
  w.__sr33 = { objects, strings, hits };
}

async function setUp(page: Page, browserName: string): Promise<CDPSession | null> {
  await page.addInitScript(wrapIntrinsics, CALLABLES.map(({ name, owner, key }) => ({ name, owner, key })));
  await page.goto('/runtime-bare.html');
  // The fixtures, built in the page and registered as hostile.
  await page.evaluate(`(() => {
    const f = (${hostileFixtures.toString()})();
    for (const o of f.objects) window.__sr33.objects.add(o);
    for (const s of f.strings) window.__sr33.strings.add(s);
    window.__sr33.state = { items: [3, 1, 2], s: 'probe', n: 4242.5, ...f.state };
  })()`);
  if (browserName !== 'chromium') return null;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return cdp;
}

interface Outcome { code: string | null; value: string; ms: number; hits: number }

/** Mount a binding guarded by `ready`, hand it the fixtures, then time the evaluation `ready = 1` starts. */
async function run(page: Page, c: Case): Promise<Outcome> {
  await page.evaluate(({ src }) => {
    const w = window as unknown as { __sr33: { state: Record<string, unknown>; root?: Element }; FormaRuntime: any };
    w.__sr33.root?.remove();
    const root = document.createElement('div');
    const keys = Object.keys(w.__sr33.state);
    root.setAttribute('data-forma-state', JSON.stringify(Object.fromEntries([['ready', 0], ...keys.map((k) => [k, null])])));
    const p = document.createElement('p');
    p.setAttribute('data-text', `{ready === 0 ? 'idle' : String((${src}) ?? '')}`);
    root.append(p);
    document.body.append(root);
    w.FormaRuntime.mount(root);
    for (const k of keys) w.FormaRuntime.setScopeValue(root, k, w.__sr33.state[k]);
    w.__sr33.root = root;
  }, { src: c.src });
  // A fresh task for the timed evaluation, as a page would start one.
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)));
  return page.evaluate(({ name }) => {
    const w = window as unknown as { __sr33: { root: Element; hits: Record<string, number> }; FormaRuntime: any };
    w.FormaRuntime.clearDiagnostics();
    w.__sr33.hits[name] = 0;
    const start = performance.now();
    w.FormaRuntime.setScopeValue(w.__sr33.root, 'ready', 1);
    const ms = performance.now() - start;
    const d = w.FormaRuntime.getDiagnostics() as Array<{ code: string }>;
    return { code: d.length ? d[0]!.code : null, value: w.__sr33.root.textContent!.slice(0, 40), ms, hits: w.__sr33.hits[name] ?? 0 };
  }, { name: c.name });
}

test('SR33: every permitted native refuses a hostile size before it allocates, with no task over 50 ms', async ({ page, browserName }) => {
  test.setTimeout(180_000);
  // Completeness: every cost row has a hostile size, every data-argument row a case.
  expect(Object.keys(SIZE_CASES).sort()).toEqual(Object.keys(COSTS).sort());
  expect(CASES.length).toBeGreaterThan(110);
  const cdp = await setUp(page, browserName);

  // Control: a wrapper sees a call that touches a hostile value, so a zero below
  // means the native never ran, not that nothing was watching. Slicing the
  // 1,000-character fixture costs 16 units and is answered.
  const control = await run(page, { name: 'string.slice', src: 'short.slice(0, 3).length' });
  expect(control).toMatchObject({ code: null, value: '3', hits: 1 });

  const problems: string[] = [];
  for (const c of CASES) {
    if (cdp) await cdp.send('HeapProfiler.collectGarbage');
    const before = cdp ? (await cdp.send('Runtime.getHeapUsage')).usedSize : 0;
    const o = await run(page, c);
    const grew = cdp ? (await cdp.send('Runtime.getHeapUsage')).usedSize - before : 0;
    if (o.code !== 'FORMA_E_BUDGET') problems.push(`${c.src} → ${o.code ?? `answered ${o.value}`}, not FORMA_E_BUDGET`);
    if (o.hits) problems.push(`${c.src} → ${c.name} ran on the hostile value ${o.hits} time(s) before the refusal`);
    if (o.ms >= LONG_TASK_MS) problems.push(`${c.src} → a ${o.ms.toFixed(1)} ms task`);
    if (grew > HEAP_CEILING) problems.push(`${c.src} → the heap grew ${(grew / 1e6).toFixed(1)} MB`);
  }
  expect(problems).toEqual([]);
});
