/**
 * The attack suite.
 *
 * Every case here is an attack that WORKED against the engine this replaced, or
 * one the design claims is impossible by construction. They are written as
 * attempts, not as assertions about internals: each one compiles and evaluates a
 * hostile expression through the same two-call public API the runtime uses, and
 * requires a reported denial. `undefined` is never an acceptable answer — a
 * silent undefined is precisely how the broken CSP promise stayed invisible.
 *
 * Threat model (SECURITY.md §Threat model):
 *   T1 — the attacker controls the expression SOURCE. Any HTML-injection sink
 *        is also an expression sink, because the MutationObserver binds
 *        injected elements. This is the model the grammar must survive.
 *   T2 — the attacker controls VALUES: `data-fetch` JSON, `data-forma-state`,
 *        `localStorage` via `data-persist`.
 *   T3 — resource exhaustion from T2-sized data.
 *
 * Arrow-escape attacks (`x = i => i`, `[i => i]`, `{f: i => i}`,
 * `items[i => i]`, immediate invocation, block bodies, destructured params)
 * live in validate.test.ts, which drives them through the same public API.
 */
import { describe, expect, it } from 'vitest';
import {
  compileExpression,
  compileHandler,
  evaluateExpression,
  isExprError,
  runHandler,
  type FormaExprError,
} from '../index';
import { hostObject } from '../host';
import type { ScopeLike } from '../interp';
import { run, scopeOf } from './helpers';

/** Attempt `src`; fail the test unless the engine reported a denial. */
function denied(src: string, state: Record<string, unknown> = {}): FormaExprError {
  let result: unknown;
  try {
    result = run(src, state);
  } catch (e) {
    if (isExprError(e)) return e;
    throw e;
  }
  throw new Error(`ATTACK SUCCEEDED: ${src} evaluated to ${String(result)}`);
}

function deniedHandler(src: string, state: Record<string, unknown> = {}): FormaExprError {
  try {
    runHandler(compileHandler(src), scopeOf(state));
  } catch (e) {
    if (isExprError(e)) return e;
    throw e;
  }
  throw new Error(`ATTACK SUCCEEDED: handler ${src} ran`);
}

// ── Constructor and prototype reach ──

describe('constructor / prototype reach', () => {
  it('every spelling of a constructor reach is denied', () => {
    // The verified exploit against the previous engine ran
    //   items['constructor'] → Array → ['constructor'] → Function → .call(…)
    // and was invisible to the string scan that guarded it, BY CONSTRUCTION:
    // the blocked name never appears in the source. Checking the EVALUATED key
    // makes all of these the same case.
    const state = { items: [1, 2, 3], key: 'constructor', obj: { a: 1 } };
    const attempts = [
      'items.constructor',
      "items['constructor']",
      'items[key]',
      "items['cons' + 'tructor']",
      "items['xconstructorx'.slice(1, 12)]",
      "items[String.fromCharCode(99, 111, 110) + 'structor']",
      'obj.constructor',
      "obj['constructor']",
      'items.__proto__',
      "items['__proto__']",
      "obj['proto'.replace('proto', '__proto__')]",
      'Math.constructor',
      "'x'.constructor",
      'items.prototype',
      "items['prototype']",
    ];
    for (const src of attempts) {
      expect(denied(src, state).code, src).toBe('FORMA_E_KEY_DENIED');
    }
  });

  it('the classic Function-constructor chain does not get past its first step', () => {
    expect(denied("({}).constructor.constructor('return 1')()").code).toBe('FORMA_E_KEY_DENIED');
    expect(denied("items.map(i => i).constructor", { items: [1] }).code).toBe('FORMA_E_KEY_DENIED');
    // `Function` and `eval` are themselves denied keys, so even a receiver that
    // somehow held them could not surrender one.
    expect(denied("obj['Function']", { obj: {} }).code).toBe('FORMA_E_KEY_DENIED');
    expect(denied("obj['eval']", { obj: {} }).code).toBe('FORMA_E_KEY_DENIED');
  });

  it('an object literal cannot declare a prototype-polluting key', () => {
    for (const src of ["{ __proto__: 1 }", "{ 'constructor': 1 }", '{ prototype: 1 }']) {
      expect(denied(src).code, src).toBe('FORMA_E_KEY_DENIED');
    }
  });

  it('a handler cannot write through a prototype key', () => {
    try {
      expect(deniedHandler('obj.__proto__.polluted = true', { obj: {} }).code)
        .toBe('FORMA_E_KEY_DENIED');
      expect(deniedHandler("obj['__pro' + 'to__'].polluted = true", { obj: {} }).code)
        .toBe('FORMA_E_KEY_DENIED');
      expect(Object.prototype).not.toHaveProperty('polluted');
    } finally {
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
  });

  it('a __proto__ own property from parsed JSON is unreadable, not inherited', () => {
    // JSON.parse materialises "__proto__" as an OWN property rather than
    // touching Object.prototype — so the pollution is inert, but the value is
    // still attacker-controlled data sitting on the object (T2). safeKey means
    // no expression can name it.
    const poisoned = JSON.parse('{"__proto__": {"x": 1}, "safe": 2}') as Record<string, unknown>;
    expect(Object.hasOwn(poisoned, '__proto__')).toBe(true);
    expect(denied('o.__proto__', { o: poisoned }).code).toBe('FORMA_E_KEY_DENIED');
    expect(denied("o['__proto__']", { o: poisoned }).code).toBe('FORMA_E_KEY_DENIED');
    expect(run('o.safe', { o: poisoned })).toBe(2);
  });
});

// ── Globals ──

describe('global reach', () => {
  it('no global is reachable by name', () => {
    // Not "blocked" — unreachable. Identifier resolution consults arrow frames,
    // the scope's getters and one frozen table, then fails. There is no code
    // path that reads globalThis, so there is no list to keep up to date.
    const attempts = [
      'document.title',
      'window',
      'globalThis',
      "fetch('/x')",
      "localStorage.getItem('k')",
      'process',
      'top.location',
      'self.name',
      'console.log(1)',
      'require',
      'Function',
      'eval',
      'setTimeout',
      'XMLHttpRequest',
      'navigator.userAgent',
    ];
    for (const src of attempts) {
      const e = denied(src);
      expect(e.code, src).toBe('FORMA_E_UNRESOLVED');
      expect(e.message, src).toMatch(/cannot reach globals/);
    }
  });

  it('the frozen namespace tables expose only their listed members', () => {
    expect(denied('Math.__lookupGetter__').code).toBe('FORMA_E_KEY_DENIED');
    expect(denied('JSON.parse2').code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(denied('Object.assign(a, b)', { a: {}, b: {} }).code).toBe('FORMA_E_METHOD_DENIED');
    expect(denied('Object.defineProperty(a, b, c)', { a: {}, b: 'x', c: {} }).code)
      .toBe('FORMA_E_METHOD_DENIED');
    expect(denied('Object.getPrototypeOf(a)', { a: {} }).code).toBe('FORMA_E_METHOD_DENIED');
    expect(denied('Array.prototype', {}).code).toBe('FORMA_E_KEY_DENIED');
  });

  it('a global name is not resurrected by a state key that shadows it', () => {
    // `Math` shadowed by state must yield the state value, not merge the two.
    expect(run('Math', { Math: 'mine' })).toBe('mine');
    expect(denied('Math.floor(1.5)', { Math: 'mine' }).code).toBe('FORMA_E_METHOD_DENIED');
  });
});

// ── DOM escape ──

describe('DOM escape', () => {
  function elScope(): ScopeLike {
    const el = document.createElement('div');
    el.className = 'row';
    const input = document.createElement('input');
    el.appendChild(input);
    const refs = new Map<string, unknown>([['r', input]]);
    const event = new CustomEvent('click');
    Object.defineProperty(event, 'currentTarget', { value: el, configurable: true });
    return scopeOf({
      $el: hostObject('element', el, '$el'),
      $refs: hostObject('refs', refs, '$refs'),
      $event: hostObject('event', event, '$event'),
    });
  }

  function deniedOnHost(src: string): FormaExprError {
    let result: unknown;
    try {
      result = evaluateExpression(compileExpression(src), elScope());
    } catch (e) {
      if (isExprError(e)) return e;
      throw e;
    }
    throw new Error(`ATTACK SUCCEEDED: ${src} evaluated to ${String(result)}`);
  }

  it('$refs.r.ownerDocument.location.href is denied', () => {
    // Under the previous engine `$refs` handed back the RAW element, so this
    // read the real page URL under the hardened build with no diagnostic. A ref
    // is now an element host: the allowlist is the only way through.
    const e = deniedOnHost('$refs.r.ownerDocument.location.href');
    expect(e.code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(e.message).toMatch(/not on the element allowlist/);
    expect(deniedOnHost('$refs.r.ownerDocument').code).toBe('FORMA_E_PROPERTY_DENIED');
  });

  it('the $el properties the allowlist omits are refused, not answered', () => {
    // These three used to be asserted with `typeof … === 'undefined'`, which is
    // indistinguishable from "the property was absent". A denial is a fact.
    for (const src of ['$el.ownerDocument', '$el.parentNode', '$el.innerHTML', '$el.outerHTML']) {
      expect(deniedOnHost(src).code, src).toBe('FORMA_E_PROPERTY_DENIED');
    }
    // …and `typeof` does not launder it into a string, because the operand is
    // still evaluated.
    expect(deniedOnHost('typeof $el.ownerDocument').code).toBe('FORMA_E_PROPERTY_DENIED');
  });

  it('an element method outside the table cannot be called', () => {
    for (const src of ['$el.getRootNode()', "$el.insertAdjacentHTML('beforeend', '<img>')", '$el.remove()']) {
      expect(deniedOnHost(src).code, src).toBe('FORMA_E_METHOD_DENIED');
    }
  });

  it('$event exposes no path back to the window', () => {
    expect(deniedOnHost('$event.view').code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(deniedOnHost('$event.srcElement').code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(deniedOnHost('$event.path').code).toBe('FORMA_E_PROPERTY_DENIED');
    // `currentTarget` IS allowlisted — and yields another element host, which
    // is the point: the wrapper is preserved across every hop.
    expect(deniedOnHost('$event.currentTarget.ownerDocument').code).toBe('FORMA_E_PROPERTY_DENIED');
  });

  it('$el.style.cssText is denied', () => {
    // A whole-declaration string assignment is exactly the sink a strict
    // `style-src` blocks, and CSP.md promises FormaJS does not use one.
    expect(deniedOnHost('$el.style.cssText').code).toBe('FORMA_E_PROPERTY_DENIED');
    const scope = elScope();
    let error: unknown;
    try {
      runHandler(compileHandler("$el.style.cssText = 'x'"), scope);
    } catch (e) { error = e; }
    expect(isExprError(error)).toBe(true);
    expect((error as FormaExprError).code).toBe('FORMA_E_ASSIGN_DENIED');

    let viaSetProperty: unknown;
    try {
      runHandler(compileHandler("$el.style.setProperty('cssText', 'x')"), scope);
    } catch (e) { viaSetProperty = e; }
    expect((viaSetProperty as FormaExprError).code).toBe('FORMA_E_METHOD_DENIED');
  });

  it('a host value cannot be smuggled out as text or into an argument', () => {
    expect(deniedOnHost('`${$el}`').code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(deniedOnHost("'' + $el").code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(deniedOnHost('JSON.stringify($el)').code).toBe('FORMA_E_CALL_DENIED');
  });
});

// ── Function-value escalation ──

describe('function-value escalation', () => {
  it('.call / .apply / .bind do not exist on anything', () => {
    // These are the escalation step in the verified exploit chain: they are in
    // no table, so they are rejected as keys before any receiver is consulted.
    const attempts = [
      'Math.floor.call(null, 1.2)',
      'items.filter.call(items, f)',
      'items.filter.bind',
      "fn.apply(null, [])",
      "fn['call'](null)",
    ];
    for (const src of attempts) {
      expect(denied(src, { items: [1], f: 1, fn: () => 1 }).code, src).toBe('FORMA_E_KEY_DENIED');
    }
  });

  it('a function held in state is never invocable', () => {
    // An app that puts a function in state cannot be tricked into calling it
    // with attacker-chosen arguments, because bare `f(x)` has no call form.
    const state = { fn: (x: unknown) => x, items: [1, 2] };
    expect(denied('fn(1)', state).code).toBe('FORMA_E_CALL_DENIED');
    expect(denied('items.map(fn)', state).code).toBe('FORMA_E_CALL_DENIED');
    // …and it surrenders no properties either.
    expect(denied('fn.name', state).code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(denied('fn.length', state).code).toBe('FORMA_E_PROPERTY_DENIED');
  });

  it('there is no dynamic method lookup', () => {
    // `recv[m](args)` with `m` from state would be the one hole big enough for
    // everything above; the call form requires the method name to resolve to an
    // allowlisted entry for the receiver's KIND, and the deny list still applies.
    const state = { items: [1, 2], m: 'constructor' };
    expect(denied('items[m]()', state).code).toBe('FORMA_E_KEY_DENIED');
    expect(denied("items['push'](3)", state).code).toBe('FORMA_E_METHOD_DENIED');
    expect(state.items).toEqual([1, 2]);
  });

  it('new, delete, instanceof and regex literals do not lex or parse', () => {
    for (const src of ['new Date()', 'delete o.a', "'a' in o", 'o instanceof Object', '/x/.test(s)']) {
      const e = denied(src, { o: { a: 1 }, s: 'x' });
      expect(['FORMA_E_SYNTAX', 'FORMA_E_UNRESOLVED', 'FORMA_E_CALL_DENIED'], src).toContain(e.code);
    }
  });
});

// ── T2: the attacker controls values, not source ──

describe('untrusted values (T2)', () => {
  it('a poisoned Array.prototype.filter is not what runs', () => {
    const original = Array.prototype.filter;
    let poisonRan = false;
    let result: unknown;
    try {
      // eslint-disable-next-line no-extend-native -- deliberately simulating a hostile page script
      Array.prototype.filter = function poisoned() { poisonRan = true; return ['owned']; } as never;
      result = run('items.filter(i => i > 1)', { items: [1, 2, 3] });
    } finally {
      // Restore BEFORE asserting: vitest's own deep-equality walks arrays with
      // array methods, so a live poison makes the assertion report nonsense.
      Array.prototype.filter = original;
    }
    expect(result).toEqual([2, 3]);
    expect(poisonRan).toBe(false);
  });

  it("a receiver's own filter is never invoked", () => {
    // An object arriving from `data-fetch` is not an Array, so `filter` is not
    // offered for its kind at all — and even for a real Array we call the
    // captured intrinsic rather than an own property.
    let ownRan = false;
    const hostile = { filter: () => { ownRan = true; return ['owned']; }, length: 1 };
    expect(denied('data.filter(i => i)', { data: hostile }).code).toBe('FORMA_E_METHOD_DENIED');
    expect(ownRan).toBe(false);

    const arrayWithOwnFilter = Object.assign([1, 2, 3], {
      filter: () => { ownRan = true; return ['owned']; },
    });
    expect(run('items.filter(i => i > 1)', { items: arrayWithOwnFilter })).toEqual([2, 3]);
    expect(ownRan).toBe(false);
  });

  it('an accessor property is refused instead of invoked', () => {
    // A getter is code. Reading a property must never run code the app did not
    // ask to run, so a data descriptor is required and an accessor is a denial.
    let getterRan = false;
    const trap = {};
    Object.defineProperty(trap, 'boom', {
      get() { getterRan = true; return 'pwned'; },
      enumerable: true,
      configurable: true,
    });
    expect(denied('o.boom', { o: trap }).code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(denied("o['boom']", { o: trap }).code).toBe('FORMA_E_PROPERTY_DENIED');
    expect(getterRan).toBe(false);
  });

  it('an inherited property is not readable — the prototype chain is never walked', () => {
    const base = { inherited: 'from-prototype' };
    const child = Object.create(base) as Record<string, unknown>;
    child.own = 'mine';
    // `child` has a non-Object prototype, so it is not a plain-data receiver.
    expect(denied('o.inherited', { o: child }).code).toBe('FORMA_E_PROPERTY_DENIED');

    // Even for a plain object, only own keys resolve.
    expect(run('o.toString', { o: { a: 1 } })).toBeUndefined();
    expect(run('o.hasOwnProperty', { o: { a: 1 } })).toBeUndefined();
  });

  it('a JSON object cannot forge a host value', () => {
    // The host brand is a Symbol, and JSON has no symbol keys, so a T2 payload
    // shaped like a host is read as ordinary data and grants nothing.
    const fromJson = JSON.parse('{"kind":"element","label":"$el","target":{},"maxArgs":9}');
    expect(run('fake.kind', { fake: fromJson })).toBe('element');
    expect(denied('fake.focus()', { fake: fromJson }).code).toBe('FORMA_E_METHOD_DENIED');

    // The stronger version: a hand-built object carrying a REAL element, which
    // JSON could never produce. The element comes back as an opaque value of no
    // recognised kind — nothing can be read from it and nothing called on it.
    const withRealElement = { kind: 'element', label: '$el', target: document.body, maxArgs: 0 };
    expect(run('fake.target', { fake: withRealElement })).toBe(document.body);
    expect(denied('fake.target.ownerDocument', { fake: withRealElement }).code)
      .toBe('FORMA_E_PROPERTY_DENIED');
    expect(denied('fake.target.tagName', { fake: withRealElement }).code)
      .toBe('FORMA_E_PROPERTY_DENIED');
    expect(denied('fake.target.remove()', { fake: withRealElement }).code)
      .toBe('FORMA_E_METHOD_DENIED');
  });

  it('a Symbol cannot be used as a property key', () => {
    const state = { o: { a: 1 }, sym: Symbol('x') };
    expect(denied('o[sym]', state).code).toBe('FORMA_E_KEY_DENIED');
  });

  it('evaluating an expression never mutates reactive state', () => {
    const scope = scopeOf({ nums: [3, 1, 2] });
    evaluateExpression(compileExpression('nums.sort((a, b) => a - b)'), scope);
    evaluateExpression(compileExpression('nums.reverse()'), scope);
    expect(scope.state.nums).toEqual([3, 1, 2]);
  });
});

// ── T3: resource exhaustion ──

describe('resource budgets (T3)', () => {
  it('a nested callback over a large array trips the step budget', () => {
    // Termination is by construction — no loops, no recursion — so this bounds
    // COST, not hanging. 400 × 400 callback invocations is well past 100,000.
    const big = Array.from({ length: 400 }, (_, i) => i);
    const e = denied('rows.map(a => rows.map(b => b))', { rows: big });
    expect(e.code).toBe('FORMA_E_BUDGET');
    expect(e.message).toMatch(/step budget/);
  });

  it('an argument that would allocate hundreds of megabytes is refused', () => {
    // `'x'.repeat(1e9)` throws on its own, but `'x'.repeat(1e8)` SUCCEEDS and
    // costs 100 MB — so the cap has to be ours, checked before the call.
    expect(denied("'x'.repeat(1000000000)").code).toBe('FORMA_E_BUDGET');
    expect(denied("'x'.repeat(100000000)").code).toBe('FORMA_E_BUDGET');
    expect(denied("'x'.padStart(100000000, 'y')").code).toBe('FORMA_E_BUDGET');
    expect(run("'x'.repeat(3)")).toBe('xxx');
  });

  it('flat depth is capped and Infinity is refused', () => {
    expect(denied('rows.flat(1000)', { rows: [[1]] }).code).toBe('FORMA_E_BUDGET');
    // `Infinity` is not a name this grammar resolves, so it never even gets
    // as far as the depth check.
    expect(denied('rows.flat(Infinity)', { rows: [[1]] }).code).toBe('FORMA_E_UNRESOLVED');
    expect(run('rows.flat(2)', { rows: [[[1]]] })).toEqual([1]);
  });

  it('a string built by repeated concatenation is capped', () => {
    const big = 'x'.repeat(600_000);
    expect(denied('a + a', { a: big }).code).toBe('FORMA_E_BUDGET');
    expect(denied('`${a}${a}`', { a: big }).code).toBe('FORMA_E_BUDGET');
  });
});
