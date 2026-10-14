#!/usr/bin/env node
/**
 * Measures what the expression engine's allocation budget (`LIMITS.ALLOC_BUDGET`,
 * src/expr/ast.ts; the cost table is src/expr/cost.ts) allows, in Chromium with
 * CPU throttling, so the budget can be re-derived on any machine.
 *
 * DR-16 sets the budget from N3, a 50 ms long task at 4x CPU slowdown. The
 * budget is sized from the TAIL, not the median, with garbage collection
 * counted: the slowest run of the largest call any cost row allows, and the
 * slowest run of an evaluation that spends the budget and then exhausts the
 * step budget (the interpreter work one evaluation may add), must each stay
 * under 50 ms.
 *
 * - Part 1 times `Array.from({length: n})`, the native alone, at candidate sizes.
 * - Part 2 times, through the built runtime, the largest call each heavy cost
 *   row allows at a cap (`--cap`, default the budget in ast.ts). A case the
 *   budget refuses prints REFUSED: it is sized wrong. A RESIDUAL row is a
 *   content-dependent worst case the per-character weights do not bound
 *   (SECURITY.md, FORMA-028); it is printed, and left out of the sum.
 * - Part 3 times one evaluation that exhausts the 100,000-step budget.
 * - `--chars` instead prints the per-character cost of the string rows, by
 *   the widest character of the text, against one `Array.from` slot: the table
 *   the weights in cost.ts come from.
 *
 * Garbage collection is counted: the heap is whatever earlier runs left, as on
 * a page. `--gc` forces a collection before each timed run instead.
 *
 * Not a test and not run in CI: it reads wall-clock time. Usage:
 *   npm run build && node scripts/measure-alloc-budget.mjs [--rate=4] [--runs=41] [--cap=N] [--gc] [--chars]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const flag = (name, fallback) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const BUDGET = Number(/ALLOC_BUDGET: ([\d_e.]+)/.exec(readFileSync(resolve(process.cwd(), 'src/expr/ast.ts'), 'utf8'))[1].replace(/_/g, ''));
const RATE = flag('rate', 4);
const RUNS = flag('runs', 41);
const CAP = flag('cap', BUDGET);
const FORCE_GC = process.argv.includes('--gc');
const runtime = readFileSync(resolve(process.cwd(), 'dist/formajs-runtime.global.js'), 'utf8');

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

console.log(`${await browser.version()}, CPU throttling ${RATE}x, ${RUNS} runs: median / p95 / max; cap ${CAP} (engine budget ${BUDGET}); ${FORCE_GC ? 'gc() before each run' : 'garbage collection counted'}\n`);

// Text whose characters cost the most to case-map, per tier (measured).
const TEXT = {
  ascii: 'The quick brown fox jumps over the lazy dog 0123456789 ',
  latinLower: 'ßßßß straße ',
  latinUpper: 'ÿµÿµ ',
  wideLower: 'İİİ ııı ',
  wideUpper: 'ΐΰΐΰ ',
};

if (process.argv.includes('--chars')) {
  const table = await page.evaluate(({ text, runs }) => {
    const N = 2_000_000;
    const max = (f) => {
      let worst = 0;
      for (let r = 0; r < runs; r++) {
        const start = performance.now();
        f();
        worst = Math.max(worst, performance.now() - start);
      }
      return (worst * 1e6) / N;
    };
    const flat = (unit) => { const s = unit.repeat(Math.ceil(N / unit.length)).slice(0, N); s.charCodeAt(0); return s; };
    const slot = (max(() => Array.from({ length: N / 8 })) * 8);
    const rows = [];
    for (const [tier, unit] of Object.entries(text)) {
      const s = flat(unit);
      rows.push([`toLowerCase, ${tier}`, max(() => s.toLowerCase())]);
      rows.push([`toUpperCase, ${tier}`, max(() => s.toUpperCase())]);
    }
    const a = flat('a');
    const ascii = flat(text.ascii);
    rows.push(['includes, ordinary text', max(() => ascii.includes('needle'))]);
    rows.push(["includes, 'ab' in 'aaaa…' (adversarial)", max(() => a.includes('ab'))]);
    rows.push(['trim, all whitespace', max(() => flat(' ').trim())]);
    rows.push(['slice, concatenated receiver', max(() => (ascii.slice(0, N / 2) + ascii.slice(N / 2)).slice(1, 5))]);
    return { slot, rows };
  }, { text: TEXT, runs: RUNS });
  console.log(`Per-character cost, max of ${RUNS} runs over 2,000,000 characters; one Array.from slot = ${table.slot.toFixed(1)} ns`);
  for (const [label, ns] of table.rows) console.log(`  ${label.padEnd(44)} ${ns.toFixed(1).padStart(6)} ns = ${(ns / table.slot).toFixed(3)} slot`);
  await browser.close();
  process.exit(0);
}

console.log('Part 1. Array.from({length: n}), the native alone');
for (const n of [200_000, 250_000, 300_000, 350_000, 400_000]) {
  const t = await page.evaluate(({ n, runs, forceGc }) => {
    const out = [];
    for (let r = 0; r < runs; r++) {
      if (forceGc) window.gc();
      const start = performance.now();
      Array.from({ length: n });
      out.push(performance.now() - start);
    }
    return out;
  }, { n, runs: RUNS, forceGc: FORCE_GC });
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
  ["split(',')", "v.split(',').length", 'commas', Math.floor((((CAP - 2) * 32) / 33 - 1) / 2)],
  ["replaceAll('c', 'yy')", "v.replaceAll('c', 'yy').length", 'chars', Math.floor((CAP - 4) / 2)],
  ['flat (pairs)', 'v.flat().length', 'pairs', Math.floor(CAP / 3) - 1],
  ['Array.from (string)', 'Array.from(v).length', 'chars', CAP - 1],
  ['concat (arrays)', 'v.concat(v).length', 'integers', Math.floor(CAP / 3) - 1],
  ['toLowerCase (ASCII)', 'v.toLowerCase().length', 'ascii', 32 * (CAP - 1)],
  ['toLowerCase (Latin-1, ß)', 'v.toLowerCase().length', 'latinLower', 32 * (CAP - 1)],
  ['toLowerCase (wider, İ ı)', 'v.toLowerCase().length', 'wideLower', 2 * (CAP - 1)],
  ['toUpperCase (ASCII)', 'v.toUpperCase().length', 'ascii', 16 * (CAP - 1)],
  ['toUpperCase (Latin-1, ÿ µ)', 'v.toUpperCase().length', 'latinUpper', 4 * (CAP - 1)],
  ['toUpperCase (wider, ΐ)', 'v.toUpperCase().length', 'wideUpper', CAP - 1],
  ["includes('needle'), ordinary text", "v.includes('needle')", 'ascii', 32 * (CAP - 7)],
  ['trim (all whitespace)', 'v.trim().length', 'spaces', 16 * (CAP - 1)],
  ['slice (concatenated receiver)', 'v.slice(1, 5)', 'rope', 64 * (CAP - 7)],
  ['text search, 9,000 records of 260', "v.filter(r => (r.title + ' ' + r.body).toLowerCase().includes('needle')).length", 'records', 9000],
  ["RESIDUAL includes('ab') in 'aaaa…'", "v.includes('ab')", 'as', 32 * (CAP - 3)],
];

async function timeBinding(expr, builder, n) {
  return page.evaluate(({ expr, builder, n, runs, samples, forceGc }) => {
    const flat = (unit, k) => { const s = unit.repeat(Math.ceil(k / unit.length) || 1).slice(0, k); s.charCodeAt(0); return s; };
    const words = 'alpha beta gamma delta epsilon zeta theta iota kappa lambda mu nu xi omicron pi rho ';
    const build = {
      ascii: (k) => flat(samples.ascii, k),
      latinLower: (k) => flat(samples.latinLower, k),
      latinUpper: (k) => flat(samples.latinUpper, k),
      wideLower: (k) => flat(samples.wideLower, k),
      wideUpper: (k) => flat(samples.wideUpper, k),
      spaces: (k) => flat(' ', k),
      as: (k) => flat('a', k),
      rope: (k) => flat(samples.ascii, k / 2) + flat(samples.ascii, k / 2),
      records: (k) => Array.from({ length: k }, (_, i) => ({
        title: `Record ${i} ${words}`.slice(0, 60),
        body: `${i % 10 ? '' : 'Needle '}${words.repeat(3)}`.slice(0, 200),
      })),
      none: () => 1,
      integers: (k) => Array.from({ length: k }, (_, i) => i),
      doubles: (k) => Array.from({ length: k }, () => Math.random()),
      chars: (k) => 'c'.repeat(k),
      commas: (k) => 'a,'.repeat(k),
      keyed: (k) => Object.fromEntries(Array.from({ length: k }, (_, i) => [`k${i}`, i])),
      holes: (k) => new Array(k),
      pairs: (k) => Array.from({ length: k }, (_, i) => [i, i]),
      pairsAndIntegers: (k) => Array.from({ length: k }, (_, i) => [i, i]),
    }[builder];
    const times = [];
    let text = '';
    let refused = '';
    const onDiagnostic = (e) => { refused = e.detail.reason; };
    window.addEventListener('formajs:diagnostic', onDiagnostic);
    for (let r = 0; r < runs; r++) {
      window.FormaRuntime.clearDiagnostics();
      const root = document.createElement('div');
      root.setAttribute('data-forma-state', '{"v": null, "w": null}');
      const span = document.createElement('span');
      span.setAttribute('data-text', `{v === null ? '' : ${expr}}`);
      root.append(span);
      document.body.append(root);
      window.FormaRuntime.mount(root);
      const value = build(n);
      if (builder === 'pairsAndIntegers') {
        window.FormaRuntime.setScopeValue(root, 'w', Array.from({ length: 99_999 }, (_, i) => i));
      }
      if (forceGc) window.gc();
      const start = performance.now();
      window.FormaRuntime.setScopeValue(root, 'v', value);
      times.push(performance.now() - start);
      text = span.textContent;
      window.FormaRuntime.unmount(root);
      root.remove();
    }
    window.removeEventListener('formajs:diagnostic', onDiagnostic);
    return { times, text, refused };
  }, { expr, builder, n, runs: RUNS, samples: TEXT, forceGc: FORCE_GC });
}

console.log(`\nPart 2. The largest call each row allows at a cap of ${CAP}, through the runtime`);
let worst = 0;
let worstLabel = '';
for (const [label, expr, builder, n] of cases) {
  const result = await timeBinding(expr, builder, n);
  const tail = Math.max(...result.times);
  const byBudget = /allocation budget/.test(result.refused);
  if (!byBudget && !label.startsWith('RESIDUAL') && tail > worst) {
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

// One evaluation that spends what the budget leaves after the callbacks'
// own row (some() charges its 99,999 elements) on the costliest row per unit,
// then exhausts the step budget: the two cannot both be at their maximum.
const flatPairs = Math.floor((CAP - 99_999 - 1) / 3) - 1;
const both = await timeBinding(
  `v.flat().length + (w.some(x => x < 0) ? 1 : 0)`, 'pairsAndIntegers', flatPairs,
);
const bothTail = Math.max(...both.times);
console.log(`  flat() of ${flatPairs} pairs, then some() to the step budget  ${stats(both.times)}  ${both.refused || both.text}`);

console.log(`\nslowest row max (${worstLabel}) = ${worst.toFixed(1)} ms; slowest run at the budget with the step budget exhausted = ${bothTail.toFixed(1)} ms (a full step budget alone: ${stepTail.toFixed(1)} ms); N3 asks for under 50`);
await browser.close();
