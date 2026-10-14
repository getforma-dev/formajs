#!/usr/bin/env node
/**
 * Measures what the expression engine's allocation budget (`LIMITS.ALLOC_BUDGET`,
 * src/expr/ast.ts; the cost table is src/expr/cost.ts) allows, in Chromium with
 * CPU throttling, so the budget can be re-derived on any machine.
 *
 * DR-16 sets the budget from N3, a 50 ms long task at 4x CPU slowdown. The
 * budget is sized from the TAIL, not the median: the slowest run of the
 * largest call any cost row allows, plus the slowest run of a full step budget
 * (the interpreter work one evaluation may add), must stay under 50 ms.
 *
 * - Part 1 times `Array.from({length: n})`, the native alone, at candidate sizes.
 * - Part 2 times, through the built runtime, the largest call each heavy cost
 *   row allows at a cap (`--cap`, default the budget in ast.ts). A case the
 *   budget refuses prints REFUSED: it is sized wrong.
 * - Part 3 times one evaluation that exhausts the 100,000-step budget.
 *
 * Not a test and not run in CI: it reads wall-clock time. Usage:
 *   npm run build && node scripts/measure-alloc-budget.mjs [--rate=4] [--runs=41] [--cap=N]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const flag = (name, fallback) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const BUDGET = Number(/ALLOC_BUDGET: ([\d_e.]+)/.exec(readFileSync(resolve(process.cwd(), 'src/expr/ast.ts'), 'utf8'))[1].replace(/_/g, ''));
const RATE = flag('rate', 4);
const RUNS = flag('runs', 41);
const CAP = flag('cap', BUDGET);
const runtime = readFileSync(resolve(process.cwd(), 'dist/formajs-runtime.global.js'), 'utf8');

// gc() before each timed run, so garbage left by building the next run's data
// is not counted against the call under test.
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] });
const page = await browser.newPage();
await page.setContent('<!DOCTYPE html><html><body></body></html>');
await page.addScriptTag({ content: runtime });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });

const stats = (t) => {
  const s = [...t].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  return `${at(0.5).toFixed(1).padStart(6)} / ${at(0.95).toFixed(1).padStart(6)} / ${s[s.length - 1].toFixed(1).padStart(6)} ms`;
};

console.log(`${await browser.version()}, CPU throttling ${RATE}x, ${RUNS} runs: median / p95 / max; cap ${CAP} (engine budget ${BUDGET})\n`);

console.log('Part 1. Array.from({length: n}), the native alone');
for (const n of [200_000, 250_000, 300_000, 350_000, 400_000]) {
  const t = await page.evaluate(({ n, runs }) => {
    const out = [];
    for (let r = 0; r < runs; r++) {
      window.gc();
      const start = performance.now();
      Array.from({ length: n });
      out.push(performance.now() - start);
    }
    return out;
  }, { n, runs: RUNS });
  console.log(`  n = ${String(n).padStart(7)}  ${stats(t)}`);
}

// The largest n with 3 n log2(n + 1) <= cap: the default sort row.
let sortN = 1;
while (3 * (sortN + 1) * Math.log2(sortN + 2) <= CAP) sortN++;

// Each case is the largest call its cost row allows at the cap: [label,
// expression, builder, size]. The builder makes the data in the page, outside
// the timed region; it is handed to the scope with setScopeValue, whose batch
// re-evaluates the binding synchronously, and that re-evaluation is timed. The
// binding is guarded with `===`, which converts nothing and so costs nothing.
const cases = [
  ['Array.from({length})', `Array.from({length: ${CAP - 10}}).length`, 'none', 0],
  ['join (integers)', 'v.join().length', 'integers', Math.floor((CAP - 1) / 5)],
  ['String (doubles)', 'String(v).length', 'doubles', Math.floor(CAP / 4) - 1],
  ['JSON.stringify (doubles)', 'JSON.stringify(v).length', 'doubles', Math.floor(CAP / 4) - 1],
  ['sort (doubles, default order)', 'v.sort().length', 'doubles', sortN],
  ['Object.entries (string)', 'Object.entries(v).length', 'chars', Math.floor(CAP / 16) - 1],
  ['Object.entries (object)', 'Object.entries(v).length', 'keyed', Math.floor(CAP / 16) - 1],
  ['Object.keys (object)', 'Object.keys(v).length', 'keyed', Math.floor(CAP / 16) - 1],
  ['every (sparse array)', 'v.every(x => x)', 'holes', CAP - 2],
  ["split(',')", "v.split(',').length", 'commas', Math.floor((CAP - 2) / 2) - 1],
  ["replaceAll('c', 'yy')", "v.replaceAll('c', 'yy').length", 'chars', Math.floor((CAP - 4) / 2)],
  ['flat (pairs)', 'v.flat().length', 'pairs', Math.floor(CAP / 3) - 1],
  ['Array.from (string)', 'Array.from(v).length', 'chars', CAP - 1],
  ['concat (arrays)', 'v.concat(v).length', 'integers', Math.floor(CAP / 3) - 1],
];

async function timeBinding(expr, builder, n) {
  return page.evaluate(({ expr, builder, n, runs }) => {
    const build = {
      none: () => 1,
      integers: (k) => Array.from({ length: k }, (_, i) => i),
      doubles: (k) => Array.from({ length: k }, () => Math.random()),
      chars: (k) => 'c'.repeat(k),
      commas: (k) => 'a,'.repeat(k),
      keyed: (k) => Object.fromEntries(Array.from({ length: k }, (_, i) => [`k${i}`, i])),
      holes: (k) => new Array(k),
      pairs: (k) => Array.from({ length: k }, (_, i) => [i, i]),
    }[builder];
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
      const value = build(n);
      window.gc();
      const start = performance.now();
      window.FormaRuntime.setScopeValue(root, 'v', value);
      times.push(performance.now() - start);
      text = span.textContent;
      window.FormaRuntime.unmount(root);
      root.remove();
    }
    window.removeEventListener('formajs:diagnostic', onDiagnostic);
    return { times, text, refused };
  }, { expr, builder, n, runs: RUNS });
}

console.log(`\nPart 2. The largest call each row allows at a cap of ${CAP}, through the runtime`);
let worst = 0;
let worstLabel = '';
for (const [label, expr, builder, n] of cases) {
  const result = await timeBinding(expr, builder, n);
  const tail = Math.max(...result.times);
  const byBudget = /allocation budget/.test(result.refused);
  if (!byBudget && tail > worst) {
    worst = tail;
    worstLabel = label;
  }
  // A refusal by the 1 MiB result cap still timed the whole call; a refusal by
  // the budget means the case is sized wrong.
  const verdict = byBudget
    ? `REFUSED by the budget: ${result.refused}`
    : result.refused ? `refused after the call: ${result.refused}` : `= ${result.text}`;
  console.log(`  ${label.padEnd(30)} ${stats(result.times)}  ${verdict}`);
}

console.log('\nPart 3. One evaluation that exhausts the 100,000-step budget');
// Callbacks over data that already exists, so nothing but interpreter steps is timed.
const steps = await timeBinding('v.some(x => x < 0)', 'integers', 99_999);
const stepTail = Math.max(...steps.times);
console.log(`  some() callbacks to the step budget  ${stats(steps.times)}  ${steps.refused || steps.text}`);

console.log(`\nslowest row max (${worstLabel}) + slowest step-budget run = ${worst.toFixed(1)} + ${stepTail.toFixed(1)} = ${(worst + stepTail).toFixed(1)} ms; N3 asks for under 50`);
await browser.close();
