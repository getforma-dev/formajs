#!/usr/bin/env node
/**
 * Measures what the expression engine's allocation budget (`LIMITS.ALLOC_BUDGET`,
 * src/expr/ast.ts; the cost table is src/expr/cost.ts) allows, in Chromium with
 * CPU throttling, so the budget can be re-derived on any machine.
 *
 * DR-16 sets the budget from N3, a 50 ms long task at 4x CPU slowdown. Part 1
 * times `Array.from({length: n})`, the costliest call per unit, at candidate
 * budgets. Part 2 times, through the built runtime, the largest call each
 * heavy cost row allows at the budget: the number the budget is meant to keep
 * under 50 ms.
 *
 * Not a test and not run in CI: it reads wall-clock time. Usage:
 *   npm run build && node scripts/measure-alloc-budget.mjs [--rate=4] [--runs=9]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const flag = (name, fallback) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const RATE = flag('rate', 4);
const RUNS = flag('runs', 9);
const runtime = readFileSync(resolve(process.cwd(), 'dist/formajs-runtime.global.js'), 'utf8');
const BUDGET = Number(/ALLOC_BUDGET: ([\d_e.]+)/.exec(readFileSync(resolve(process.cwd(), 'src/expr/ast.ts'), 'utf8'))[1].replace(/_/g, ''));

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!DOCTYPE html><html><body></body></html>');
await page.addScriptTag({ content: runtime });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });

console.log(`${await browser.version()}, CPU throttling ${RATE}x, median / max of ${RUNS} runs, budget ${BUDGET}\n`);

console.log('Part 1. Array.from({length: n}), the native alone');
const raw = await page.evaluate(({ runs }) => {
  const out = [];
  for (const n of [300_000, 400_000, 500_000]) {
    const t = [];
    for (let r = 0; r < runs; r++) {
      const start = performance.now();
      Array.from({ length: n });
      t.push(performance.now() - start);
    }
    t.sort((a, b) => a - b);
    out.push([n, t[runs >> 1], t[runs - 1]]);
  }
  return out;
}, { runs: RUNS });
for (const [n, med, max] of raw) console.log(`  n = ${String(n).padStart(7)}  ${med.toFixed(1).padStart(6)} / ${max.toFixed(1)} ms`);

// Each case is the largest call its cost row allows at the budget. The data it
// reads is built outside the timed region and handed to the scope with
// setScopeValue, whose batch re-evaluates the binding synchronously; that
// re-evaluation is what is timed. The binding is guarded with `===`, which
// converts nothing and so costs nothing.
const cases = [
  ['Array.from({length})', `Array.from({length: ${BUDGET - 10}}).length`, 1],
  ['join (numbers)', 'v.join().length', Array.from({ length: Math.floor((BUDGET - 1) / 5) }, (_, i) => i)],
  ['JSON.stringify (doubles)', 'JSON.stringify(v).length', Array.from({ length: Math.floor(BUDGET / 4) - 1 }, () => Math.random())],
  ['String (doubles)', 'String(v).length', Array.from({ length: Math.floor(BUDGET / 4) - 1 }, () => Math.random())],
  ['sort (doubles, default order)', 'v.sort().length', Array.from({ length: 10_000 }, () => Math.random() * 1e6)],
  ['Object.entries (string)', 'Object.entries(v).length', 'e'.repeat(Math.floor(BUDGET / 9) - 1)],
  ["split(',')", "v.split(',').length", 'a,'.repeat(Math.floor((BUDGET - 2) / 2) - 1)],
  ["replaceAll('x', 'yy')", "v.replaceAll('x', 'yy').length", 'x'.repeat(Math.floor(BUDGET / 2) - 4)],
  ['flat (pairs)', 'v.flat().length', Array.from({ length: Math.floor(BUDGET / 3) - 1 }, (_, i) => [i, i])],
  ['Array.from (string)', 'Array.from(v).length', 'f'.repeat(Math.floor(BUDGET / 2) - 1)],
];

console.log('\nPart 2. The largest call each row allows, through the runtime');
for (const [label, expr, value] of cases) {
  const result = await page.evaluate(({ expr, value, runs }) => {
    const times = [];
    let text = '';
    let refused = '';
    const onDiagnostic = (e) => { refused = e.detail.reason; };
    window.addEventListener('formajs:diagnostic', onDiagnostic);
    for (let r = 0; r < runs; r++) {
      window.FormaRuntime.clearDiagnostics();
      const root = document.createElement('div');
      root.setAttribute('data-forma-state', '{"v": null}');
      const span = document.createElement('span');
      span.setAttribute('data-text', `{v === null ? '' : ${expr}}`);
      root.append(span);
      document.body.append(root);
      window.FormaRuntime.mount(root);
      const fresh = typeof value === 'string' ? value : structuredClone(value);
      const start = performance.now();
      window.FormaRuntime.setScopeValue(root, 'v', fresh);
      times.push(performance.now() - start);
      text = span.textContent;
      window.FormaRuntime.unmount(root);
      root.remove();
    }
    window.removeEventListener('formajs:diagnostic', onDiagnostic);
    times.sort((a, b) => a - b);
    return { med: times[runs >> 1], max: times[runs - 1], text, refused };
  }, { expr, value, runs: RUNS });
  // A refusal by the 1 MiB result cap still timed the whole call; a refusal by
  // the budget means the case is sized wrong.
  const verdict = result.refused ? `refused after the call: ${result.refused}` : `= ${result.text}`;
  console.log(`  ${label.padEnd(30)} ${result.med.toFixed(1).padStart(6)} / ${result.max.toFixed(1)} ms  ${verdict}`);
}

await browser.close();
