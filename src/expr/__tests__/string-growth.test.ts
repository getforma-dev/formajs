/**
 * FORMA-028: what an expression does to strings, charged before the long task.
 *
 * FORMA-004's preflight charged every native call, but not the operators that
 * build and read strings. Joining is cheap because the engine keeps the pieces
 * as a rope, and the first read of a fresh rope copies all of it, so a short
 * expression with no state could build a 524,288-character rope in 19 steps
 * and then read a copy of it thousands of times (formajs#14, review
 * 5513640827): 1.1 to 4.3 s at 4x CPU throttling through the runtime. The same
 * holds for comparing long strings and for parsing one as a number.
 *
 * How soon a refusal comes is counted here, not timed (FORMA-177). A refused
 * loop must stop before a tenth of its course: before a tenth of the
 * interpreter steps the same expression takes over short strings, which
 * nothing charges, and which is the whole loop 2.0.3 ran over long ones. Steps
 * are read from a meter the evaluation counts on, so the bound holds on a
 * loaded machine and under coverage alike, where a wall clock measured the
 * runner too: FORMA-028's 200 ms ceiling here saw 52 ms once on Node 20. The
 * refusals measured 0.25% to 4.1% of their loops. The milliseconds belong to a
 * browser:
 * - the four round-2 cases are asserted under 50 ms, unthrottled, in all
 *   three engines by e2e/expr-cost.spec.ts ("each round-2 rope case is
 *   refused before the long task"), and measured at 4x by
 *   scripts/measure-task-budget.mjs (R2: at most 27 ms p99);
 * - the comparison and parsing cases have no browser assertion: only that
 *   script measures them (S1 and S2: at most 15 ms p99 at 4x).
 */
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../ast';
import { compileExpression, compileHandler, evaluateExpression, isExprError, runHandler, type Meter } from '../index';
import { scopeOf } from './helpers';

interface Outcome {
  code: string;
  message: string;
  value: unknown;
  /** Interpreter steps the evaluation spent, to its answer or its refusal. */
  steps: number;
}

function attempt(src: string, state: Record<string, unknown> = {}): Outcome {
  const compiled = compileExpression(src);
  // A fresh meter adds nothing to the evaluation's budgets (it counts on from
  // zero, with no cap); it only keeps what the evaluation spent.
  const meter: Meter = { steps: 0, cost: 0 };
  try {
    const value = evaluateExpression(compiled, scopeOf(state), meter);
    return { code: 'answered', message: '', value, steps: meter.steps };
  } catch (e) {
    if (!isExprError(e)) throw e;
    return { code: e.code, message: e.message, value: undefined, steps: meter.steps };
  }
}

/**
 * Why `refused` came too late, or null: it must be a refusal that stopped
 * before a tenth of the steps `whole`, the same expression answered over short
 * strings, took.
 */
function late(src: string, refused: Outcome, whole: Outcome): string | null {
  if (whole.code !== 'answered') return `${src}: over short strings ${whole.code}, not answered`;
  if (refused.steps * 10 >= whole.steps) return `${src}: refused after ${refused.steps} of ${whole.steps} steps`;
  return null;
}

/** A rope of 2^k characters, built inside the expression as the review built it. */
const rope = (k: number): string => `Array.from({length: ${k}}).reduce((a) => a + a, 'x')`;

/** The four round-2 cases, each reading copies of the rope thousands of times. */
const ROUND_2 = (k: number): Record<string, string> => ({
  charCodeAt: `[${rope(k)}].map(big => Array.from({length: 15000}).map(() => (big + 'y').charCodeAt(0)).length)[0]`,
  index: `[${rope(k)}].map(big => Array.from({length: 15000}).map(() => (big + 'y')[0]).length)[0]`,
  equality: `[${rope(k)}].map(big => Array.from({length: 12000}).filter(() => big + 'y' === big + 'z').length)[0]`,
  sort: `[${rope(k)}].map(big => Array.from({length: 2000}).map((_, i) => big + i).sort().length)[0]`,
});

describe('strings an expression builds and reads (FORMA-028)', () => {
  it('every round-2 rope case is refused before the long task', () => {
    // 2.0.3 answered each of these after 0.6 to 4.3 s at 4x throttling.
    const problems: string[] = [];
    for (const [name, src] of Object.entries(ROUND_2(19))) {
      const o = attempt(src);
      if (o.code !== 'FORMA_E_BUDGET') problems.push(`${name}: ${o.code}, not FORMA_E_BUDGET`);
      else if (!/allocation budget/.test(o.message)) problems.push(`${name}: refused by "${o.message}", not the allocation budget`);
      // The same loop over a 2-character "rope": nothing is charged.
      const tooLate = late(name, o, attempt(ROUND_2(1)[name]!));
      if (tooLate) problems.push(tooLate);
    }
    expect(problems).toEqual([]);
    // The rope itself is answered: 524,288 characters cost about 8,200 units.
    expect(attempt(`${rope(19)}.length`)).toMatchObject({ code: 'answered', value: 524_288 });
    // Two-sided: shorter loops over a 128-character rope are answered.
    const small = (src: string): string => src.replace(/length: (15000|12000|2000)/, 'length: 4000');
    const loops = ROUND_2(7);
    expect(attempt(small(loops.charCodeAt!))).toMatchObject({ code: 'answered', value: 4000 });
    expect(attempt(small(loops.index!))).toMatchObject({ code: 'answered', value: 4000 });
    expect(attempt(small(loops.equality!))).toMatchObject({ code: 'answered', value: 0 });
    expect(attempt(small(loops.sort!))).toMatchObject({ code: 'answered', value: 4000 });
  });

  it('a template literal and += are charged by the length they produce', () => {
    const big = 'b'.repeat(500_000);
    // Each template copies `big` into a fresh string: 3,900 units apiece.
    const template = attempt('Array.from({length: 100}).map(() => `${big}!`.charCodeAt(1)).length', { big });
    expect(template.code).toBe('FORMA_E_BUDGET');
    expect(attempt('Array.from({length: 50}).map(() => `${big}!`.charCodeAt(1)).length', { big }))
      .toMatchObject({ code: 'answered', value: 50 });
    // A handler's `+=` builds the same way, and keeps the 1 MiB result cap of `+`.
    const scope = scopeOf({ log: 'x'.repeat(600_000), big, n: 0 });
    const run = (src: string): string => {
      try {
        runHandler(compileHandler(src), scope);
        return 'answered';
      } catch (e) {
        if (!isExprError(e)) throw e;
        return e.code;
      }
    };
    expect(run('log += big')).toBe('FORMA_E_BUDGET');
    expect(scope.state['log']).toHaveLength(600_000);
    expect(run("log += 'tail'; n = log.length")).toBe('answered');
    expect(scope.state['n']).toBe(600_004);
    // Under the cap, `+=` is charged what it builds: 800,000 characters are
    // 6,250 units, which a handler that has spent 247,010 cannot afford.
    const half = scopeOf({ log: 'x'.repeat(300_000), big, n: 0 });
    const spendThenGrow = compileHandler('n = Array.from({length: 247000}).length; log += big');
    expect(() => runHandler(spendThenGrow, half)).toThrow(/allocation budget/);
    expect(half.state['log']).toHaveLength(300_000);
    runHandler(compileHandler('n = Array.from({length: 240000}).length; log += big'), half);
    expect(half.state['log']).toHaveLength(800_000);
    // Ordinary text building is answered: a label per row, and a reduce over
    // 1,000 rows of 20 characters (about 22,000 characters built in steps).
    const rows = Array.from({ length: 1000 }, (_, i) => ({ name: `row-${i}`.padEnd(20, '.') }));
    expect(attempt('rows.map(r => `${r.name} (${r.name.length})`).length', { rows }))
      .toMatchObject({ code: 'answered', value: 1000 });
    expect(attempt("rows.reduce((s, r) => s + r.name + ', ', '').length", { rows }))
      .toMatchObject({ code: 'answered', value: 22_000 });
    // Building that way is quadratic in what it charges: past about 1,200 rows
    // it is refused, where `map` and `join` answer the same string at 9,000.
    const more = Array.from({ length: 1500 }, (_, i) => ({ name: `row-${i}`.padEnd(20, '.') }));
    expect(attempt("rows.reduce((s, r) => s + r.name + ', ', '').length", { rows: more }).code).toBe('FORMA_E_BUDGET');
    const many = Array.from({ length: 9000 }, (_, i) => ({ name: `row-${i}`.padEnd(20, '.') }));
    expect(attempt("rows.map(r => r.name).join(', ').length", { rows: many }))
      .toMatchObject({ code: 'answered', value: 9000 * 22 - 2 });
  });

  it('comparing long strings is charged by the characters compared', () => {
    // Two distinct strings with the same 200,000 characters: `===` reads both
    // whole, so twenty thousand comparisons read four billion characters.
    const a = 'c'.repeat(199_999) + 'z';
    const b = 'c'.repeat(199_999) + 'z';
    const c = 'c'.repeat(200_001);
    const st = { a, b, c, list: Array.from({ length: 10 }, () => 'c'.repeat(199_999) + 'y'), short: 'abc' };
    const shortSt = { a: 'cz', b: 'cz', list: Array.from({ length: 10 }, () => 'cy') };
    const refused = [
      'Array.from({length: 20000}).filter(() => a === b).length',
      'Array.from({length: 20000}).filter(() => a == b).length',
      'Array.from({length: 20000}).filter(() => a < b).length',
      // An array search compares each element of the same length whole.
      'Array.from({length: 2000}).filter(() => list.includes(b)).length',
      'Array.from({length: 2000}).filter(() => list.indexOf(b) >= 0).length',
    ];
    for (const src of refused) {
      const o = attempt(src, st);
      expect(o.code, src).toBe('FORMA_E_BUDGET');
      expect(late(src, o, attempt(src, shortSt))).toBeNull();
    }
    // A default sort compares elements as text: each one is read at every
    // level. It is refused in its own preflight, after the map has built its
    // input, so the steps before it are all the map's: the sort never runs.
    const sorted = attempt('Array.from({length: 2000}).map(() => a).sort().length', st);
    expect(sorted.code).toBe('FORMA_E_BUDGET');
    expect(sorted.message).toMatch(/allocation budget/);
    // Two-sided: strings of different lengths are unequal without being read,
    // short strings cost nothing, and a few long comparisons are answered.
    expect(attempt('Array.from({length: 20000}).filter(() => a === c).length', st))
      .toMatchObject({ code: 'answered', value: 0 });
    expect(attempt("Array.from({length: 20000}).filter(() => short === 'abc').length", st))
      .toMatchObject({ code: 'answered', value: 20_000 });
    expect(attempt('[a === b, a < b, list.includes(b), [b, a].sort()[0] === a]', st))
      .toMatchObject({ code: 'answered', value: [true, false, false, true] });
  });

  it('an operator that parses a long string as a number is charged for it', () => {
    // Parsing digits measured 11 ns a character at 4x: a thousand conversions
    // of a million digits is eleven seconds, and no native was called.
    const digits = '1234567890'.repeat(100_000);
    const st = { digits, n: 13, price: '12.50' };
    for (const src of [
      'Array.from({length: 1000}).map(() => digits * 1).length',
      'Array.from({length: 1000}).map(() => -digits).length',
      'Array.from({length: 1000}).filter(() => digits < 1).length',
      'Array.from({length: 1000}).filter(() => digits == 1).length',
    ]) {
      const o = attempt(src, st);
      expect(o.code, src).toBe('FORMA_E_BUDGET');
      expect(late(src, o, attempt(src, { ...st, digits: '12' }))).toBeNull();
    }
    // Two-sided: `===` converts nothing, and a short numeric string is free.
    expect(attempt('Array.from({length: 1000}).filter(() => digits === 1).length', st))
      .toMatchObject({ code: 'answered', value: 0 });
    expect(attempt('price * 2 + -price + (price < n ? 1 : 0)', st))
      .toMatchObject({ code: 'answered', value: 13.5 });
  });

  it('a string method reads a string argument for a thirty-second of a unit a character', () => {
    // FORMA-004 charged every argument its text weight, so `s.includes(q)`
    // paid q's length in full on every call. A string method reads a string
    // argument as it is; it converts only the others.
    const q = 'q'.repeat(64_000);
    const s = 'x'.repeat(1000);
    // 8 calls cost 8 x (64,000 / 32 + 1,000 / 32): answered; 2.0.3 refused the fourth.
    expect(attempt('Array.from({length: 8}).filter(() => s.includes(q)).length', { s, q }))
      .toMatchObject({ code: 'answered', value: 0 });
    // But it is not free: two hundred calls read 12.8 million characters of q.
    expect(attempt('Array.from({length: 200}).filter(() => s.includes(q)).length', { s, q }).code).toBe('FORMA_E_BUDGET');
    // Two-sided: a global native still converts its argument, so it pays in full.
    expect(attempt('Array.from({length: 8}).map(() => Number(q)).length', { q }).code).toBe('FORMA_E_BUDGET');
    // And a non-string argument to a string method is still weighed as text.
    const big = Array.from({ length: 1000 }, () => 'z'.repeat(300));
    expect(attempt('s.includes(big)', { s, big }).code).toBe('FORMA_E_BUDGET');
  });

  it('comparing or reading a string just built is charged for copying it', () => {
    // A rope copies itself whole on its first comparison or character read:
    // half a microsecond plus 1 to 3 ns a character at 4x. Under 512
    // characters `+` charges nothing, so 12,400 comparisons of two fresh
    // 511-character strings ran 56 ms within the step budget. The copy is now
    // charged where it happens: 8 units plus a 32nd a character, to 512.
    const v = 'q'.repeat(511);
    for (const src of [
      "Array.from({length: 12400}).filter(() => (v + 'y') === (v + 'z')).length",
      "Array.from({length: 12400}).filter(() => `${v}y` < `${v}z`).length",
      "Array.from({length: 16500}).map(() => (v + 'y').charCodeAt(0)).length",
      "Array.from({length: 16500}).map(() => (v + 'y')[3]).length",
    ]) {
      const o = attempt(src, { v });
      expect(o.code, src).toBe('FORMA_E_BUDGET');
      // Without the copy charge each is answered inside both budgets.
      expect(o.message, src).toMatch(/allocation budget/);
    }
    // Two-sided: a string that comes from state, or from a variable, is not
    // copied by the read (it is flat, or `+` paid for it), and neither is a
    // short one: comparing ids and reading characters are answered.
    const ids = Array.from({ length: 9000 }, (_, i) => `id-${String(i).padStart(33, '0')}`);
    expect(attempt('ids.filter(id => id === sel).length', { ids, sel: ids[17] }))
      .toMatchObject({ code: 'answered', value: 1 });
    expect(attempt("Array.from({length: 12400}).filter(() => v === w).length", { v, w: `${v}` }))
      .toMatchObject({ code: 'answered', value: 12_400 });
    expect(attempt("Array.from({length: 12000}).filter(() => ('ab' + 'c') === 'abc').length", {}))
      .toMatchObject({ code: 'answered', value: 12_000 });
  });

  it('character reads in a loop are bounded by the step budget', () => {
    // `at`, `charAt`, `charCodeAt` and `s[i]` read one character of a flat
    // string; on a rope the first read copies it, which `+` has paid for. So a
    // loop of reads costs steps, and the step budget bounds it.
    // (Timed in the browser at 4x by scripts/measure-alloc-budget.mjs: a loop
    // of reads at the step budget is a task of about 16 ms there.)
    const s = 'abcdefghij'.repeat(100_000);
    for (const read of ['s.charCodeAt(i)', 's.at(i)', 's.charAt(i)', 's[i]']) {
      const fits = attempt(`Array.from({length: 15000}).map((_, i) => ${read}).length`, { s });
      expect(fits, read).toMatchObject({ code: 'answered', value: 15_000 });
      const over = attempt(`Array.from({length: 40000}).map((_, i) => ${read}).length`, { s });
      expect(over.code, read).toBe('FORMA_E_BUDGET');
      expect(over.message, read).toMatch(/step budget/);
    }
    expect(LIMITS.STEP_BUDGET).toBe(100_000);
  });
});
