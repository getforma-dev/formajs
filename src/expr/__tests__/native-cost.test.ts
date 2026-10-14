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
import {
  ARRAY_METHODS,
  HOF_CALLBACK_PARAMS,
  NUMBER_METHODS,
  SAFE_GLOBALS,
  STRING_METHODS,
} from '../allowlist';
import { COSTS, DATA_ARGS, weigh } from '../cost';
import { compileExpression, compileHandler, evaluateExpression, isExprError, runHandler } from '../index';
import { hostObject } from '../host';
import { scopeOf } from './helpers';

const BUDGET = LIMITS.ALLOC_BUDGET;
// The wrappers below run while the intrinsics are replaced, so the code they
// call must not reach a wrapped intrinsic: Array.isArray is taken here, and
// they loop by index rather than with Array.prototype.some.
const isArrayOriginal = Array.isArray;
const LONG_TASK_MS = 50;
const HEAP_CEILING = 16 * 1024 * 1024;

// ── Fixtures ──

/** 1,000 references to one 300,000-character string: 300 million characters as text, a few KB in memory. */
const LONG = 'x'.repeat(300_000);
const BIG = Array.from({ length: 1000 }, () => LONG);
/** Receivers whose size alone is over the budget. */
const BIG_ARR = Array.from({ length: 500_000 }, (_, i) => i);
const BIG_STR = 'y'.repeat(500_000);
/** Over the budget only through the cost row's multiplier or second term. */
const MID_STR = 'z'.repeat(250_000);
const KEYS_STR = 'k'.repeat(60_000);
const SHORT = 'q'.repeat(1000);
const SORTABLE = Array.from({ length: 30_000 }, (_, i) => (i * 7919) % 30_000);
const INNER = Array.from({ length: 1000 }, (_, i) => i);
const NESTED = Array.from({ length: 1000 }, () => INNER);
/** Scans are charged a sixteenth per element, so these are over 16x the budget. */
const HUGE_ARR = new Array<number>(7_000_000);
const HUGE_STR = 's'.repeat(7_000_000);
const WIDE = Array.from({ length: 300_000 }, () => 0);

const HOSTILE_OBJECTS = new WeakSet<object>([BIG, BIG_ARR, SORTABLE, NESTED, HUGE_ARR, WIDE]);
const HOSTILE_STRINGS = new Set<string>([LONG, BIG_STR, MID_STR, KEYS_STR, SHORT, HUGE_STR]);

/** The benign probes the control uses. */
const PROBE_ARR = [3, 1, 2];
const PROBE_STR = 'probe';
const PROBE_NUM = 4242.5;

function isHostile(v: unknown): boolean {
  if (typeof v === 'string') return HOSTILE_STRINGS.has(v);
  if (typeof v !== 'object' || v === null) return false;
  if (HOSTILE_OBJECTS.has(v)) return true;
  // An array-like built inside the expression, `{length: 12000000}`.
  const length = (v as { length?: unknown }).length;
  return !isArrayOriginal(v) && typeof length === 'number' && length > BUDGET;
}

function isProbe(v: unknown): boolean {
  return v === PROBE_ARR || v === PROBE_STR || v === PROBE_NUM;
}

function state(): Record<string, unknown> {
  return {
    items: PROBE_ARR, s: PROBE_STR, n: PROBE_NUM,
    big: BIG, bigArr: BIG_ARR, bigStr: BIG_STR, midStr: MID_STR, keysStr: KEYS_STR,
    short: SHORT, sortable: SORTABLE, nested: NESTED, hugeArr: HUGE_ARR, hugeStr: HUGE_STR, wide: WIDE,
  };
}

// ── Every callable the allowlist grants ──

interface Callable {
  name: string;
  owner: object;
  key: string;
  /** The call, with `arg` as its data argument (after a callback, for the higher-order methods). */
  call: (arg: string) => string;
}

function callback(method: string): string {
  if (method === 'sort') return '(a, b) => a - b';
  if (method === 'reduce') return '(a, x) => a';
  return 'x => x';
}

function callables(): Callable[] {
  const out: Callable[] = [];
  for (const m of Object.keys(ARRAY_METHODS)) {
    const hof = Object.hasOwn(HOF_CALLBACK_PARAMS, m);
    out.push({
      name: `array.${m}`, owner: Array.prototype, key: m,
      call: (arg) => (hof ? `items.${m}(${callback(m)}${arg ? `, ${arg}` : ''})` : `items.${m}(${arg})`),
    });
  }
  for (const m of Object.keys(STRING_METHODS)) {
    out.push({ name: `string.${m}`, owner: String.prototype, key: m, call: (arg) => `s.${m}(${arg})` });
  }
  for (const m of Object.keys(NUMBER_METHODS)) {
    out.push({ name: `number.${m}`, owner: Number.prototype, key: m, call: (arg) => `n.${m}(${arg})` });
  }
  for (const [g, host] of Object.entries(SAFE_GLOBALS)) {
    const owner = Reflect.get(globalThis, g) as object;
    if (host.kind === 'fn') out.push({ name: g, owner: globalThis, key: g, call: (arg) => `${g}(${arg})` });
    for (const [m, v] of Object.entries(host.members ?? {})) {
      if (typeof v !== 'function') continue;
      out.push({ name: `${g}.${m}`, owner, key: m, call: (arg) => `${g}.${m}(${arg})` });
    }
  }
  return out;
}

const CALLABLES = callables();

// ── A fresh engine that captured call-through wrappers ──

const hostileHits = new Map<string, number>();
const probeHits = new Set<string>();
let engine: typeof import('../index');

function intercept(c: Callable): () => void {
  const original = Reflect.get(c.owner, c.key) as (...a: unknown[]) => unknown;
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
  Reflect.set(c.owner, c.key, wrapper);
  return () => Reflect.set(c.owner, c.key, original);
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
    // build 300 MB; weighing it stops after the first element.
    const problems: string[] = [];
    for (const c of CALLABLES) {
      if (DATA_ARGS.has(c.name)) continue;
      problems.push(...shortfalls(c.name, c.call('big')));
    }
    expect(problems).toEqual([]);
  });

  /** One hostile size per cost row: a receiver, a count or a length over the budget. */
  const SIZE_CASES: Record<string, string> = {
    'array.concat': 'bigArr.concat()',
    'array.filter': 'bigArr.filter(x => x)',
    'array.flat': 'nested.flat()',
    'array.flatMap': 'bigArr.flatMap(x => x)',
    'array.includes': 'hugeArr.includes(1)',
    'array.indexOf': 'hugeArr.indexOf(1)',
    'array.join': 'bigArr.join()',
    'array.lastIndexOf': 'hugeArr.lastIndexOf(1)',
    'array.map': 'bigArr.map(x => x)',
    'array.reverse': 'bigArr.reverse()',
    'array.slice': 'bigArr.slice()',
    'array.sort': 'sortable.sort()',
    'string.concat': 'bigStr.concat()',
    'string.endsWith': "hugeStr.endsWith('s')",
    'string.includes': "hugeStr.includes('t')",
    'string.indexOf': "hugeStr.indexOf('t')",
    'string.lastIndexOf': "hugeStr.lastIndexOf('t')",
    'string.padEnd': 'short.padEnd(12000000)',
    'string.padStart': 'short.padStart(12000000)',
    'string.repeat': 'short.repeat(10000)',
    'string.replace': "bigStr.replace('y', 'z')",
    'string.replaceAll': "midStr.replaceAll('', '-')",
    'string.slice': 'hugeStr.slice(0, 1)',
    'string.split': "bigStr.split('')",
    'string.startsWith': "hugeStr.startsWith('s')",
    'string.substring': 'hugeStr.substring(0, 1)',
    'string.toLowerCase': 'bigStr.toLowerCase()',
    'string.toUpperCase': 'bigStr.toUpperCase()',
    'string.trim': 'hugeStr.trim()',
    'string.trimEnd': 'hugeStr.trimEnd()',
    'string.trimStart': 'hugeStr.trimStart()',
    'Array.from': 'Array.from({length: 12000000})',
    'Object.entries': 'Object.entries(keysStr)',
    'Object.keys': 'Object.keys(keysStr)',
    'Object.values': 'Object.values(keysStr)',
  };

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
    // Two-sided: a native that converts its argument is charged per row. Two
    // rows of one 300,000-character string: the second passes the budget.
    let code: unknown;
    try {
      evaluateExpression(compileExpression('rows.map(String)'), scopeOf({ rows: [[LONG], [LONG]] }));
    } catch (e) {
      code = isExprError(e) ? e.code : e;
    }
    expect(code).toBe('FORMA_E_BUDGET');
    // And each data-argument native answers on `big` at once.
    for (const name of DATA_ARGS) {
      const o = attempt(`${name}(big)`);
      expect(o.code, name).toBe('answered');
      expect(o.value, name).toBe(name === 'Boolean' || name === 'Array.isArray');
      expect(o.ms, name).toBeLessThan(LONG_TASK_MS);
    }
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
    // returns a 300,000-element array each time. The second would take the
    // evaluation past the budget, so it is refused before flatMap copies it.
    expect(outcome('items.flatMap(x => wide).length', { items: [1, 2, 3], wide: WIDE })).toBe('FORMA_E_BUDGET');
    expect(outcome('items.flatMap(x => [x, x])', { items: [1, 2, 3] })).toEqual({ value: [1, 1, 2, 2, 3, 3] });
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
