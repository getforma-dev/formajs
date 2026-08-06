/**
 * Semantics of the interpreter — including the flagship README expression,
 * verbatim.
 */
import { describe, expect, it } from 'vitest';
import { compileExpression, compileHandler, evaluateExpression, isExprError, runHandler } from '../index';
import { run, scopeOf } from './helpers';

function err(src: string, state: Record<string, unknown> = {}) {
  try {
    run(src, state);
  } catch (e) {
    if (isExprError(e)) return e;
    throw e;
  }
  throw new Error(`expected ${src} to be rejected`);
}

describe('literals and identifiers', () => {
  it('evaluates literals', () => {
    expect(run('1.5')).toBe(1.5);
    expect(run("'hi'")).toBe('hi');
    expect(run('true')).toBe(true);
    expect(run('null')).toBeNull();
    expect(run('undefined')).toBeUndefined();
  });

  it('resolves declared state', () => {
    expect(run('name', { name: 'Ada' })).toBe('Ada');
  });

  it('an undeclared identifier is an error, not undefined', () => {
    // The single most important failure-semantics rule: `undefined` is a value,
    // so it can never also mean "this did not work".
    const e = err('nope');
    expect(e.code).toBe('FORMA_E_UNRESOLVED');
    expect(e.message).toMatch(/not declared in this scope/);
  });

  it('a declared key holding undefined is a VALUE, not a failure', () => {
    expect(run('maybe', { maybe: undefined })).toBeUndefined();
    expect(run("maybe ?? 'fallback'", { maybe: undefined })).toBe('fallback');
  });
});

describe('member access', () => {
  const state = {
    user: { name: 'Ada', address: { city: 'Paris' } },
    items: ['a', 'b', 'c'],
    empty: null,
    key: 'name',
  };

  it('reads own data properties at any depth', () => {
    expect(run('user.name', state)).toBe('Ada');
    expect(run('user.address.city', state)).toBe('Paris');
    expect(run("user['name']", state)).toBe('Ada');
    expect(run('user[key]', state)).toBe('Ada');
    expect(run('items[0]', state)).toBe('a');
    expect(run('items[1 + 1]', state)).toBe('c');
    expect(run('items.length', state)).toBe(3);
    expect(run("'abc'.length", state)).toBe(3);
    expect(run("'abc'[1]", state)).toBe('b');
  });

  it('chains computed access, which the old bracket regex could not', () => {
    const s = { obj: { list: [{ name: 'x' }] } };
    expect(run('obj.list[0].name', s)).toBe('x');
    expect(run("obj['list'][0]['name']", s)).toBe('x');
    expect(run('obj?.list?.[0]?.name', s)).toBe('x');
  });

  it('treats a nullish base as absent data, not as a failure', () => {
    // `data-fetch` targets are null until the response lands, so this has to
    // read as "not here yet" rather than tearing the binding down.
    expect(run('empty.anything', state)).toBeUndefined();
    expect(run('empty?.anything', state)).toBeUndefined();
    expect(run("empty?.anything ?? 'none'", state)).toBe('none');
  });

  it('an absent own key reads undefined; a denied one reports', () => {
    expect(run('user.missing', state)).toBeUndefined();
    expect(err('user.constructor', state).code).toBe('FORMA_E_KEY_DENIED');
  });
});

describe('methods', () => {
  it('calls allowlisted array and string methods', () => {
    expect(run("' hi '.trim().toUpperCase()")).toBe('HI');
    expect(run("['a','b'].join('-')")).toBe('a-b');
    expect(run('[1,2].concat(3).length')).toBe(3);
    expect(run("'a,b'.split(',').length")).toBe(2);
    expect(run('(1.234).toFixed(1)')).toBe('1.2');
  });

  it('runs the flagship README expression verbatim', () => {
    const state = {
      items: ['Apples', 'Bananas', 'Cherries', 'Dates', 'Elderberries'],
      query: 'an',
    };
    const src = 'items.filter(i => i.toLowerCase().includes(query.toLowerCase()))';
    expect(run(src, state)).toEqual(['Bananas']);
    expect(run(`${src}.length`, state)).toBe(1);
    expect(run(src, { ...state, query: '' })).toHaveLength(5);
  });

  it('supports the other higher-order forms', () => {
    const state = { nums: [3, 1, 2] };
    expect(run('nums.map(n => n * 2)', state)).toEqual([6, 2, 4]);
    expect(run('nums.some(n => n > 2)', state)).toBe(true);
    expect(run('nums.every(n => n > 0)', state)).toBe(true);
    expect(run('nums.find(n => n > 1)', state)).toBe(3);
    expect(run('nums.findIndex(n => n === 2)', state)).toBe(2);
    expect(run('nums.reduce((a, n) => a + n, 0)', state)).toBe(6);
    expect(run('nums.sort((a, b) => a - b)', state)).toEqual([1, 2, 3]);
    expect(run('nums.flatMap(n => [n, n])', state)).toEqual([3, 3, 1, 1, 2, 2]);
  });

  it('accepts an allowlisted built-in as a callback', () => {
    // `items.filter(Boolean)` used to parse and then throw a raw TypeError out
    // of the reactive effect.
    expect(run("[0, 'a', '', 'b'].filter(Boolean)")).toEqual(['a', 'b']);
    expect(run("['1', '2'].map(Number)")).toEqual([1, 2]);
  });

  it('sort and reverse do not mutate the source array', () => {
    const scope = scopeOf({ nums: [3, 1, 2] });
    evaluateExpression(compileExpression('nums.sort((a, b) => a - b)'), scope);
    evaluateExpression(compileExpression('nums.reverse()'), scope);
    expect(scope.state.nums).toEqual([3, 1, 2]);
  });

  it('closes over the enclosing scope inside a callback', () => {
    expect(run('nums.filter(n => n > min)', { nums: [1, 5, 9], min: 4 })).toEqual([5, 9]);
  });

  it('reports an unknown method instead of returning undefined', () => {
    const e = err('items.push(1)', { items: [] });
    expect(e.code).toBe('FORMA_E_METHOD_DENIED');
    expect(e.message).toMatch(/no method "push"/);
  });

  it('does not offer mutating array methods at all', () => {
    for (const m of ['push', 'pop', 'shift', 'unshift', 'splice', 'fill', 'copyWithin']) {
      expect(err(`items.${m}(1)`, { items: [1] }).code, m).toBe('FORMA_E_METHOD_DENIED');
    }
  });
});

describe('globals', () => {
  it('resolves the frozen namespace table', () => {
    expect(run('Math.round(1.6)')).toBe(2);
    expect(run('Math.max(1, 5)')).toBe(5);
    expect(run('Math.PI > 3')).toBe(true);
    expect(run('JSON.stringify(o)', { o: { a: 1 } })).toBe('{"a":1}');
    expect(run('Object.keys(o)', { o: { a: 1, b: 2 } })).toEqual(['a', 'b']);
    expect(run('Array.isArray(o)', { o: [] })).toBe(true);
    expect(run("Number('4')")).toBe(4);
    expect(run("parseInt('42px', 10)")).toBe(42);
    expect(run('Number.isInteger(n)', { n: 3 })).toBe(true);
    expect(run('Date.now() > 0')).toBe(true);
  });

  it('state shadows a namespace name', () => {
    expect(run('Math', { Math: 'mine' })).toBe('mine');
  });

  it('a namespace function is not a value', () => {
    expect(err('Math.floor').code).toBe('FORMA_E_PROPERTY_DENIED');
  });
});

describe('literals with structure', () => {
  it('builds array and object literals', () => {
    expect(run('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(run('[]')).toEqual([]);
    expect(run('{ a: 1, b: n }', { n: 2 })).toEqual({ a: 1, b: 2 });
    expect(run('{ id }', { id: 7 })).toEqual({ id: 7 });
    expect(run("{ 'a-b': 1 }")).toEqual({ 'a-b': 1 });
  });

  it('interpolates template literals, including nested ones', () => {
    expect(run('`Hello ${name}`', { name: 'Ada' })).toBe('Hello Ada');
    expect(run('`${a} in ${b.city}`', { a: 'Ada', b: { city: 'Paris' } })).toBe('Ada in Paris');
    expect(run('`Total: $${n * 2}`', { n: 6.25 })).toBe('Total: $12.5');
    expect(run('`a${`b${c}`}d`', { c: 'X' })).toBe('abXd');
  });

  it('renders a nullish interpolation as empty, matching the previous engine', () => {
    expect(run('`x${v}y`', { v: null })).toBe('xy');
  });
});

describe('unary', () => {
  it('supports typeof and numeric negation on any expression', () => {
    expect(run('typeof n', { n: 1 })).toBe('number');
    expect(run("typeof s", { s: 'x' })).toBe('string');
    expect(run('-count', { count: 5 })).toBe(-5);
    expect(run("+n", { n: '5' })).toBe(5);
  });
});

describe('caching', () => {
  it('a rejected expression throws the same error every time it is compiled', () => {
    const first = err('items.push(1)', { items: [] });
    const second = err('items.push(1)', { items: [] });
    expect(second.code).toBe(first.code);
    // A compile failure is cached too, so a 1,000-row list reports once and
    // parses once rather than once per row.
    let a: unknown;
    let b: unknown;
    try { compileExpression('a b'); } catch (e) { a = e; }
    try { compileExpression('a b'); } catch (e) { b = e; }
    expect(a).toBe(b);
  });
});

describe('handler statements', () => {
  function handle(src: string, state: Record<string, unknown>): Record<string, unknown> {
    const scope = scopeOf(state);
    runHandler(compileHandler(src), scope);
    return scope.state;
  }

  it('assigns, updates and compounds', () => {
    expect(handle('n++', { n: 1 }).n).toBe(2);
    expect(handle('--n', { n: 1 }).n).toBe(0);
    expect(handle('n = 5', { n: 1 }).n).toBe(5);
    expect(handle('flag = !flag', { flag: false }).flag).toBe(true);
    expect(handle('n *= 3', { n: 5 }).n).toBe(15);
    expect(handle('n = 1; flag = true', { n: 0, flag: false })).toEqual({ n: 1, flag: true });
  });

  it('writes through member and computed paths', () => {
    const state = handle('item.done = !item.done', { item: { done: false } });
    expect(state.item).toEqual({ done: true });
    expect(handle('obj.n += 1', { obj: { n: 1 } }).obj).toEqual({ n: 2 });
    expect(handle('obj[k] = 9', { obj: { a: 1 }, k: 'a' }).obj).toEqual({ a: 9 });
    expect(handle('item.count++', { item: { count: 1 } }).item).toEqual({ count: 2 });
  });

  it('runs if/else with block or bare bodies', () => {
    expect(handle("if (k === 'Enter') { out = 'yes' } else { out = 'no' }", { k: 'Enter', out: '' }).out).toBe('yes');
    expect(handle("if (k === 'Enter') { out = 'yes' } else { out = 'no' }", { k: 'a', out: '' }).out).toBe('no');
    expect(handle('if (ok) a = 1; else a = 2', { ok: false, a: 0 }).a).toBe(2);
  });

  it('an unknown assignment target reports instead of silently doing nothing', () => {
    // The previous handler compiler ran `scope.setters[name]?.(val)`, so a typo
    // in a state key was a no-op with no diagnostic at all.
    const scope = scopeOf({ n: 1 });
    try {
      runHandler(compileHandler('nope = 1'), scope);
      throw new Error('expected a denial');
    } catch (e) {
      expect(isExprError(e)).toBe(true);
      expect((e as { code: string }).code).toBe('FORMA_E_ASSIGN_DENIED');
    }
  });
});
