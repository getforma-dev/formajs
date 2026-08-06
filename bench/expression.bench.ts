/**
 * The CSP-safe expression interpreter versus the `new Function` path it now
 * replaces by default.
 *
 * The hardening lane made the CSP-safe parser the only engine every shipped
 * build reaches on its own (`_allowUnsafeEval` starts false everywhere; the
 * hardened artifacts compile the Function constructor out entirely). That trade
 * is only defensible if interpreting an expression is not dramatically worse
 * than compiling it once and calling native code afterwards — so this file
 * prices both, on the same expression strings.
 *
 * HOW THE COMPARISON IS MADE FAIR. The two engines cannot be driven through the
 * same code path: `buildEvaluator` tries the CSP parser first and only falls
 * back, so for an expression the parser accepts there is no way to ask the
 * shipped runtime for the eval version. Instead each engine is measured twice —
 * once on the real expression and once on a bare identifier — and the ENGINE
 * cost is the difference within each engine. Everything the two paths do not
 * share (the runtime's scope plumbing, its text sink) is present in both terms
 * of each difference and cancels.
 *
 * The eval-side evaluator is a verbatim reconstruction of what
 * `buildEvaluator`'s fallback builds: `new Function('__scope', 'with(__scope) {
 * return (expr); }')` called with a Proxy over `scope.getters` that returns
 * `undefined` for the unsafe-method names. It is reconstructed rather than
 * imported because the shipped runtime no longer offers a way to reach it.
 */

import { bench, describe } from 'vitest';
import { createSignal, internalEffect, createRoot } from 'forma/reactive';
import { mount, unmount, setScopeValue } from 'forma/runtime';
import { MICRO, MACRO, attachedContainer } from './_support';

// ---------------------------------------------------------------------------
// The expression population
// ---------------------------------------------------------------------------

/**
 * The engine comparison set. Two properties are load-bearing, and both were
 * learned the hard way — earlier versions of this file violated each in turn
 * and reported the interpreted expressions as FASTER than a bare identifier:
 *
 *  1. Every expression READS `count`. Fine-grained reactivity means a binding
 *     only re-runs when something it read changed, so `user.name` subscribes to
 *     `user` and a write to `count` never re-evaluates it. Mixing the two puts
 *     fewer live bindings on the subject side than on the control side.
 *
 *  2. Every expression's VALUE changes whenever `count` changes. `count > 10`
 *     re-runs but keeps rendering "true", and the text sink skips a write it
 *     does not need — so the subject would do 8 evaluations and 5 DOM writes
 *     against the control's 8 and 8, and the DOM write is the larger term.
 *
 * Shapes that cannot satisfy (2) on their own (a bare comparison, a unary `!`)
 * are covered by GRAMMAR below, where only compilation is measured.
 */
const COUNT_EXPRESSIONS = [
  'count + 1',
  'count * 2 + 1',
  '(count + 1) * 2',
  'count > 10 ? count : count + 1',
  'flag && count',
  'count ?? fallback',
  "'total: ' + count",
  'items.length + count',
] as const;

/**
 * The wider grammar, including the shapes that cannot satisfy the two rules
 * above. Used only where every binding is COMPILED rather than re-run, so
 * neither the dependency asymmetry nor the skipped-write asymmetry applies.
 */
const GRAMMAR = [
  ...COUNT_EXPRESSIONS,
  'count',
  'count > 10',
  "count > 10 ? 'many' : 'none'",
  '!flag',
  'user.name',
  'user.profile.city',
  'items.length',
  'label ?? fallback',
] as const;

/** The one-identifier control: the cheapest thing either engine can evaluate. */
const CONTROL_EXPRESSION = 'count';

const INITIAL_STATE = {
  count: 3,
  flag: true,
  label: 'hi',
  fallback: 'none',
  user: { name: 'ada', profile: { city: 'london' } },
  items: [1, 2, 3, 4],
};

// ---------------------------------------------------------------------------
// The eval-path evaluator, reconstructed
// ---------------------------------------------------------------------------

/** Same set the runtime's fallback Proxy consults on every property read. */
const UNSAFE_METHOD_NAMES = new Set([
  'constructor', '__proto__', 'prototype',
  '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
  'eval', 'Function',
]);

interface Getters { [key: string]: () => unknown }

function evalScopeProxy(getters: Getters): Record<string, unknown> {
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    has(_, key: string) { return key in getters; },
    get(_, key: string) {
      if (UNSAFE_METHOD_NAMES.has(key)) return undefined;
      const g = getters[key];
      return g ? g() : undefined;
    },
  });
}

function buildEvalEvaluator(expr: string, proxy: Record<string, unknown>): () => unknown {
  // eslint-disable-next-line no-new-func -- this is the measurement subject
  const fn = new Function('__scope', `with(__scope) { return (${expr}); }`) as (
    scope: Record<string, unknown>,
  ) => unknown;
  return () => fn(proxy);
}

// ---------------------------------------------------------------------------
// Compile cost
// ---------------------------------------------------------------------------

describe('expression compile', () => {
  const COMPILES = 200;

  bench(`new Function compile, unique expressions (×${COMPILES})`, () => {
    for (let i = 0; i < COMPILES; i++) {
      // A unique literal per call so no engine-level code cache can serve it.
      new Function('__scope', `with(__scope) { return (count * 2 + ${i}); }`);
    }
  }, MICRO);

  /**
   * The CSP-safe side of the same question, measured end to end. There is no
   * public entry point that compiles an expression on its own, so both variants
   * mount a whole scope and the plumbing is subtracted:
   *
   *   - the CONTROL binds `data-text="count"`. A bare identifier is one of the
   *     shapes `parseExpression` memoizes as a reusable factory
   *     (`expressionCache`), so its parse is a Map hit and effectively free.
   *   - the SUBJECT binds a unique arithmetic expression per directive per
   *     iteration. Arithmetic is NOT factory-cached — only identifiers, dot
   *     access and literals are — and a fresh scope gets a fresh
   *     `scopeExpressionCache`, so every one of them is parsed from scratch.
   *
   * Everything else (attribute scan, signal creation, effect creation, DOM) is
   * identical between the two, so the difference is the parse.
   */
  const DIRECTIVES = 40;

  function scopeMarkup(exprFor: (i: number) => string): string {
    const spans: string[] = [];
    for (let i = 0; i < DIRECTIVES; i++) {
      spans.push(`<span data-text="${exprFor(i)}"></span>`);
    }
    return `<div data-forma-state='${JSON.stringify(INITIAL_STATE)}'>${spans.join('')}</div>`;
  }

  let salt = 0;
  bench(`CSP parser: mount unique arithmetic expressions (×${DIRECTIVES})`, () => {
    const s = salt++;
    const host = attachedContainer(scopeMarkup((i) => `count * 2 + ${s * DIRECTIVES + i}`));
    mount(host.firstElementChild!);
    unmount(host.firstElementChild!);
    host.remove();
  }, MACRO);

  bench(`CSP parser: mount bare identifiers, plumbing control (×${DIRECTIVES})`, () => {
    const host = attachedContainer(scopeMarkup(() => 'count'));
    mount(host.firstElementChild!);
    unmount(host.firstElementChild!);
    host.remove();
  }, MACRO);

  /**
   * Every grammar shape the CSP-safe parser supports, bound once. This is the
   * shape-coverage benchmark: unlike the evaluate benchmarks it does not need
   * each expression to depend on the same signal, because binding compiles all
   * of them regardless of what they read. The guard below is the real value —
   * an expression that quietly fell outside the grammar would be flagged with
   * `data-forma-expr-error` and would otherwise just look fast.
   */
  const grammarMarkup =
    `<div data-forma-state='${JSON.stringify(INITIAL_STATE)}'>` +
    GRAMMAR.map((e) => `<span data-text="${e.replace(/"/g, '&quot;')}"></span>`).join('') +
    '</div>';

  {
    const host = attachedContainer(grammarMarkup);
    const root = host.firstElementChild!;
    mount(root);
    const failed = Array.from(root.querySelectorAll('[data-forma-expr-error]'), (el) =>
      el.getAttribute('data-text'));
    unmount(root);
    host.remove();
    if (failed.length > 0) {
      throw new Error(`outside the CSP-safe grammar: ${JSON.stringify(failed)}`);
    }
  }

  bench(`CSP parser: mount every supported grammar shape (×${GRAMMAR.length})`, () => {
    const host = attachedContainer(grammarMarkup);
    mount(host.firstElementChild!);
    unmount(host.firstElementChild!);
    host.remove();
  }, MACRO);
});

// ---------------------------------------------------------------------------
// Evaluate cost — CSP side, through the shipped runtime
// ---------------------------------------------------------------------------

describe('expression evaluate: CSP-safe interpreter (shipped)', () => {
  const UPDATES = 20;
  const N = COUNT_EXPRESSIONS.length;

  /** A scope with one `data-text` span per expression in `exprs`. */
  function mountScope(exprs: readonly string[]): Element {
    const spans = exprs
      .map((e) => `<span data-text="${e.replace(/"/g, '&quot;')}"></span>`)
      .join('');
    const host = attachedContainer(
      `<div data-forma-state='${JSON.stringify(INITIAL_STATE)}'>${spans}</div>`,
    );
    const root = host.firstElementChild!;
    mount(root);
    return root;
  }

  const subject = mountScope(COUNT_EXPRESSIONS);
  const control = mountScope(new Array<string>(N).fill(CONTROL_EXPRESSION));

  // A mounted directive that never updates is a benchmark of nothing. Prove that
  // every expression compiled, and that ONE write re-renders ALL N of them —
  // that second check is what keeps the subtraction against the control honest,
  // and it is the check both earlier versions of this benchmark would have
  // failed.
  const before = Array.from(subject.querySelectorAll('span'), (s) => s.textContent ?? '');
  setScopeValue(subject, 'count', 40);
  const after = Array.from(subject.querySelectorAll('span'), (s) => s.textContent ?? '');
  if (after.length !== N) throw new Error('CSP fixture did not mount every expression');
  if (subject.querySelector('[data-forma-expr-error]')) {
    throw new Error('an expression in the set is outside the CSP-safe grammar');
  }
  for (let i = 0; i < N; i++) {
    if (before[i] === after[i]) {
      throw new Error(
        `"${COUNT_EXPRESSIONS[i]}" rendered "${after[i]}" both before and after a ` +
        `write to count — it does not re-run, so subtracting the control is invalid`,
      );
    }
  }

  let a = 0;
  bench(`${N} count-dependent expressions: write → evaluate → text (×${UPDATES})`, () => {
    for (let i = 0; i < UPDATES; i++) setScopeValue(subject, 'count', ++a);
  }, MICRO);

  let b = 0;
  bench(`${N} × bare identifier, plumbing control: write → text (×${UPDATES})`, () => {
    for (let i = 0; i < UPDATES; i++) setScopeValue(control, 'count', ++b);
  }, MICRO);
});

// ---------------------------------------------------------------------------
// Evaluate cost — eval side, same subtraction, reconstructed evaluator
// ---------------------------------------------------------------------------

describe('expression evaluate: new Function path (reconstructed)', () => {
  const UPDATES = 20;
  const N = COUNT_EXPRESSIONS.length;

  /**
   * One binding per expression, each in its own `internalEffect` writing its own
   * text node — the same per-binding plumbing the CSP side has. The subtraction
   * is the same too: subject minus control leaves `N` evaluations, whichever
   * engine produced them.
   */
  function evalBindings(exprs: readonly string[]): (n: number) => void {
    return createRoot(() => {
      const [count, setCount] = createSignal(3);
      const getters: Getters = {
        count,
        flag: () => true,
        label: () => 'hi',
        fallback: () => 'none',
        user: () => INITIAL_STATE.user,
        items: () => INITIAL_STATE.items,
      };
      const proxy = evalScopeProxy(getters);
      for (const expr of exprs) {
        const evaluate = buildEvalEvaluator(expr, proxy);
        const node = document.createTextNode('');
        internalEffect(() => { node.data = String(evaluate()); });
      }
      return setCount;
    });
  }

  const subject = evalBindings(COUNT_EXPRESSIONS);
  const control = evalBindings(new Array<string>(N).fill(CONTROL_EXPRESSION));

  let a = 0;
  bench(`${N} count-dependent expressions via new Function: write → evaluate → text (×${UPDATES})`, () => {
    for (let i = 0; i < UPDATES; i++) subject(++a);
  }, MICRO);

  let b = 0;
  bench(`${N} × bare identifier via new Function, plumbing control (×${UPDATES})`, () => {
    for (let i = 0; i < UPDATES; i++) control(++b);
  }, MICRO);

  /**
   * The floor neither engine can beat: the same `N` expressions written as
   * JavaScript closures by hand, in the same effects and the same text sinks.
   */
  const handWritten = createRoot(() => {
    const [count, setCount] = createSignal(3);
    // Typed as nullable so `??` is a real coalesce and not a constant-folded
    // no-op — the point is to run the same work the interpreter runs.
    const fallback: string = INITIAL_STATE.fallback;
    const flag: boolean = INITIAL_STATE.flag;
    // One body per entry of COUNT_EXPRESSIONS, in the same order.
    const items = INITIAL_STATE.items;
    const bodies: Array<() => unknown> = [
      () => count() + 1,
      () => count() * 2 + 1,
      () => (count() + 1) * 2,
      () => (count() > 10 ? count() : count() + 1),
      () => flag && count(),
      () => count() ?? fallback,
      () => 'total: ' + count(),
      () => items.length + count(),
    ];
    if (bodies.length !== N) {
      throw new Error(`hand-written floor has ${bodies.length} bodies for ${N} expressions`);
    }
    for (const body of bodies) {
      const node = document.createTextNode('');
      internalEffect(() => { node.data = String(body()); });
    }
    return setCount;
  });
  let c = 0;
  bench(`${N} count-dependent expressions as hand-written closures, floor (×${UPDATES})`, () => {
    for (let i = 0; i < UPDATES; i++) handWritten(++c);
  }, MICRO);
});
