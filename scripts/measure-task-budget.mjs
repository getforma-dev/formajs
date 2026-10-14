#!/usr/bin/env node
/**
 * The hostile corpus and the ordinary-search corpus of FORMA-028 and FORMA-025,
 * measured through a built runtime in Chromium with CPU throttling.
 *
 * N3 asks that no task pass 50 ms at 4x. The budget is now one per task
 * (src/runtime.ts, "THE TASK'S BUDGET"), so one widget can spread its work
 * over several tasks: every task a widget causes is timed, the mount, the
 * update that hands it its data (`setScopeValue`), a click, and each timer
 * callback the runtime schedules afterwards (the retry of a deferred binding),
 * through a setTimeout wrapper installed before the runtime. A case prints the
 * p50, p99 and maximum, over its runs, of the worst task of each run, how many
 * runs had a task of 50 ms or more, the diagnostics and what it rendered.
 *
 * Case groups: R, the round-2 review's rope cases (formajs#14); T, one budget
 * per task; C, the runtime's own conversions (FORMA-025); S, the string reads
 * FORMA-028 charges and the patterns at the step budget; N, FORMA-004's
 * natives and largest evaluations; X, the content-dependent costs no price per
 * character bounds (SECURITY.md, "Termination and budgets"); O, the ordinary
 * search over 9,000 records, per script.
 *
 * Wall-clock time depends on the machine and its load: the machine's model and
 * load average are printed, and a comparison is meaningful only between
 * runtimes measured in the same run (`--runtime=a,b`).
 *
 * Not a test and not run in CI. Usage:
 *   npm run build && node scripts/measure-task-budget.mjs [--runtime=a.js,b.js] [--runs=41] [--rate=4] [--only=R,O3]
 */
import { readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const RUNS = Number(arg('runs', 41));
const RATE = Number(arg('rate', 4));
const RUNTIMES = arg('runtime', resolve(process.cwd(), 'dist/formajs-runtime.global.js')).split(',').filter(Boolean);
const ONLY = arg('only', '').split(',').filter(Boolean);

// ── The corpus: one widget per case; `v` is handed in by setScopeValue ──
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const t = (expr, guard = true) => `<p data-out data-text="${esc(`{${guard ? `v === null ? '' : ` : ''}${expr}}`)}">-</p>`;
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join('');
const rope = (k) => `Array.from({length: ${k}}).reduce((a) => a + a, 'x')`;
const AT_CAP = 'Array.from({length: 249990}).length';
const STEPS = 'Array.from({length: 16000}).map((x, i) => i).filter(i => i % 2).length';
const words = (w, needle, n) => `Array.from({length: ${n}}, (_, i) => ({ title: (i + ' ' + ${JSON.stringify(w)}).repeat(2).slice(0, 60), body: ((i % 10 === 0 ? ${JSON.stringify(needle)} + ' ' : '') + ${JSON.stringify(w)}).repeat(4).slice(0, 200) }))`;
const SEARCH = (needle) => `v.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(${JSON.stringify(needle).replace(/"/g, "'")})).length`;

const CASES = [
  // The round-2 review's cases (formajs#14), self-contained.
  ...[19, 15, 12, 10].flatMap((k) => [
    { name: `R2 charCodeAt, rope 2^${k}`, html: t(`[${rope(k)}].map(big => Array.from({length: 15000}).map(() => (big + 'y').charCodeAt(0)).length)[0]`, false) },
    { name: `R2 s[0], rope 2^${k}`, html: t(`[${rope(k)}].map(big => Array.from({length: 15000}).map(() => (big + 'y')[0]).length)[0]`, false) },
    { name: `R2 ===, rope 2^${k}`, html: t(`[${rope(k)}].map(big => Array.from({length: 12000}).filter(() => big + 'y' === big + 'z').length)[0]`, false) },
    { name: `R2 sort, rope 2^${k}`, html: t(`[${rope(k)}].map(big => Array.from({length: 2000}).map((_, i) => big + i).sort().length)[0]`, false) },
  ]),
  // One budget per task.
  { name: 'T1 ten bindings at the allocation cap', html: many(10, () => t(AT_CAP, false)) },
  { name: 'T2 ten bindings at the step cap', html: many(10, () => t(STEPS, false)) },
  { name: 'T3 ten bindings at both caps', data: '({ pairs: Array.from({length: 49999}, (_, i) => [i, i]), ints: Array.from({length: 99999}, (_, i) => i) })', html: many(10, () => t('v.pairs.flat().length + (v.ints.some(x => x < 0) ? 1 : 0)')) },
  { name: 'T4 a list of 50 rows, each binding at the cap', data: 'Array.from({length: 50}, (_, i) => i)', html: `<ul data-list="{v === null ? [] : v}"><li data-out data-text="{${AT_CAP} + item}">-</li></ul>` },
  { name: 'T5 a chain of ten computeds at the cap', html: `<div data-computed="${Array.from({ length: 10 }, (_, i) => `c${i} = Array.from({length: 200000}).length${i ? ` + c${i - 1}` : ''}`).join('; ')}">${t('c9', false)}</div>` },
  { name: 'T6 ten nested click handlers at the cap', click: '#h9', html: many(10, (i) => `<div id="h${i}" data-on:click="{n${i} = ${AT_CAP}}">`) + many(10, () => '</div>'), state: Object.fromEntries(many(10, (i) => `n${i},`).split(',').filter(Boolean).map((k) => [k, 0])) },
  { name: 'T7 a handler at the cap, then ten bindings at the cap', click: '#go', state: { n: 0 }, html: `<button id="go" data-on:click="{n = ${AT_CAP}}">go</button>` + many(10, () => t(`n === 0 ? 0 : ${AT_CAP}`, false)) },
  // FORMA-025: the runtime's conversions.
  { name: 'C1 data-text of 1,000 refs to 300,000 chars', data: "'x'.repeat(300000)", html: t('Array.from({length: 1000}).map(() => v)') },
  { name: 'C2 data-list placing 300,000 chars 1,000 times', data: "Array.from({length: 1000}, () => ({ name: 'x'.repeat(300000) }))", html: '<ul data-list="{v === null ? [] : v}"><li data-out>{item.name}</li></ul>' },
  { name: 'C3 data-bind of 1,000 refs to 300,000 chars', data: "'x'.repeat(300000)", html: `<p data-out data-bind:title="${esc("{v === null ? '' : Array.from({length: 1000}).map(() => v)}")}">-</p>` },
  // Reads FORMA-028 now charges.
  { name: 'S1 === on two equal 200,000-char strings x20,000', data: "({ a: 'c'.repeat(200000), b: 'c'.repeat(199999) + 'c' })", html: t('Array.from({length: 20000}).filter(() => v.a === v.b).length') },
  { name: 'S2 a million digits * 1, x1,000', data: "'1234567890'.repeat(100000)", html: t('Array.from({length: 1000}).map(() => v * 1).length') },
  { name: 'S3 charCodeAt over a 1M flat string, step cap', data: "'abcdefghij'.repeat(100000)", html: t('Array.from({length: 16000}).map((_, i) => v.charCodeAt(i)).length') },
  { name: 'S4 (512-char + y).charCodeAt, step cap', data: "'q'.repeat(512)", html: t("Array.from({length: 16000}).map(() => (v + 'y').charCodeAt(0)).length") },
  { name: 'S5 (2,048-char + y).charCodeAt to the cap', data: "'q'.repeat(2048)", html: t("Array.from({length: 16000}).map(() => (v + 'y').charCodeAt(0)).length") },
  { name: 'S7 (511-char + y) === (… + z), step cap', data: "'q'.repeat(511)", html: t("Array.from({length: 10000}).filter(() => (v + 'y') === (v + 'z')).length") },
  { name: 'S8 map to 511-char ropes, then read each', data: "'q'.repeat(511)", html: t("Array.from({length: 14000}).map(() => v + 'y').map(s => s.charCodeAt(0)).length") },
  { name: 'S9 === of two fresh 511-char ropes, step cap', data: "'q'.repeat(511)", html: t("Array.from({length: 12400}).filter(() => (v + 'y') === (v + 'z')).length") },
  { name: 'S10 slice of fresh ropes compared, 9,000', data: "'q'.repeat(255)", html: t("Array.from({length: 9000}).filter(() => (v + 'y').slice(1) === (v + 'z').slice(1)).length") },
  { name: 'S6 reduce building 1,150 names', data: "Array.from({length: 1150}, (_, i) => ('row-' + i).padEnd(20, '.'))", html: t("v.reduce((s, r) => s + r + ', ', '').length") },
  // The natives FORMA-004 bounded, and its biggest admitted evaluations.
  { name: 'N1 Array.from({length: 12000000})', html: t('Array.from({length: 12000000}).length', false) },
  { name: 'N2 one binding at both caps', data: '({ pairs: Array.from({length: 49999}, (_, i) => [i, i]), ints: Array.from({length: 99999}, (_, i) => i) })', html: t('v.pairs.flat().length + (v.ints.some(x => x < 0) ? 1 : 0)') },
  { name: 'N3 one binding at the step cap', html: t(STEPS, false) },
  // Content-dependent costs no per-character price bounds (SECURITY.md).
  { name: "X1 'ab' in 'aaaa…' (1M), x8", data: "'a'.repeat(1000000)", html: t("Array.from({length: 8}).filter(() => v.includes('ab')).length") },
  { name: 'X2 lowercase 1M two-byte aB, x8', data: "'aB'.repeat(500000)", html: t("[('Ā' + v).slice(1)].map(s => Array.from({length: 8}).map(() => s.toLowerCase().length).length)[0]") },
  { name: 'X3 lowercase 1M all-caps Greek, x4', data: "'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΤΥΦΧΨΩ '.repeat(40000)", html: t('Array.from({length: 4}).map(() => v.toLowerCase().length).length') },
  { name: 'X4 lowercase α + 1M İ, x4', data: "'α' + 'İ'.repeat(999999)", html: t('Array.from({length: 4}).map(() => v.toLowerCase().length).length') },
  { name: 'X5 lowercase α + 1M Cherokee, x4', data: "'α' + 'ᏣᎳᎩ'.repeat(333333)", html: t('Array.from({length: 4}).map(() => v.toLowerCase().length).length') },
  // The ordinary search at 9,000 records, the largest ordinary evaluation.
  { name: 'O1 search 9,000 ASCII', data: `${words('alpha beta gamma delta epsilon zeta theta iota kappa lambda mu nu xi omicron pi rho ', 'needle', 9000)}`, html: t(SEARCH('needle')) },
  { name: 'O2 search 9,000 punctuation', data: `${words('the fox’s jump — over the dog… €12 ™ said “quote” and ‘single’ ', 'needle', 9000)}`, html: t(SEARCH('needle')) },
  { name: 'O3 search 9,000 Greek', data: `${words('Η γρήγορη καφέ αλεπού πηδά πάνω από τον τεμπέλη σκύλο Σοφία Αθήνα ', 'βελόνα', 9000)}`, html: t(SEARCH('βελόνα')) },
  { name: 'O4 search 9,000 Cyrillic', data: `${words('Съешь же ещё этих мягких французских булок да выпей чаю Москва ', 'иголка', 9000)}`, html: t(SEARCH('иголка')) },
  { name: 'O5 search 9,000 CJK', data: `${words('敏捷的棕色狐狸跳过了懒狗東京都の天気は晴れです今日は良い天気ですね', '针头', 9000)}`, html: t(SEARCH('针头')) },
  { name: 'O6 search 9,000 Latin Extended', data: `${words('Příliš žluťoučký kůň úpěl ďábelské ódy Zażółć gęślą jaźń Őrült ő İzmir ', 'jehła', 9000)}`, html: t(SEARCH('jehła')) },
];

const TIME_TASKS = `(() => {
  const real = window.setTimeout.bind(window);
  window.__tasks = [];
  window.__pending = 0;
  window.setTimeout = (fn, ms, ...rest) => { window.__pending++; return real(() => { window.__pending--; const s = performance.now(); try { fn(...rest); } finally { window.__tasks.push(performance.now() - s); } }, ms); };
})();`;

const stats = (t) => {
  const s = [...t].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { p50: q(0.5), p99: q(0.99), max: s[s.length - 1] };
};

console.log(`${cpus()[0].model}, ${cpus().length} cores, load average ${loadavg().map((l) => l.toFixed(1)).join(' ')}`);
for (const runtime of RUNTIMES) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><html><body></body></html>');
  await page.addScriptTag({ content: TIME_TASKS });
  await page.addScriptTag({ content: readFileSync(runtime, 'utf8') });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
  console.log(`\n${runtime}\nChromium ${await browser.version()}, CPU throttling ${RATE}x, ${RUNS} runs; the worst task of each run: p50 / p99 / max ms`);
  for (const c of CASES) {
    if (ONLY.length && !ONLY.some((o) => c.name.startsWith(o))) continue;
    const worst = [];
    let last;
    for (let r = 0; r < RUNS; r++) {
      // The data is built in a task of its own, outside the timed ones.
      await page.evaluate(({ c }) => { window.__v = c.data ? new Function('return ' + c.data)() : undefined; }, { c });
      last = await page.evaluate(async ({ c }) => {
        window.FormaRuntime.clearDiagnostics();
        window.__tasks = [];
        const root = document.createElement('div');
        root.setAttribute('data-forma-state', JSON.stringify({ v: null, ...(c.state ?? {}) }));
        root.innerHTML = c.html;
        document.body.append(root);
        const tasks = [];
        let s = performance.now();
        window.FormaRuntime.mount(root);
        tasks.push(performance.now() - s);
        const settle = async () => { for (let i = 0; i < 2000 && window.__pending > 0; i++) await new Promise((res) => requestAnimationFrame(res)); };
        if (c.data) {
          await settle();
          s = performance.now();
          window.FormaRuntime.setScopeValue(root, 'v', window.__v);
          tasks.push(performance.now() - s);
        }
        if (c.click) {
          await settle();
          s = performance.now();
          root.querySelector(c.click).click();
          tasks.push(performance.now() - s);
        }
        await settle();
        tasks.push(...window.__tasks);
        const texts = [...root.querySelectorAll('[data-out]')].map((e) => { const t = e.textContent; return t.length > 30 ? `${t.slice(0, 12)}…(${t.length})` : t; });
        const diags = window.FormaRuntime.getDiagnostics().map((d) => `${d.code}x${d.count}`);
        window.FormaRuntime.unmount(root);
        root.remove();
        window.__v = undefined;
        return { tasks, texts, diags };
      }, { c });
      worst.push(Math.max(...last.tasks));
    }
    const st = stats(worst);
    const over = worst.filter((w) => w >= 50).length;
    console.log(`  ${c.name.padEnd(48)} ${st.p50.toFixed(1).padStart(6)} ${st.p99.toFixed(1).padStart(6)} ${st.max.toFixed(1).padStart(6)}  >=50ms ${String(over).padStart(2)}/${RUNS}  tasks ${String(last.tasks.length).padStart(2)}  ${last.diags.join(',') || '-'}  ${JSON.stringify(last.texts).slice(0, 60)}`);
  }
  await browser.close();
}
