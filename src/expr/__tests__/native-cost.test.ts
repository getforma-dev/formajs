/**
 * DR-16, native by native: every allowlisted native is charged its cost from
 * its receiver and arguments BEFORE it runs, against one allocation budget per
 * evaluation (`LIMITS.ALLOC_BUDGET`, cost.ts).
 *
 * Before this, an allowlisted native ran first and only its RESULT was
 * measured, so `Array.from({length: 12000000})` built a 139 MB array in a
 * 300 ms task (audit verification, run 4) before `FORMA_E_BUDGET`.
 *
 * "Before it runs" is observed, not inferred. The allowlist captures each
 * intrinsic when its module is evaluated, so this file wraps every allowlisted
 * intrinsic in a call-through Proxy, loads a fresh expression engine (which
 * captures the wrappers), and puts the originals back. A wrapper records a
 * call only when its receiver or an argument is one of the hostile fixtures
 * below (or a benign probe, for the control). Nothing is faked: every wrapper
 * calls the real intrinsic.
 *
 * Each hostile case must be refused with `FORMA_E_BUDGET`, with the native
 * never reached, the heap not grown by more than a few MB, and no 50 ms task.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../ast';
import { COSTS, DATA_ARGS, weigh } from '../cost';
import { compileExpression, compileHandler, evaluateExpression, isExprError, runHandler } from '../index';
import { hostObject } from '../host';
import { scopeOf } from './helpers';
import { callables, DATA_CASES, hostileFixtures, ownerOf, SIZE_CASES, type Callable } from './hostile-natives';

const BUDGET = LIMITS.ALLOC_BUDGET;
// The wrappers below run while the intrinsics are replaced, so the code they
// call must not reach a wrapped intrinsic: Array.isArray is taken here, and
// they loop by index rather than with Array.prototype.some.
const isArrayOriginal = Array.isArray;
const LONG_TASK_MS = 50;
const HEAP_CEILING = 16 * 1024 * 1024;

// ── Fixtures (shared with e2e/sr33.spec.ts) ──

const FIXTURES = hostileFixtures();
const BIG = FIXTURES.state['big'] as string[];
const LONG = BIG[0]!;
const WIDE = FIXTURES.state['wide'] as number[];

const HOSTILE_OBJECTS = new WeakSet<object>(FIXTURES.objects);
const HOSTILE_STRINGS = new Set<string>(FIXTURES.strings);

/** The benign probes the control uses. */
const PROBE_ARR = [3, 1, 2];
const PROBE_STR = 'probe';
const PROBE_NUM = 4242.5;

function isHostile(v: unknown): boolean {
  if (typeof v === 'string') return HOSTILE_STRINGS.has(v);
  if (typeof v !== 'object' || v === null) return false;
  if (HOSTILE_OBJECTS.has(v)) return true;
  // An array-like built inside the expression, `{length: 12000000}` or
  // `{length: big}`.
  const length = (v as { length?: unknown }).length;
  if (isArrayOriginal(v)) return false;
  return (typeof length === 'number' && length > BUDGET) || (typeof length === 'object' && length !== null && HOSTILE_OBJECTS.has(length));
}

function isProbe(v: unknown): boolean {
  return v === PROBE_ARR || v === PROBE_STR || v === PROBE_NUM;
}

function state(): Record<string, unknown> {
  return { items: PROBE_ARR, s: PROBE_STR, n: PROBE_NUM, ...FIXTURES.state };
}

// ── Every callable the allowlist grants ──

const CALLABLES: Callable[] = callables();

// ── A fresh engine that captured call-through wrappers ──

const hostileHits = new Map<string, number>();
const probeHits = new Set<string>();
let engine: typeof import('../index');

function intercept(c: Callable): () => void {
  const owner = ownerOf(globalThis, c.owner);
  const original = Reflect.get(owner, c.key) as (...a: unknown[]) => unknown;
  const wrapper = new Proxy(original, {
    apply(target, self, args: unknown[]) {
      let hostile = isHostile(self);
      let probe = isProbe(self);
      for (let i = 0; i < args.length; i++) {
        hostile ||= isHostile(args[i]);
        probe ||= isProbe(args[i]);
      }
      if (hostile) hostileHits.set(c.name, (hostileHits.get(c.name) ?? 0) + 1);
      if (probe) probeHits.add(c.name);
      return Reflect.apply(target, self, args);
    },
  });
  Reflect.set(owner, c.key, wrapper);
  return () => Reflect.set(owner, c.key, original);
}

beforeAll(async () => {
  const restore = CALLABLES.map(intercept);
  try {
    vi.resetModules();
    engine = await import('../index');
  } finally {
    for (const r of restore.reverse()) r();
    vi.resetModules();
  }
});

interface Outcome {
  code: unknown;
  value: unknown;
  ms: number;
  grew: number;
}

/** Evaluate `src` in the wrapped engine, timing it and weighing the heap around it. */
function attempt(src: string): Outcome {
  const scope = scopeOf(state());
  const compiled = engine.compileExpression(src);
  const heap = process.memoryUsage().heapUsed;
  const start = performance.now();
  let code: unknown = 'answered';
  let value: unknown;
  try {
    value = engine.evaluateExpression(compiled, scope);
  } catch (e) {
    code = engine.isExprError(e) ? e.code : e;
  }
  const ms = performance.now() - start;
  return { code, value, ms, grew: process.memoryUsage().heapUsed - heap };
}

/** Every way a hostile case can fall short, as readable lines. */
function shortfalls(name: string, src: string): string[] {
  hostileHits.clear();
  const o = attempt(src);
  const problems: string[] = [];
  if (o.code !== 'FORMA_E_BUDGET') problems.push(`${src} → ${String(o.code)}, not FORMA_E_BUDGET`);
  if (hostileHits.get(name)) problems.push(`${src} → ${name} ran on the hostile value before the refusal`);
  if (o.ms >= LONG_TASK_MS) problems.push(`${src} → a ${o.ms.toFixed(1)} ms task`);
  if (o.grew > HEAP_CEILING) problems.push(`${src} → the heap grew ${(o.grew / 1e6).toFixed(1)} MB`);
  return problems;
}

describe('the cost preflight, native by native (DR-16)', () => {
  it('the wrappers see every allowlisted native (control)', () => {
    // Without this, "the native never ran" could mean "the wrapper was never
    // installed". Every native receives a probe as its receiver or argument.
    // The probe array also rides along as an argument, because `sort` and
    // `reverse` run on a copy of their receiver. A count must be a number to
    // get past the existing argument guards.
    probeHits.clear();
    const counts = new Set(['array.flat', 'string.padEnd', 'string.padStart', 'string.repeat']);
    for (const c of CALLABLES) {
      const arg = counts.has(c.name) ? '2' : 'items';
      try {
        engine.evaluateExpression(engine.compileExpression(c.call(arg)), scopeOf(state()));
      } catch {
        // JSON.parse('3,1,2') throws after the native ran; the control only
        // needs the call to have reached it.
      }
    }
    expect(CALLABLES.map((c) => c.name).filter((n) => !probeHits.has(n))).toEqual([]);
    expect(CALLABLES.length).toBeGreaterThan(60);
  });

  it('every allowlisted native refuses an argument heavier than the budget before it runs', () => {
    // `big` is 1,000 references to one 300,000-character string. Converting it
    // to text, which nearly every native does with an array argument, would
    // build 300 MB; weighing it stops after the first element. The natives
    // that read arguments as data are covered by their own test below.
    const problems: string[] = [];
    for (const c of CALLABLES) {
      if (DATA_ARGS.has(c.name)) continue;
      problems.push(...shortfalls(c.name, c.call('big')));
    }
    expect(problems).toEqual([]);
  });

  it('every size-driven cost refuses a hostile size before the native runs', () => {
    // Completeness first: a row without a hostile case is a cost nobody tests.
    expect(Object.keys(SIZE_CASES).sort()).toEqual(Object.keys(COSTS).sort());
    const problems: string[] = [];
    for (const [name, src] of Object.entries(SIZE_CASES)) problems.push(...shortfalls(name, src));
    expect(problems).toEqual([]);
  });

  it('every cost row and data-argument exemption names an allowlisted native', () => {
    const names = new Set(CALLABLES.map((c) => c.name));
    expect(Object.keys(COSTS).filter((k) => !names.has(k))).toEqual([]);
    expect([...DATA_ARGS].filter((k) => !names.has(k))).toEqual([]);
  });

  it('a predicate native reads a large argument for free', () => {
    // `rows.filter(Boolean)` applies the predicate to every row; charging each
    // row as text would refuse it. Two thousand rows of 300 characters weigh
    // 600,000 units as text.
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i, body: 'b'.repeat(300) }));
    expect(evaluateExpression(compileExpression('rows.filter(Boolean).length'), scopeOf({ rows }))).toBe(2000);
    // Two-sided: a native that converts its argument is charged per row. A row
    // holding one 300,000-character string passes the budget.
    let code: unknown;
    try {
      evaluateExpression(compileExpression('rows.map(String)'), scopeOf({ rows: [[LONG], [LONG]] }));
    } catch (e) {
      code = isExprError(e) ? e.code : e;
    }
    expect(code).toBe('FORMA_E_BUDGET');
    // And each predicate (a data-argument native with no cost row) answers on
    // `big` at once.
    const predicates = [...DATA_ARGS].filter((name) => !Object.hasOwn(COSTS, name));
    expect(predicates.sort()).toEqual(['Array.isArray', 'Boolean', 'Number.isFinite', 'Number.isInteger', 'Number.isNaN']);
    for (const name of predicates) {
      const o = attempt(`${name}(big)`);
      expect(o.code, name).toBe('answered');
      expect(o.value, name).toBe(name === 'Boolean' || name === 'Array.isArray');
      expect(o.ms, name).toBeLessThan(LONG_TASK_MS);
    }
  });

  it('a native that reads its argument as data is charged its element count, not its text', () => {
    // Refused: arguments with more elements or keys than the budget, a
    // `fromIndex` that converts through join, and an array-like whose `length`
    // would. Completeness first: every data-argument native with a row.
    expect(Object.keys(DATA_CASES).sort())
      .toEqual([...DATA_ARGS].filter((name) => Object.hasOwn(COSTS, name)).sort());
    const problems: string[] = [];
    for (const [name, src] of Object.entries(DATA_CASES)) problems.push(...shortfalls(name, src));
    problems.push(...shortfalls('Array.from', 'Array.from({length: big})'));
    problems.push(...shortfalls('Object.keys', 'Object.keys(bigObj)'));
    expect(problems).toEqual([]);
    // Answered (2.0.1 answered them; the text weight of these rows is over the
    // budget, their element count is not): 6,000 records of about 100 characters.
    const rows = Array.from({ length: 6000 }, (_, i) => ({
      id: i, name: `Item ${i}`, price: 12.5 + i, tags: ['new', 'sale'], note: 'lorem ipsum dolor sit amet',
    }));
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(weigh(rows, Infinity)).toBeGreaterThan(BUDGET);
    const cases: Array<[string, unknown]> = [
      ['Object.keys(byId).length', 6000],
      ['Object.values(byId).length', 6000],
      ['Object.entries(byId).length', 6000],
      ['Array.from(rows).length', 6000],
      ['rows.concat(rows).length', 12000],
      ['rows.indexOf(rows[5])', 5],
      ['rows.includes(rows[5])', true],
      ['rows.lastIndexOf(rows[5])', 5],
    ];
    for (const [src, value] of cases) expect(outcome(src, { rows, byId }), src).toEqual({ value });
  });

  it('loose equality charges only an operand it converts', () => {
    // `==` and `!=` convert an object only against a primitive other than null
    // or undefined. These convert nothing, and 2.0.1 answered them.
    const rows = Array.from({ length: 4000 }, (_, i) => ({ id: i, name: `Row ${i}`, note: 'x'.repeat(100) }));
    const data = { items: rows, total: rows.length };
    const tree = rows.map((r, i) => ({ id: i, parent: i ? rows[i - 1] : null }));
    expect(weigh(data, Infinity)).toBeGreaterThan(BUDGET);
    const st = { data, rows, tree, sel: rows[7] };
    expect(outcome('data != null', st)).toEqual({ value: true });
    expect(outcome('data == undefined ? 0 : data.total', st)).toEqual({ value: 4000 });
    expect(outcome('data == data', st)).toEqual({ value: true });
    expect(outcome('rows.filter(r => r != sel).length', st)).toEqual({ value: 3999 });
    expect(outcome('tree.filter(n => n.parent != null).length', st)).toEqual({ value: 3999 });
    // Two-sided: against a primitive, the object is converted, so it is charged.
    expect(outcome("data == 'x'", st)).toBe('FORMA_E_BUDGET');
    expect(outcome('1 != data', st)).toBe('FORMA_E_BUDGET');
  });

  it('a text search over records is answered as on main', () => {
    // Review R1: lowercasing ASCII costs about 1 ns a character, not a slot,
    // so a client-side search over 9,000 records of 260 characters is answered,
    // as on main, where the step budget is what limits it (about 9,060).
    const words = 'alpha beta gamma delta epsilon zeta theta iota kappa lambda mu nu xi omicron pi rho';
    const rows = Array.from({ length: 14_000 }, (_, i) => ({
      title: `Record ${i} ${words}`.slice(0, 60).padEnd(60, '.'),
      body: (`${i % 10 === 0 ? 'Needle ' : ''}${words} `.repeat(4)).slice(0, 200),
    }));
    const st = { rows: rows.slice(0, 9000), q: 'needle' };
    const expected = st.rows.filter((r) => (r.title + ' ' + r.body).toLowerCase().includes('needle')).length;
    expect(expected).toBe(900);
    expect(outcome("rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q)).length", st))
      .toEqual({ value: 900 });
    // A per-record field at the size main answers (about 14,257 records).
    expect(outcome('rows.filter(r => r.title.toLowerCase().includes(q)).length', { rows, q: 'record 1' }))
      .toEqual({ value: rows.filter((r) => r.title.toLowerCase().includes('record 1')).length });
    // Latin-1 text lowercases as cheaply as ASCII.
    const latin = st.rows.map((r) => ({ title: r.title.replace(/a/g, 'à'), body: r.body.replace(/e/g, 'é') }));
    expect(outcome("rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q)).length", { rows: latin, q: 'néédlé' }))
      .toEqual({ value: 900 });
    // Review R4-1: one curly apostrophe, dash, `€`, `™` or `…` in each record
    // (ordinary English from an editor) is charged as Latin-1, not as wide text.
    const search = "rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q)).length";
    const withOne = (ch: string) => st.rows.map((r) => ({ title: r.title, body: `${r.body.slice(0, 99)}${ch}${r.body.slice(100)}` }));
    for (const ch of ['’', '—', '€', '™', '…']) {
      expect(outcome(search, { rows: withOne(ch), q: 'needle' }), `one ${ch} per record`).toEqual({ value: 900 });
    }
    // Text with a character above Latin-1 in a script whose lowercasing
    // measured at most about 19 ns a character (Greek, Cyrillic, CJK, Latin
    // Extended) is charged 1/16 and answered as 2.0.1 answered it (FORMA-028;
    // the full corpus is ordinary-search.test.ts).
    const greek = st.rows.map((r) => ({ title: r.title, body: r.body.replace(/a/g, 'α') }));
    expect(outcome(search, { rows: greek, q: 'needle' })).toEqual({ value: 900 });
    expect(outcome(search, { rows: withOne('’α'), q: 'needle' })).toEqual({ value: 900 });
    // Two-sided: a first character outside those scripts keeps the record at
    // 1/2, so the same search is refused: a case-mapped letterlike symbol (the
    // Ohm sign U+2126, the Kelvin sign U+212A) or Georgian.
    expect(outcome(search, { rows: withOne('\u2126'), q: 'needle' })).toBe('FORMA_E_BUDGET');
    expect(outcome(search, { rows: withOne('\u212a'), q: 'needle' })).toBe('FORMA_E_BUDGET');
    expect(outcome(search, { rows: withOne('ქ'), q: 'needle' })).toBe('FORMA_E_BUDGET');
  });

  it('case mapping is charged by the costliest character of its receiver', () => {
    // The rows themselves, tier by tier. Lowercase: Latin-1 and the self-mapping
    // punctuation, currency signs and letterlike symbols (U+2000 to U+20CF,
    // U+2100 to U+2125) 1/32 a character; text whose first character above
    // those is in a script measured at most about 19 ns a character (FORMA-028)
    // 1/16; anything else 1/2. Uppercase: ASCII 1/16, Latin-1 and those
    // symbols 1/2, anything else 1.
    const lower = COSTS['string.toLowerCase']!;
    const upper = COSTS['string.toUpperCase']!;
    const text = (unit: string, n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    const N = 100_000;
    const cases: Array<[typeof lower, string, number]> = [
      [lower, 'a', N / 32], [lower, 'é', N / 32], [lower, 'it’s', N / 32], [lower, 'a—€™…', N / 32],
      [lower, 'Σ', N / 16], [lower, 'č', N / 16], [lower, 'Ж', N / 16], [lower, '東', N / 16], [lower, 'ạ', N / 16],
      [lower, 'aİ', N / 16], [lower, '😀', N / 16],
      [lower, 'a\u2126', N / 2], [lower, 'ქ', N / 2], [lower, 'Ꭰ', N / 2], [lower, 'Ａ', N / 2], [lower, 'ἀ', N / 2],
      [upper, 'a', N / 16], [upper, 'é', N / 2], [upper, 'it’s', N / 2], [upper, 'Σ', N], [upper, 'č', N],
    ];
    const wrong = cases
      .map(([row, unit, units]) => [row === lower ? 'toLowerCase' : 'toUpperCase', unit, units, row(text(unit, N), [], Infinity)] as const)
      .filter(([, , units, got]) => got !== units)
      .map(([name, unit, units, got]) => `${name} of ${N} x ${unit}: ${got}, not ${units}`);
    expect(wrong).toEqual([]);
    // Case mapping never shortens a string, so a receiver past the 1 MiB
    // result cap is refused before the call: 2.0.3 lowercased 8 million
    // two-byte characters (115 ms at 4x) and only then refused the result.
    const refusedBefore = (src: string, s: string): string => {
      try {
        evaluateExpression(compileExpression(src), scopeOf({ s }));
        return 'answered';
      } catch (e) {
        expect(isExprError(e), String(e)).toBe(true);
        return /allocation budget/.test((e as Error).message) ? 'before' : 'after';
      }
    };
    const max = LIMITS.MAX_STRING_LENGTH;
    for (const method of ['toLowerCase', 'toUpperCase']) {
      expect(refusedBefore(`s.${method}().length`, text('a', max)), method).toBe('answered');
      expect(refusedBefore(`s.${method}().length`, text('a', max + 1)), method).toBe('before');
      // The same, stored two bytes a character (a slice of text that held one).
      expect(refusedBefore(`s.${method}().length`, `Ā${text('a', max + 1)}`.slice(1)), method).toBe('before');
    }
  });

  it('a $ in a replacement is charged only for what it can insert', () => {
    // `$`, `$$` and `$&` insert at most the replacement or the match; only
    // `` $` `` and `$'` can insert up to the whole receiver.
    const desc = 'Price 10 USD, shipping 5 USD. '.repeat(24);
    const cases: Array<[string, unknown]> = [
      ["desc.replaceAll('USD', '$')", desc.replaceAll('USD', '$')],
      ["desc.replaceAll('USD', '$$')", desc.replaceAll('USD', '$$')],
      ["desc.replaceAll('USD', '[$&]')", desc.replaceAll('USD', '[$&]')],
      ["desc.replace('USD', '$1')", desc.replace('USD', '$1')],
    ];
    for (const [src, value] of cases) expect(outcome(src, { desc }), src).toEqual({ value });
    // Two-sided: the forms that insert the receiver are charged for it, so on
    // a 1,000-character string at every position they pass the budget.
    const s = 'a'.repeat(1000);
    expect(outcome("s.replaceAll('', '$`')", { s })).toBe('FORMA_E_BUDGET');
    expect(outcome("s.replaceAll('a', \"$'\")", { s })).toBe('FORMA_E_BUDGET');
    expect(outcome("s.replace('a', \"$'\").length", { s })).toEqual({ value: 1998 });
  });
});

/** Run `src` through the ordinary (unwrapped) engine; the code it is refused with, or its value. */
function outcome(src: string, st: Record<string, unknown> = {}): unknown {
  try {
    return { value: evaluateExpression(compileExpression(src), scopeOf(st)) };
  } catch (e) {
    return isExprError(e) ? e.code : e;
  }
}

describe('the allocation budget (DR-16)', () => {
  it('the budget is per evaluation and cumulative across its calls', () => {
    const half = Math.floor(BUDGET / 2) + 1;
    // Each call alone fits, in its own evaluation, as often as it is evaluated.
    expect(outcome(`Array.from({length: ${half}}).length`)).toEqual({ value: half });
    expect(outcome(`Array.from({length: ${half}}).length`)).toEqual({ value: half });
    // Two of them in one evaluation do not.
    expect(outcome(`Array.from({length: ${half}}).length + Array.from({length: ${half}}).length`))
      .toBe('FORMA_E_BUDGET');
    // The edge, exactly: the argument `{length: n}` weighs 10 units as text
    // (the key, 6, plus 1, plus 3 for the number).
    const arg = weigh({ length: 0 }, Infinity);
    expect(arg).toBe(10);
    expect(outcome(`Array.from({length: ${BUDGET - arg}}).length`)).toEqual({ value: BUDGET - arg });
    expect(outcome(`Array.from({length: ${BUDGET - arg + 1}}).length`)).toBe('FORMA_E_BUDGET');
  });

  it('flatMap charges each array its callback returns', () => {
    // The receiver has three elements, so the row charges three; the callback
    // returns a 150,000-element array each time. The second would take the
    // evaluation past the budget, so it is refused before flatMap copies it.
    expect(outcome('items.flatMap(x => wide).length', { items: [1, 2, 3], wide: WIDE })).toBe('FORMA_E_BUDGET');
    expect(outcome('items.flatMap(x => [x, x])', { items: [1, 2, 3] })).toEqual({ value: [1, 1, 2, 2, 3, 3] });
  });

  it('a handler cannot grow an array past the allocation budget', () => {
    // `items[4294967294] = 1` gave the array a length of 4,294,967,295, and
    // every/some/reduce skip holes without a callback, so no step was charged:
    // the scan ran for minutes. `items[999999] = 1` still handed `data-list` a
    // million-element array. A write may not grow an array past what one
    // evaluation may build.
    const B = LIMITS.ALLOC_BUDGET;
    const scope = scopeOf({ items: [1, 2, 3], n: 0, long: new Array(B + 50_000).fill(0) });
    const run = (src: string): unknown => {
      try {
        runHandler(compileHandler(src), scope);
        return 'answered';
      } catch (e) {
        return isExprError(e) ? e.code : e;
      }
    };
    expect(run('items[4294967294] = 1; n = items.every((x) => true)')).toBe('FORMA_E_BUDGET');
    expect(run('items[999999] = 1')).toBe('FORMA_E_BUDGET');
    expect(run(`items[${B}] = 1`)).toBe('FORMA_E_BUDGET');
    expect(scope.state['items']).toEqual([1, 2, 3]);
    expect(scope.state['n']).toBe(0);
    // Two-sided: an index below the budget is written, holes and all.
    expect(run('items[3] = 4; items[5] = 6; n = items.length')).toBe('answered');
    expect(scope.state['n']).toBe(6);
    expect(run('items[99999] = 7; n = items.some((x) => x === 7)')).toBe('answered');
    expect(scope.state['n']).toBe(true);
    expect(run(`items[${B - 1}] = 8; n = items.length`)).toBe('answered');
    expect(scope.state['n']).toBe(B);
    // A scan of those 250,000 indices costs the whole budget, so it is refused.
    expect(run('n = items.some((x) => x === 8)')).toBe('FORMA_E_BUDGET');
    // An array that is already longer may be written within its length, not past it.
    expect(run(`long[${B + 49_999}] = 9`)).toBe('answered');
    expect((scope.state['long'] as number[])[B + 49_999]).toBe(9);
    expect(run(`long[${B + 50_000}] = 9`)).toBe('FORMA_E_BUDGET');
    expect((scope.state['long'] as number[]).length).toBe(B + 50_000);
  });

  it('a DOM host method does not receive an argument heavier than the budget', () => {
    // A DOM method converts its arguments to strings; `setAttribute(name, big)`
    // would also convert it in the attribute guard before the DOM call.
    const original = Array.prototype.join;
    let joined = 0;
    Array.prototype.join = new Proxy(original, {
      apply(target, self, args: unknown[]) {
        if (self === BIG) joined++;
        return Reflect.apply(target, self, args);
      },
    });
    const el = document.createElement('div');
    const scope = scopeOf({ big: BIG });
    scope.getters['$el'] = () => hostObject('element', el, '$el');
    const run = (src: string): unknown => {
      try {
        runHandler(compileHandler(src), scope);
        return 'answered';
      } catch (e) {
        return isExprError(e) ? e.code : e;
      }
    };
    try {
      expect(run("$el.setAttribute('title', big)")).toBe('FORMA_E_BUDGET');
      expect(run('$el.classList.add(big)')).toBe('FORMA_E_BUDGET');
      expect(el.hasAttribute('title')).toBe(false);
      expect(el.className).toBe('');
      expect(joined, 'join ran on the hostile array').toBe(0);
      // Two-sided: an ordinary argument reaches the DOM.
      expect(run("$el.setAttribute('title', 'ok'); $el.classList.add('on')")).toBe('answered');
      expect(el.getAttribute('title')).toBe('ok');
      expect(el.className).toBe('on');
    } finally {
      Array.prototype.join = original;
    }
  });

  it('an operator does not convert a value heavier than the budget', () => {
    // `'' + list` and its kin convert through Array.prototype.join, which the
    // engine never captured, so the live one is what would run.
    const original = Array.prototype.join;
    let joined = 0;
    Array.prototype.join = new Proxy(original, {
      apply(target, self, args: unknown[]) {
        if (self === BIG) joined++;
        return Reflect.apply(target, self, args);
      },
    });
    const el = document.createElement('div');
    el.textContent = 'kept';
    const handlerScope = () => {
      const scope = scopeOf({ big: BIG, x: 1 });
      scope.getters['$el'] = () => hostObject('element', el, '$el');
      return scope;
    };
    const handler = (src: string): unknown => {
      try {
        runHandler(compileHandler(src), handlerScope());
        return 'answered';
      } catch (e) {
        return isExprError(e) ? e.code : e;
      }
    };
    try {
      for (const src of ["'' + big", "big + ''", '`${big}`', 'big < 1', '-big', '+big', "big == 'x'", 'rows.map(String)']) {
        expect(outcome(src, { big: BIG, rows: [BIG] }), src).toBe('FORMA_E_BUDGET');
      }
      expect(outcome('items[big]', { big: BIG, items: { a: 1 } })).toBe('FORMA_E_KEY_DENIED');
      expect(handler('x += big')).toBe('FORMA_E_BUDGET');
      expect(handler('$el.textContent = big')).toBe('FORMA_E_BUDGET');
      expect(el.textContent).toBe('kept');
      expect(joined, 'join ran on the hostile array').toBe(0);
      // Two-sided: strict equality converts nothing, and small arrays convert as before.
      expect(outcome('big === big', { big: BIG })).toEqual({ value: true });
      expect(outcome("'' + items + `|${items}`", { items: PROBE_ARR })).toEqual({ value: '3,1,2|3,1,2' });
      expect(handler('$el.textContent = 7')).toBe('answered');
      expect(el.textContent).toBe('7');
    } finally {
      Array.prototype.join = original;
    }
  });

  it('weighing stops at the budget on a cyclic or deeply nested value', () => {
    const cyclic: unknown[] = [1];
    cyclic.push(cyclic);
    expect(weigh(cyclic, 1000)).toBeGreaterThan(1000);
    expect(weigh(cyclic, 1000)).toBeLessThan(1010);
    // Ten thousand levels deep, each an array of one: one unit per level, and
    // no stack to overflow.
    let deep: unknown[] = [];
    for (let i = 0; i < 10_000; i++) deep = [deep];
    expect(weigh(deep, BUDGET)).toBe(10_000);
    // Counting slots for flat(1): the receiver's own slots and its children's.
    expect(weigh([[1, 2], [3], 4], BUDGET, 2)).toBe(6);
    expect(weigh([[1, 2], [3], 4], BUDGET, 1)).toBe(3);
  });

  it('ordinary calls under the budget are answered as before', () => {
    const page = 'p'.repeat(1_000_000);
    const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `row ${i}` }));
    const cases: Array<[string, unknown]> = [
      ['Array.from({length: 1000}).length', 1000],
      ["rows.map(r => r.name).join(', ').length", rows.map((r) => r.name).join(', ').length],
      ['JSON.stringify(rows).length', JSON.stringify(rows).length],
      ['Object.keys(rows[0])', ['id', 'name']],
      // A long server string: slicing and searching share or scan it.
      ['page.slice(0, 3)', 'ppp'],
      ["page.includes('q')", false],
      ["'a-b-c'.replaceAll('-', ' ')", 'a b c'],
      ["'ab'.repeat(3)", 'ababab'],
      ['[3, 1, 2].sort()', [1, 2, 3]],
      ['[[1, 2], [3]].flat()', [1, 2, 3]],
      ['Math.max(1, 2, 3)', 3],
    ];
    for (const [src, value] of cases) expect(outcome(src, { rows, page }), src).toEqual({ value });
  });
});
