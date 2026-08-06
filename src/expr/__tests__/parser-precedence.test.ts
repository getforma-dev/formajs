/**
 * Precedence, associativity and total consumption.
 *
 * The two headline cases are regressions the regex cascade shipped, and both
 * are the reason P0 had to land before any grammar addition: every extension
 * would have inherited them.
 */
import { describe, expect, it } from 'vitest';
import { compileExpression, evaluateExpression, isExprError } from '../index';
import type { ScopeLike } from '../interp';

function scopeOf(state: Record<string, unknown>): ScopeLike {
  const getters: Record<string, () => unknown> = Object.create(null);
  const setters: Record<string, (v: unknown) => void> = Object.create(null);
  for (const [k, v] of Object.entries(state)) {
    let current = v;
    getters[k] = () => current;
    setters[k] = (next) => { current = next; };
  }
  return { getters, setters };
}

function run(src: string, state: Record<string, unknown> = {}): unknown {
  return evaluateExpression(compileExpression(src), scopeOf(state));
}

function err(src: string, state: Record<string, unknown> = {}) {
  try {
    run(src, state);
  } catch (e) {
    if (isExprError(e)) return e;
    throw e;
  }
  throw new Error(`expected ${src} to be rejected`);
}

describe('operator precedence', () => {
  it('unary ! binds tighter than || (the HEAD bug)', () => {
    // The regex cascade tested `expr.startsWith('!')` before every binary
    // operator, so this parsed as `!(a || b)` and returned `false`. Silently.
    expect(run('!a || b', { a: 1, b: 2 })).toBe(2);
    expect(run('!darkMode && count', { darkMode: 1, count: 2 })).toBe(false);
    expect(run('!a && b', { a: 0, b: 5 })).toBe(5);
    // …and the shape that DID work before still does.
    expect(run('!(a && b)', { a: 1, b: 0 })).toBe(true);
  });

  it('unary ! binds tighter than comparison and arithmetic', () => {
    expect(run('!a === false', { a: 1 })).toBe(true);
    expect(run('-a + b', { a: 2, b: 5 })).toBe(3);
    expect(run('-a * b', { a: 2, b: 5 })).toBe(-10);
  });

  it('a ternary branch may contain a string with a colon or a slash', () => {
    // `RE_TERNARY` was string-blind: the `//` in a URL literal killed the match
    // and the whole data-bind:href was rejected.
    expect(run("ok ? 'https://a' : 'https://b'", { ok: true })).toBe('https://a');
    expect(run("ok ? 'https://a' : 'https://b'", { ok: false })).toBe('https://b');
    expect(run("ok ? 'a:b' : 'c:d'", { ok: true })).toBe('a:b');
  });

  it('ternaries nest in either branch', () => {
    const state = { a: 1, b: 2 };
    expect(run("a === 1 ? (b === 2 ? 'x' : 'y') : 'z'", state)).toBe('x');
    expect(run("a === 1 ? b === 2 ? 'x' : 'y' : 'z'", state)).toBe('x');
    expect(run("a === 9 ? 'z' : b === 2 ? 'x' : 'y'", state)).toBe('x');
  });

  it('arithmetic is left-associative with the usual tiers', () => {
    expect(run('1 + 2 * 3 - 4')).toBe(3);
    expect(run('10 - 2 - 3')).toBe(5);
    expect(run('10 / 2 / 5')).toBe(1);
    expect(run('7 % 4 + 1')).toBe(4);
    expect(run('(1 + 2) * 3')).toBe(9);
  });

  it('&& binds tighter than ||', () => {
    expect(run('a || b && c', { a: 0, b: 1, c: 0 })).toBe(0);
    expect(run('a && b || c', { a: 0, b: 1, c: 7 })).toBe(7);
  });

  it('comparison binds tighter than && and looser than +', () => {
    expect(run('a + b > c', { a: 3, b: 2, c: 4 })).toBe(true);
    expect(run('a > b && c < d', { a: 5, b: 3, c: 1, d: 2 })).toBe(true);
    expect(run('a + b === c', { a: 2, b: 3, c: 5 })).toBe(true);
  });

  it('refuses to guess when ?? is mixed with || or &&', () => {
    // JavaScript makes this a SyntaxError; guessing an answer would mean the
    // same source means different things in the two engines.
    expect(err('a ?? b || c', { a: null, b: 0, c: 1 }).code).toBe('FORMA_E_SYNTAX');
    expect(err('a || b ?? c', { a: null, b: 0, c: 1 }).code).toBe('FORMA_E_SYNTAX');
    expect(run('(a || b) ?? c', { a: null, b: 0, c: 1 })).toBe(0);
    expect(run('a ?? (b || c)', { a: null, b: 0, c: 1 })).toBe(1);
  });

  it('short-circuits rather than evaluating both sides', () => {
    // `missing` is undeclared, so evaluating it would throw. It must not be
    // reached.
    expect(run('ok || missing', { ok: 'yes' })).toBe('yes');
    expect(run('no && missing', { no: 0 })).toBe(0);
    expect(run('here ?? missing', { here: 'v' })).toBe('v');
    expect(err('no || missing', { no: 0 }).code).toBe('FORMA_E_UNRESOLVED');
  });
});

describe('total consumption', () => {
  it('leftover tokens are an error, never a silent partial parse', () => {
    // The cascade's "no branch matched → return null" shape is what let an
    // expression nobody understood fall through to `new Function`.
    for (const src of ['a b', '1 2', 'a + b c', 'a)', 'a,b']) {
      expect(err(src, { a: 1, b: 2 }).code, src).toBe('FORMA_E_SYNTAX');
    }
  });

  it('reports a column for the offending token', () => {
    const e = err('a + * b', { a: 1, b: 2 });
    expect(e.column).toBe(4);
    expect(e.message).toMatch(/unexpected "\*"/);
  });

  it('an empty expression is an error, not an empty string', () => {
    expect(err('   ').code).toBe('FORMA_E_SYNTAX');
  });
});
