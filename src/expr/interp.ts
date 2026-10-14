/**
 * The tree-walking interpreter.
 *
 * Two rules carry the whole security model, and both are enforced here rather
 * than inferred from the validator:
 *
 * 1. **Identifier resolution never consults `globalThis`.** Names resolve
 *    against arrow-parameter frames, then the scope's own getters (state,
 *    computed values, list-row locals, magics), then a frozen table of captured
 *    intrinsics — and then they FAIL. `document`, `fetch`, `window` and
 *    `localStorage` are not blocked; there is no lookup that could find them.
 *
 * 2. **A method is never obtained by reading a property of the receiver.** For
 *    data receivers the function comes from a frozen table captured at module
 *    init and is applied with `Reflect.apply`, so a receiver carrying its own
 *    `filter` never contributes it, and another script poisoning
 *    `Array.prototype.filter` later cannot change what runs. There is no
 *    `.call` / `.apply` / `.bind` and no dynamic method lookup, because those
 *    are the escalation step in the exploit chain this design replaces.
 *
 * The one exception to (2), stated plainly: a HOST receiver ($el, $event,
 * classList, style, dataset) is a DOM object the RUNTIME created and wrapped —
 * never a value that came from state, JSON or an attribute — so its method is
 * read off that target. The name must still be in the fixed per-kind table, and
 * there is no attacker-supplied receiver that could impersonate one.
 *
 * Verified by: src/expr/__tests__/adversarial.test.ts > "a receiver's own filter is never invoked"
 * Verified by: src/expr/__tests__/adversarial.test.ts > "no global is reachable by name"
 */
import { LIMITS, type BinaryOp, type Expr, type Stmt } from './ast';
import { exprError, type FormaExprError } from './errors';
import { isSafeAttrName, isUnsafeAttrWrite } from '../security/url-safety.js';
import {
  ARRAY_COPY_FIRST,
  ARRAY_METHODS,
  CLASSLIST_METHODS,
  CLASSLIST_READ_PROPS,
  DENY_KEYS,
  ELEMENT_HOST_PROPS,
  ELEMENT_METHODS,
  ELEMENT_METHOD_RESULT,
  ELEMENT_READ_PROPS,
  ELEMENT_WRITE_PROPS,
  EVENT_HOST_PROPS,
  EVENT_METHODS,
  EVENT_READ_PROPS,
  HOF_CALLBACK_PARAMS,
  MAX_KEY_LENGTH,
  NUMBER_METHODS,
  RECT_KEYS,
  SAFE_GLOBALS,
  STRING_METHODS,
  STYLE_DENY_PROPS,
  STYLE_METHODS,
} from './allowlist';
import { hostObject, isHost, type Host } from './host';
import { COSTS, DATA_ARGS, FLAT, GROW, PARSE, READ, weigh } from './cost';

export interface ScopeLike {
  getters: Record<string, () => unknown>;
  setters: Record<string, (v: unknown) => void>;
}

interface Frame {
  names: string[];
  values: unknown[];
  parent: Frame | null;
}

/**
 * What the evaluations of one task have spent so far (FORMA-028): the runtime
 * keeps one, and every evaluation it starts counts on from it, so the step and
 * allocation budgets bound the task, not each binding in it.
 */
export interface Meter {
  steps: number;
  cost: number;
}

export interface EvalCtx {
  scope: ScopeLike;
  frame: Frame | null;
  /** Steps counted against the budget: this evaluation's, and the task's before it. */
  steps: number;
  budget: number;
  /** Units charged to `LIMITS.ALLOC_BUDGET`, counted the same way. */
  cost: number;
  /** Whether part of the budget was already spent when this evaluation began. */
  defer: boolean;
}

/** Prototype of a plain object literal, captured once. */
const OBJECT_PROTO = Object.getPrototypeOf({}) as object;

let stepBudget: number = LIMITS.STEP_BUDGET;

/** Override the step budget (`data-forma-expr-budget`): one per task in the runtime, per evaluation without a meter. */
export function setStepBudget(n: number): void {
  stepBudget = Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : LIMITS.STEP_BUDGET;
}

export function getStepBudget(): number {
  return stepBudget;
}

/** The evaluation running now, if any: one started inside it shares its budget. */
let cur: EvalCtx | null = null;

/**
 * A context counts on from what was spent before it: the running evaluation's
 * when one is nested in another (a `data-computed` read by a binding, a
 * handler `$el.click()` dispatches), else the task's `meter`, else nothing.
 * So a chain of computeds, or of handlers, spends one budget between them.
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "a chain of computeds spends one budget between them"
 */
export function makeCtx(scope: ScopeLike, meter?: Meter | null): EvalCtx {
  const base = cur ?? meter;
  const steps = base ? base.steps : 0;
  const cost = base ? base.cost : 0;
  return { scope, frame: null, steps, budget: stepBudget, cost, defer: steps + cost > 0 };
}

/** Make `ctx` the running evaluation; returns the one it was nested in. */
export function enter(ctx: EvalCtx): EvalCtx | null {
  const outer = cur;
  cur = ctx;
  return outer;
}

/**
 * End `ctx`, whether it answered or threw, and hand what it spent back to
 * what it counted on from: the evaluation it was nested in, else the meter.
 */
export function leave(ctx: EvalCtx, outer: EvalCtx | null, meter?: Meter | null): void {
  cur = outer;
  const base = outer ?? meter;
  if (base) {
    base.steps = ctx.steps;
    base.cost = ctx.cost;
  }
}

/**
 * A budget refusal, marked for a retry when the evaluation did not start
 * fresh, unless it is `final`: a charge no task could hold.
 */
function over(ctx: EvalCtx, err: FormaExprError, final = false): FormaExprError {
  err.defer = ctx.defer && !final;
  return err;
}

function step(ctx: EvalCtx, at: number): void {
  if (++ctx.steps > ctx.budget) {
    throw over(ctx, exprError('FORMA_E_BUDGET', `expression exceeded its ${ctx.budget}-step budget`, at));
  }
}

// ── The allocation budget (DR-16) ──

/** `array.map` and the like, built once per method rather than once per call. */
const NAMES: Record<string, Record<string, string>> = Object.create(null) as Record<string, Record<string, string>>;

/**
 * How far a cost is counted before it stops: the whole budget, not the room
 * left in this task. A cost counted only to the room left reads just past
 * that room whatever the call weighs, and a charge past the whole budget can
 * never fit in any task, so it is refused for good (`charge`); counted to the
 * room left, it would look like one that fits in a fresher task, and be
 * deferred and priced again in every retry until it ran first.
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "a binding too heavy for any task is priced once and reported once"
 */
const REACH = LIMITS.ALLOC_BUDGET;

/**
 * Charge `units` to the evaluation, or refuse with `FORMA_E_BUDGET`. A NaN or
 * negative charge is refused too, so a cost that cannot be read fails closed.
 * A refused charge is taken back: the call it priced never runs, so it does
 * not count against the task's meter. One larger than the whole budget (or
 * unreadable) is final: no later task could hold it, so it is reported now,
 * not retried (FORMA-028 review, S2).
 * Verified by: src/expr/__tests__/native-cost.test.ts > "the budget is per evaluation and cumulative across its calls"
 * Verified by: src/__tests__/runtime-task-budget.test.ts > "a binding too heavy for any task is priced once and reported once"
 */
export function charge(ctx: EvalCtx, units: number, what: string, at: number): void {
  const spent = ctx.cost;
  if (!(units >= 0 && (ctx.cost += units) <= LIMITS.ALLOC_BUDGET)) {
    ctx.cost = spent;
    const err = exprError('FORMA_E_BUDGET', `${what} would exceed the ${LIMITS.ALLOC_BUDGET}-unit allocation budget`, at);
    throw over(ctx, err, !(units <= REACH));
  }
}

/**
 * The preflight every native call passes BEFORE it runs: the text weight of
 * each argument (unless the native reads them as data), then the native's row
 * in the cost table, if it has one. The intrinsic is invoked only after both
 * charges fit.
 * Verified by: src/expr/__tests__/native-cost.test.ts > "every allowlisted native refuses an argument heavier than the budget before it runs"
 * Verified by: src/expr/__tests__/native-cost.test.ts > "every size-driven cost refuses a hostile size before the native runs"
 */
function preflight(ctx: EvalCtx, name: string, recv: unknown, args: unknown[], at: number): void {
  if (typeof recv === 'string') {
    // A string method reads a string argument (a pattern, a separator, a
    // filler) as it is, at about a nanosecond a character: it converts only
    // the others. Its row charges what the argument makes it build.
    // Verified by: src/expr/__tests__/string-growth.test.ts > "a string method reads a string argument for a thirty-second of a unit a character"
    for (const a of args) charge(ctx, typeof a === 'string' ? a.length / 32 : weigh(a, REACH), name, at);
  } else if (!DATA_ARGS.has(name)) {
    for (const a of args) charge(ctx, weigh(a, REACH), name, at);
  }
  const cost = Object.hasOwn(COSTS, name) ? COSTS[name]! : null;
  if (cost) charge(ctx, cost(recv, args, REACH), name, at);
}

/**
 * An array or object an operator is about to convert to text or a number
 * (`'' + list`, `${list}`, `list < 1`): the conversion is a `join`, so it is
 * charged like a native's argument.
 * Verified by: src/expr/__tests__/native-cost.test.ts > "an operator does not convert a value heavier than the budget"
 */
function coerce(ctx: EvalCtx, v: unknown, at: number): void {
  if (typeof v === 'object' && v !== null) charge(ctx, weigh(v, REACH), 'converting a value to text', at);
}

/**
 * A string an operator builds (`a + b`, `x += s`, a template literal) is
 * charged by its length (FORMA-028). Joining is cheap, because the engine
 * keeps the pieces as a rope, but the first read of a fresh rope copies the
 * whole of it: 19 doublings of `'x'` built 524,288 characters, and reading
 * `(big + 'y')` 15,000 times then took 2.6 s at 4x CPU throttling. Charging
 * what an operator produces charges each such copy before it can happen. A
 * string under 512 characters is free: copying one measured under half a
 * microsecond, and the step budget bounds how many one evaluation can build
 * (about 33,000), so a search that joins each record's fields pays nothing.
 * Verified by: src/expr/__tests__/string-growth.test.ts > "every round-2 rope case is refused before the long task"
 */
function grow(ctx: EvalCtx, v: unknown, at: number): void {
  if (typeof v === 'string' && v.length > 511) charge(ctx, v.length * GROW, 'building a string', at);
}

/**
 * A string an operand has just built with `+` or a template literal is a rope,
 * and comparing it, or reading one character of it, first copies all of it:
 * about half a microsecond plus 1 to 3 ns a character at 4x CPU throttling, so
 * 12,400 comparisons of two such 511-character strings took 56 ms inside the
 * step budget (FORMA-028). That copy is charged where it happens, up to the
 * 512 characters past which `grow` has charged it already. A string method
 * other than a character read is charged by its row, which a search that
 * lowercases each record's joined fields already pays.
 * Verified by: src/expr/__tests__/string-growth.test.ts > "comparing or reading a string just built is charged for copying it"
 */
function copied(ctx: EvalCtx, node: Expr, v: unknown, at: number): void {
  if (typeof v === 'string' && v.length > 12 && (node.k === 'Template' || (node.k === 'Binary' && node.op === '+'))) {
    charge(ctx, FLAT + Math.min(v.length, 512) / 32, 'copying a string just built', at);
  }
}

/**
 * A long string an operator converts to a number (`s * 1`, `-s`, `s < 1`,
 * `s == 1`) is parsed whole: about 11 ns a character for digits at 4x CPU
 * throttling, a tenth of an `Array.from` slot (FORMA-028).
 * Verified by: src/expr/__tests__/string-growth.test.ts > "an operator that parses a long string as a number is charged for it"
 */
function parse(ctx: EvalCtx, v: unknown, at: number): void {
  if (typeof v === 'string' && v.length > 31) charge(ctx, v.length * PARSE, 'converting a string to a number', at);
}

/**
 * What a binary operator other than `+` reads of its string operands: a
 * comparison of two strings reads them character by character (equality only
 * when their lengths match); otherwise a string is parsed as a number, except
 * by `===` and `!==`, which convert nothing, and against `null` by `==`.
 * Verified by: src/expr/__tests__/string-growth.test.ts > "comparing long strings is charged by the characters compared"
 */
function scan(ctx: EvalCtx, op: BinaryOp, l: unknown, r: unknown, at: number): boolean {
  const strict = op === '===' || op === '!==';
  const equality = strict || op === '==' || op === '!=';
  const arithmetic = op === '-' || op === '*' || op === '/' || op === '%';
  if (!arithmetic && typeof l === 'string' && typeof r === 'string') {
    const n = equality && l.length !== r.length ? 0 : Math.min(l.length, r.length);
    if (n > 127) charge(ctx, n * READ, 'comparing strings', at);
    return n > 0;
  }
  if (!strict && !(equality && (l == null || r == null))) {
    parse(ctx, l, at);
    parse(ctx, r, at);
  }
  return false;
}

// ── The two audited member-access helpers ──

/**
 * Normalise and vet a property key, whatever syntax produced it: a static
 * `.name`, a static `['name']`, a computed `[expr]`, or a template-literal key.
 * Applying this to the EVALUATED key is what makes `items['constructor']`,
 * `items[k]` with `k` from server JSON, `items['cons'+'tructor']` and
 * `items[String.fromCharCode(…)]` all the same case, and all dead.
 * Verified by: src/expr/__tests__/adversarial.test.ts > "every spelling of a constructor reach is denied"
 */
export function safeKey(raw: unknown, at: number): string {
  if (typeof raw === 'symbol') {
    throw exprError('FORMA_E_KEY_DENIED', 'a symbol cannot be used as a property key', at);
  }
  if (typeof raw === 'object' && raw !== null && weigh(raw, MAX_KEY_LENGTH) > MAX_KEY_LENGTH) {
    throw exprError('FORMA_E_KEY_DENIED', 'property name is too long', at);
  }
  const key = typeof raw === 'string' ? raw : String(raw);
  if (key.length > MAX_KEY_LENGTH) {
    throw exprError('FORMA_E_KEY_DENIED', 'property name is too long', at);
  }
  if (DENY_KEYS.has(key)) {
    throw exprError('FORMA_E_KEY_DENIED', `property "${key}" is never accessible`, at);
  }
  return key;
}

type Kind = 'none' | 'host' | 'array' | 'string' | 'number' | 'boolean' | 'object' | 'other';

function kindOf(v: unknown): Kind {
  if (v === null || v === undefined) return 'none';
  if (isHost(v)) return 'host';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  if (t === 'object') {
    const proto = Object.getPrototypeOf(v as object);
    if (proto === OBJECT_PROTO || proto === null) return 'object';
  }
  return 'other';
}

function describeKind(v: unknown): string {
  const k = kindOf(v);
  return k === 'host' ? (v as Host).label : k;
}

/**
 * Read one property. The rules, in order:
 *   1. nullish receiver → `undefined` (optional-chaining semantics; an absent
 *      base is data, not a failure — `data-fetch` results are null until they
 *      land). Every OTHER outcome below that is not a value is an error.
 *   2. `safeKey` on the evaluated key.
 *   3. host receivers dispatch to their kind's table.
 *   4. `length` on arrays and strings; numeric indices on strings.
 *   5. plain object / array data key: own property, and its descriptor must be
 *      a DATA descriptor — an accessor is refused, so a poisoned getter shipped
 *      in untrusted JSON-adjacent state never runs. The prototype chain is
 *      never walked.
 *   6. anything else → `FORMA_E_PROPERTY_DENIED`, reported, never `undefined`.
 * Verified by: src/expr/__tests__/adversarial.test.ts > "an accessor property is refused instead of invoked"
 */
export function safeRead(recv: unknown, rawKey: unknown, at: number, optional: boolean): unknown {
  if (recv === null || recv === undefined) {
    if (optional) return undefined;
    return undefined;
  }
  const key = safeKey(rawKey, at);
  const kind = kindOf(recv);

  if (kind === 'host') return hostRead(recv as Host, key, at);

  if (kind === 'array') {
    if (key === 'length') return (recv as unknown[]).length;
    if (Object.hasOwn(ARRAY_METHODS, key)) {
      throw exprError('FORMA_E_PROPERTY_DENIED', `"${key}" is a method, not a value — call it`, at);
    }
    return ownDataValue(recv as object, key, at);
  }

  if (kind === 'string') {
    const str = recv as string;
    if (key === 'length') return str.length;
    if (Object.hasOwn(STRING_METHODS, key)) {
      throw exprError('FORMA_E_PROPERTY_DENIED', `"${key}" is a method, not a value — call it`, at);
    }
    if (/^\d+$/.test(key)) return Reflect.apply(STRING_METHODS.at!, str, [Number(key)]);
    throw exprError('FORMA_E_PROPERTY_DENIED', `strings have no readable property "${key}"`, at);
  }

  if (kind === 'object') return ownDataValue(recv as object, key, at);

  if (kind === 'number' && Object.hasOwn(NUMBER_METHODS, key)) {
    throw exprError('FORMA_E_PROPERTY_DENIED', `"${key}" is a method, not a value — call it`, at);
  }

  throw exprError(
    'FORMA_E_PROPERTY_DENIED',
    `cannot read "${key}" from a ${describeKind(recv)} value`,
    at,
  );
}

/** Own data property, or `undefined` for an absent key. Accessors are refused. */
function ownDataValue(recv: object, key: string, at: number): unknown {
  if (!Object.hasOwn(recv, key)) return undefined;
  const desc = Object.getOwnPropertyDescriptor(recv, key);
  if (!desc || !Object.hasOwn(desc, 'value')) {
    throw exprError(
      'FORMA_E_PROPERTY_DENIED',
      `"${key}" is an accessor property; expressions read data only`,
      at,
    );
  }
  return desc.value;
}

function wrapElement(v: unknown, label: string): unknown {
  return v === null || v === undefined ? undefined : hostObject('element', v, label);
}

function hostRead(host: Host, key: string, at: number): unknown {
  const target = host.target as Record<string, unknown>;
  switch (host.kind) {
    case 'element': {
      if (Object.hasOwn(ELEMENT_HOST_PROPS, key)) {
        const as = ELEMENT_HOST_PROPS[key]!;
        const value = Reflect.get(target, key);
        if (as === 'element') return wrapElement(value, `${host.label}.${key}`);
        if (as === 'elementList') return toElementList(value, `${host.label}.${key}`);
        return value === null || value === undefined
          ? undefined
          : hostObject(as, value, `${host.label}.${key}`);
      }
      if (ELEMENT_READ_PROPS.has(key)) return Reflect.get(target, key);
      if (ELEMENT_METHODS.has(key)) {
        throw exprError('FORMA_E_PROPERTY_DENIED', `${host.label}.${key} is a method, not a value — call it`, at);
      }
      throw exprError('FORMA_E_PROPERTY_DENIED', `${host.label}.${key} is not on the element allowlist`, at);
    }
    case 'event': {
      if (EVENT_HOST_PROPS.has(key)) return wrapElement(Reflect.get(target, key), `${host.label}.${key}`);
      if (EVENT_READ_PROPS.has(key)) return Reflect.get(target, key);
      if (EVENT_METHODS.has(key)) {
        throw exprError('FORMA_E_PROPERTY_DENIED', `${host.label}.${key} is a method, not a value — call it`, at);
      }
      throw exprError('FORMA_E_PROPERTY_DENIED', `${host.label}.${key} is not on the event allowlist`, at);
    }
    case 'classList': {
      if (CLASSLIST_READ_PROPS.has(key)) return Reflect.get(target, key);
      if (CLASSLIST_METHODS.has(key)) {
        throw exprError('FORMA_E_PROPERTY_DENIED', `${host.label}.${key} is a method, not a value — call it`, at);
      }
      throw exprError('FORMA_E_PROPERTY_DENIED', `classList has no readable property "${key}"`, at);
    }
    case 'style': {
      if (STYLE_DENY_PROPS.has(key)) {
        throw exprError('FORMA_E_PROPERTY_DENIED', `style.${key} is not available`, at);
      }
      if (STYLE_METHODS.has(key)) {
        throw exprError('FORMA_E_PROPERTY_DENIED', `style.${key} is a method, not a value — call it`, at);
      }
      const value = Reflect.get(target, key);
      return typeof value === 'string' ? value : undefined;
    }
    case 'dataset': {
      const value = Reflect.get(target, key);
      return typeof value === 'string' ? value : undefined;
    }
    case 'refs': {
      const el = (target as unknown as Map<string, unknown>).get(key);
      return el === undefined ? undefined : hostObject('element', el, `$refs.${key}`);
    }
    case 'namespace':
    case 'fn': {
      const members = host.members;
      if (!members || !Object.hasOwn(members, key)) {
        throw exprError('FORMA_E_PROPERTY_DENIED', `${host.label}.${key} is not on the allowlist`, at);
      }
      const value = members[key];
      if (typeof value === 'function' || isHost(value)) {
        throw exprError('FORMA_E_PROPERTY_DENIED', `${host.label}.${key} is a function, not a value — call it`, at);
      }
      return value;
    }
    default: {
      const never: never = host.kind;
      throw exprError('FORMA_E_PROPERTY_DENIED', `unknown host ${String(never)}`, at);
    }
  }
}

/** Convert an HTMLCollection/NodeList into a bounded array of element hosts. */
function toElementList(value: unknown, label: string): unknown {
  const list = value as ArrayLike<unknown> | null | undefined;
  if (!list || typeof list.length !== 'number') return [];
  const n = Math.min(list.length, LIMITS.MAX_ARRAY_LENGTH);
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) out.push(hostObject('element', list[i], `${label}[${i}]`));
  return out;
}

// ── Evaluation ──

function resolveIdent(name: string, ctx: EvalCtx, at: number): unknown {
  for (let f = ctx.frame; f !== null; f = f.parent) {
    const i = f.names.indexOf(name);
    if (i >= 0) return f.values[i];
  }
  const getter = ctx.scope.getters[name];
  if (typeof getter === 'function') return getter();
  if (Object.hasOwn(SAFE_GLOBALS, name)) return SAFE_GLOBALS[name];
  throw exprError(
    'FORMA_E_UNRESOLVED',
    `"${name}" is not declared in this scope — expressions cannot reach globals`,
    at,
  );
}

function checkResultSize(result: unknown, at: number): unknown {
  if (typeof result === 'string' && result.length > LIMITS.MAX_STRING_LENGTH) {
    throw exprError('FORMA_E_BUDGET', 'the resulting string is too large', at);
  }
  if (Array.isArray(result) && result.length > LIMITS.MAX_ARRAY_LENGTH) {
    throw exprError('FORMA_E_BUDGET', 'the resulting array is too large', at);
  }
  return result;
}

/**
 * Pre-flight guards for methods whose cost is set by an ARGUMENT rather than by
 * the receiver. `'x'.repeat(1e9)` throws on its own, but `'x'.repeat(1e8)`
 * succeeds and costs 100 MB — so the cap has to be ours, before the call.
 * Verified by: src/expr/__tests__/adversarial.test.ts > "an argument that would allocate hundreds of megabytes is refused"
 */
function guardArgs(method: string, args: unknown[], at: number): void {
  if (method === 'repeat') {
    const n = Number(args[0]);
    if (!(n >= 0) || n > LIMITS.MAX_REPEAT_COUNT) {
      throw exprError('FORMA_E_BUDGET', `repeat() is capped at ${LIMITS.MAX_REPEAT_COUNT}`, at);
    }
  } else if (method === 'flat') {
    const n = args.length === 0 ? 1 : Number(args[0]);
    if (!Number.isFinite(n) || n < 0 || n > LIMITS.MAX_FLAT_DEPTH) {
      throw exprError('FORMA_E_BUDGET', `flat() depth is capped at ${LIMITS.MAX_FLAT_DEPTH}`, at);
    }
  }
}

/** Build the JS callback an allowlisted higher-order method will invoke. */
function makeCallback(node: Expr, ctx: EvalCtx, maxParams: number, at: number): (...a: unknown[]) => unknown {
  if (node.k === 'Arrow') {
    const { params, body } = node;
    return (...jsArgs: unknown[]) => {
      step(ctx, at);
      const frame: Frame = { names: params, values: jsArgs.slice(0, params.length), parent: ctx.frame };
      const saved = ctx.frame;
      ctx.frame = frame;
      try {
        return evalExpr(body, ctx);
      } finally {
        ctx.frame = saved;
      }
    };
  }
  // `items.filter(Boolean)` — an allowlisted intrinsic used as a predicate. It
  // is invoked with OUR arity, never the raw one the method would pass.
  const value = evalExpr(node, ctx);
  if (isHost(value) && value.kind === 'fn') {
    const fn = value.target as (...a: unknown[]) => unknown;
    const arity = Math.min(value.maxArgs, maxParams);
    return (...jsArgs: unknown[]) => {
      step(ctx, at);
      const args = jsArgs.slice(0, arity);
      preflight(ctx, value.label, undefined, args, at);
      return Reflect.apply(fn, undefined, args);
    };
  }
  throw exprError(
    'FORMA_E_CALL_DENIED',
    'this argument must be an arrow function or an allowlisted built-in',
    node.i,
  );
}

function evalArg(node: Expr, ctx: EvalCtx): unknown {
  const value = evalExpr(node, ctx);
  if (isHost(value)) {
    throw exprError(
      'FORMA_E_CALL_DENIED',
      `${value.label} cannot be passed as an argument`,
      node.i,
    );
  }
  return value;
}

function evalCall(node: Expr & { k: 'Call' }, ctx: EvalCtx): unknown {
  const at = node.i;
  const callee = node.callee;

  if (callee.k === 'Identifier') {
    const target = resolveIdent(callee.name, ctx, callee.i);
    if (isHost(target) && target.kind === 'fn') {
      const args = node.args.map((a) => evalArg(a, ctx)).slice(0, target.maxArgs);
      preflight(ctx, target.label, undefined, args, at);
      return checkResultSize(Reflect.apply(target.target as (...a: unknown[]) => unknown, undefined, args), at);
    }
    throw exprError(
      'FORMA_E_CALL_DENIED',
      `"${callee.name}" is not a callable this grammar offers — a value held in state is never invocable`,
      at,
    );
  }

  if (callee.k !== 'Member' && callee.k !== 'Computed') {
    throw exprError('FORMA_E_CALL_DENIED', 'only allowlisted methods can be called', at);
  }

  const recv = evalExpr(callee.object, ctx);
  if (recv === null || recv === undefined) return undefined;
  const method = callee.k === 'Member'
    ? callee.key
    : safeKey(evalExpr(callee.key, ctx), callee.key.i);
  const kind = kindOf(recv);

  if (kind === 'host') return callHostMethod(recv as Host, method, node.args, ctx, at);

  const tbl = kind === 'array'
    ? ARRAY_METHODS
    : kind === 'string'
      ? STRING_METHODS
      : kind === 'number'
        ? NUMBER_METHODS
        : null;

  if (!tbl || !Object.hasOwn(tbl, method)) {
    throw exprError(
      'FORMA_E_METHOD_DENIED',
      `no method "${method}" is offered for a ${describeKind(recv)} value`,
      at,
    );
  }

  const callbackParams = Object.hasOwn(HOF_CALLBACK_PARAMS, method) ? HOF_CALLBACK_PARAMS[method]! : null;
  const args: unknown[] = [];
  node.args.forEach((argNode, index) => {
    if (index === 0 && callbackParams !== null) args.push(makeCallback(argNode, ctx, callbackParams, at));
    else args.push(evalArg(argNode, ctx));
  });

  if (kind === 'string' && (method === 'at' || method === 'charAt' || method === 'charCodeAt')) {
    copied(ctx, callee.object, recv, at);
  }
  const names = (NAMES[kind] ??= Object.create(null) as Record<string, string>);
  preflight(ctx, (names[method] ??= `${kind}.${method}`), recv, args, at);
  guardArgs(method, args, at);
  if (method === 'flatMap' && typeof args[0] === 'function') {
    // Each array the callback returns is copied into the result: charged as
    // it is returned, before flatMap copies it.
    const cb = args[0] as (...a: unknown[]) => unknown;
    args[0] = (...a: unknown[]) => {
      const out = cb(...a);
      if (Array.isArray(out)) charge(ctx, out.length, 'flatMap', at);
      return out;
    };
  }
  const receiver = ARRAY_COPY_FIRST.has(method) ? (recv as unknown[]).slice() : recv;
  return checkResultSize(Reflect.apply(tbl[method]!, receiver, args), at);
}

/**
 * Element methods that write an attribute. These are the interpreter's share of
 * the shared renderer contract: an expression may compute the name and the
 * value from state, so `$el.setAttribute(k, url)` is an attacker-reachable
 * attribute sink exactly like `data-bind:` and `h()`, and it drops exactly what
 * they drop. Without this the CSP-safe grammar was the one sink in the repo
 * with no guard at all.
 *
 * The proof is the shared table, run against this sink alongside the other
 * five — see the `renderer contract ['$el.setAttribute']` rows.
 *
 * Verified by: src/__tests__/renderer-contract.test.ts > "drops every script scheme written to %s"
 * Verified by: src/__tests__/renderer-contract.test.ts > "never writes %s as an attribute"
 */
const ATTR_WRITE_METHODS: ReadonlySet<string> = new Set(['setAttribute', 'toggleAttribute']);

function guardAttrWrite(host: Host, method: string, args: unknown[], at: number): void {
  const el = host.target as Element;
  const name = String(args[0] ?? '');
  if (!isSafeAttrName(name)) {
    throw exprError(
      'FORMA_E_METHOD_DENIED',
      `${host.label}.${method}("${name}") — that is not a well-formed attribute name`,
      at,
    );
  }
  // toggleAttribute writes a bare attribute, i.e. the empty value.
  const value = method === 'setAttribute' ? String(args[1] ?? '') : '';
  if (isUnsafeAttrWrite(el.localName, name, value)) {
    throw exprError(
      'FORMA_E_METHOD_DENIED',
      `${host.label}.${method}("${name}") would create an XSS sink on <${el.localName}>`,
      at,
    );
  }
}

function callHostMethod(host: Host, method: string, argNodes: Expr[], ctx: EvalCtx, at: number): unknown {
  const args = argNodes.map((a) => evalArg(a, ctx));

  if (host.kind === 'namespace' || host.kind === 'fn') {
    const members = host.members;
    const fn = members && Object.hasOwn(members, method) ? members[method] : undefined;
    if (typeof fn !== 'function') {
      throw exprError('FORMA_E_METHOD_DENIED', `${host.label}.${method} is not on the allowlist`, at);
    }
    preflight(ctx, `${host.label}.${method}`, undefined, args, at);
    return checkResultSize(Reflect.apply(fn as (...a: unknown[]) => unknown, undefined, args), at);
  }

  const allowed = host.kind === 'element'
    ? ELEMENT_METHODS
    : host.kind === 'event'
      ? EVENT_METHODS
      : host.kind === 'classList'
        ? CLASSLIST_METHODS
        : host.kind === 'style'
          ? STYLE_METHODS
          : null;

  if (!allowed || !allowed.has(method)) {
    throw exprError('FORMA_E_METHOD_DENIED', `${host.label}.${method}() is not on the allowlist`, at);
  }
  // A DOM method converts its arguments to strings.
  preflight(ctx, `${host.label}.${method}`, undefined, args, at);
  if (host.kind === 'style' && method === 'setProperty' && STYLE_DENY_PROPS.has(String(args[0]))) {
    throw exprError('FORMA_E_METHOD_DENIED', `style.setProperty("${String(args[0])}") is not available`, at);
  }
  if (host.kind === 'element' && ATTR_WRITE_METHODS.has(method)) {
    guardAttrWrite(host, method, args, at);
  }

  const target = host.target as Record<string, unknown>;
  const fn = Reflect.get(target, method);
  if (typeof fn !== 'function') {
    throw exprError('FORMA_E_METHOD_DENIED', `${host.label}.${method}() is unavailable here`, at);
  }
  const result = Reflect.apply(fn as (...a: unknown[]) => unknown, target, args);

  if (host.kind === 'element' && Object.hasOwn(ELEMENT_METHOD_RESULT, method)) {
    const as = ELEMENT_METHOD_RESULT[method]!;
    if (as === 'element') return wrapElement(result, `${host.label}.${method}()`);
    if (as === 'elementList') return toElementList(result, `${host.label}.${method}()`);
    const rect = result as Record<string, unknown> | null;
    const plain: Record<string, number> = {};
    for (const k of RECT_KEYS) plain[k] = Number(rect?.[k] ?? 0);
    return plain;
  }
  return checkResultSize(result, at);
}

export function evalExpr(node: Expr, ctx: EvalCtx): unknown {
  step(ctx, node.i);

  switch (node.k) {
    case 'Literal':
      return node.value;

    case 'Identifier':
      return resolveIdent(node.name, ctx, node.i);

    case 'Template': {
      let out = node.quasis[0] ?? '';
      for (let i = 0; i < node.exprs.length; i++) {
        const value = evalExpr(node.exprs[i]!, ctx);
        coerce(ctx, value, node.i);
        out += value === null || value === undefined ? '' : stringify(value, node.i);
        out += node.quasis[i + 1] ?? '';
        if (out.length > LIMITS.MAX_STRING_LENGTH) {
          throw exprError('FORMA_E_BUDGET', 'the resulting string is too large', node.i);
        }
      }
      grow(ctx, out, node.i);
      return out;
    }

    case 'ArrayLit':
      return node.elements.map((e) => evalExpr(e, ctx));

    case 'ObjectLit': {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < node.keys.length; i++) {
        out[safeKey(node.keys[i], node.i)] = evalExpr(node.values[i]!, ctx);
      }
      return out;
    }

    case 'Unary': {
      if (node.op === 'typeof') return typeof evalExpr(node.arg, ctx);
      const v = evalExpr(node.arg, ctx);
      if (node.op === '!') return !v;
      coerce(ctx, v, node.i);
      parse(ctx, v, node.i);
      if (node.op === '-') return -(v as number);
      return +(v as number);
    }

    case 'Logical': {
      const left = evalExpr(node.left, ctx);
      if (node.op === '&&') return left ? evalExpr(node.right, ctx) : left;
      if (node.op === '||') return left ? left : evalExpr(node.right, ctx);
      return left ?? evalExpr(node.right, ctx);
    }

    case 'Conditional':
      return evalExpr(node.test, ctx) ? evalExpr(node.then, ctx) : evalExpr(node.else, ctx);

    case 'Binary': {
      const l = evalExpr(node.left, ctx) as any;
      const r = evalExpr(node.right, ctx) as any;
      // Switched through a local so the exhaustiveness check below narrows the
      // OPERATOR to never, not the node it came from.
      const op: BinaryOp = node.op;
      // `==` and `!=` convert an object only against a primitive that is not
      // null or undefined: `x != null` and object-to-object compare nothing.
      // Verified by: src/expr/__tests__/native-cost.test.ts > "loose equality charges only an operand it converts"
      if (
        op !== '===' && op !== '!==' &&
        !((op === '==' || op === '!=') && (l == null || r == null || typeof l === typeof r))
      ) {
        coerce(ctx, l, node.i);
        coerce(ctx, r, node.i);
      }
      if (op !== '+' && scan(ctx, op, l, r, node.i)) {
        copied(ctx, node.left, l, node.i);
        copied(ctx, node.right, r, node.i);
      }
      switch (op) {
        case '===': return l === r;
        case '!==': return l !== r;
        // eslint-disable-next-line eqeqeq -- `==` is a documented operator of this grammar
        case '==': return l == r;
        // eslint-disable-next-line eqeqeq
        case '!=': return l != r;
        case '<': return l < r;
        case '>': return l > r;
        case '<=': return l <= r;
        case '>=': return l >= r;
        case '+': {
          if (isHost(l) || isHost(r)) {
            throw exprError('FORMA_E_PROPERTY_DENIED', 'a host value cannot be concatenated', node.i);
          }
          const sum = checkResultSize(l + r, node.i);
          grow(ctx, sum, node.i);
          return sum;
        }
        case '-': return l - r;
        case '*': return l * r;
        case '/': return l / r;
        case '%': return l % r;
        default: {
          const never: never = op;
          throw exprError('FORMA_E_UNSUPPORTED', `unknown operator ${String(never)}`, node.i);
        }
      }
    }

    case 'Member':
      return safeRead(evalExpr(node.object, ctx), node.key, node.i, node.optional);

    case 'Computed': {
      const obj = evalExpr(node.object, ctx);
      if (obj === null || obj === undefined) return undefined;
      copied(ctx, node.object, obj, node.i);
      return safeRead(obj, evalExpr(node.key, ctx), node.i, node.optional);
    }

    case 'Call':
      return evalCall(node, ctx);

    case 'Arrow':
      // Unreachable through `compile()` — the validator rejects an arrow in any
      // position but a callback slot, and callback slots never evaluate the
      // node, they wrap it. Re-asserted here because the interpreter does not
      // trust the validator (G4).
      throw exprError('FORMA_E_UNSUPPORTED', 'a function is not a value in this grammar', node.i);

    default: {
      const never: never = node;
      throw exprError('FORMA_E_UNSUPPORTED', `unhandled node ${JSON.stringify(never)}`, 0);
    }
  }
}

/**
 * String coercion for template interpolation. A host value would render as
 * `[object Object]` and leak nothing, but saying so is better than showing it.
 */
function stringify(value: unknown, at: number): string {
  if (isHost(value)) {
    throw exprError('FORMA_E_PROPERTY_DENIED', `${value.label} cannot be rendered as text`, at);
  }
  return String(value);
}

// ── Statements ──

function writeMember(recv: unknown, key: string, value: unknown, at: number): void {
  const kind = kindOf(recv);

  if (kind === 'host') {
    const host = recv as Host;
    const target = host.target as Record<string, unknown>;
    if (host.kind === 'element') {
      if (!ELEMENT_WRITE_PROPS.has(key)) {
        throw exprError('FORMA_E_ASSIGN_DENIED', `${host.label}.${key} is not writable`, at);
      }
      Reflect.set(target, key, value);
      return;
    }
    if (host.kind === 'style') {
      if (STYLE_DENY_PROPS.has(key)) {
        throw exprError('FORMA_E_ASSIGN_DENIED', `style.${key} is not writable`, at);
      }
      Reflect.set(target, key, value === null || value === undefined ? '' : String(value));
      return;
    }
    if (host.kind === 'dataset') {
      Reflect.set(target, key, value === null || value === undefined ? '' : String(value));
      return;
    }
    throw exprError('FORMA_E_ASSIGN_DENIED', `${host.label} is read-only`, at);
  }

  if (kind === 'object' || kind === 'array') {
    if (kind === 'array' && key === 'length') {
      throw exprError('FORMA_E_ASSIGN_DENIED', 'array length is not writable', at);
    }
    // An index past the end gives the array that length, sparse, and whatever
    // iterates it next (a scan, `data-list`) visits every hole. A write may
    // not grow an array past what one evaluation may build.
    // Verified by: src/expr/__tests__/native-cost.test.ts > "a handler cannot grow an array past the allocation budget"
    if (
      kind === 'array' && /^\d+$/.test(key) &&
      Number(key) >= LIMITS.ALLOC_BUDGET && Number(key) >= (recv as unknown[]).length
    ) {
      throw exprError('FORMA_E_BUDGET', `array index ${key} would grow the array past ${LIMITS.ALLOC_BUDGET} elements`, at);
    }
    const desc = Object.getOwnPropertyDescriptor(recv as object, key);
    if (desc && !Object.hasOwn(desc, 'value')) {
      throw exprError('FORMA_E_ASSIGN_DENIED', `"${key}" is an accessor property`, at);
    }
    Reflect.set(recv as object, key, value);
    return;
  }

  throw exprError('FORMA_E_ASSIGN_DENIED', `cannot assign to a property of a ${describeKind(recv)} value`, at);
}

function applyOp(
  ctx: EvalCtx,
  at: number,
  op: '=' | '+=' | '-=' | '*=' | '/=',
  current: unknown,
  operand: unknown,
): unknown {
  if (op !== '=') {
    coerce(ctx, current, at);
    coerce(ctx, operand, at);
  }
  if (op !== '=' && op !== '+=') {
    parse(ctx, current, at);
    parse(ctx, operand, at);
  }
  switch (op) {
    case '=': return operand;
    case '+=': {
      // The same string `+` builds, with the same 1 MiB cap.
      const sum = checkResultSize((current as number) + (operand as number), at);
      grow(ctx, sum, at);
      return sum;
    }
    case '-=': return (current as number) - (operand as number);
    case '*=': return (current as number) * (operand as number);
    case '/=': return (current as number) / (operand as number);
    default: {
      const never: never = op;
      return never;
    }
  }
}

function runStmt(stmt: Stmt, ctx: EvalCtx): void {
  step(ctx, stmt.i);

  switch (stmt.k) {
    case 'ExprStmt':
      evalExpr(stmt.expr, ctx);
      return;

    case 'Assign': {
      const target = stmt.target;
      if (target.k === 'Identifier') {
        const setter = ctx.scope.setters[target.name];
        if (typeof setter !== 'function') {
          throw exprError(
            'FORMA_E_ASSIGN_DENIED',
            `"${target.name}" is not a writable state key in this scope`,
            target.i,
          );
        }
        const current = stmt.op === '=' ? undefined : resolveIdent(target.name, ctx, target.i);
        setter(applyOp(ctx, target.i, stmt.op, current, evalExpr(stmt.value, ctx)));
        return;
      }
      const recv = evalExpr(target.object, ctx);
      if (recv === null || recv === undefined) {
        throw exprError('FORMA_E_ASSIGN_DENIED', 'cannot assign to a property of null', target.i);
      }
      const key = target.k === 'Member' ? target.key : safeKey(evalExpr(target.key, ctx), target.i);
      const current = stmt.op === '=' ? undefined : safeRead(recv, key, target.i, false);
      const value = applyOp(ctx, target.i, stmt.op, current, evalExpr(stmt.value, ctx));
      // A DOM property or style write converts the value to a string.
      if (isHost(recv)) coerce(ctx, value, target.i);
      writeMember(recv, safeKey(key, target.i), value, target.i);
      return;
    }

    case 'Update': {
      const delta = stmt.op === '++' ? 1 : -1;
      const target = stmt.target;
      if (target.k === 'Identifier') {
        const setter = ctx.scope.setters[target.name];
        if (typeof setter !== 'function') {
          throw exprError(
            'FORMA_E_ASSIGN_DENIED',
            `"${target.name}" is not a writable state key in this scope`,
            target.i,
          );
        }
        setter(applyOp(ctx, target.i, '+=', resolveIdent(target.name, ctx, target.i), delta));
        return;
      }
      const recv = evalExpr(target.object, ctx);
      if (recv === null || recv === undefined) {
        throw exprError('FORMA_E_ASSIGN_DENIED', 'cannot assign to a property of null', target.i);
      }
      const key = safeKey(
        target.k === 'Member' ? target.key : evalExpr(target.key, ctx),
        target.i,
      );
      writeMember(recv, key, applyOp(ctx, target.i, '+=', safeRead(recv, key, target.i, false), delta), target.i);
      return;
    }

    case 'If':
      if (evalExpr(stmt.test, ctx)) {
        for (const s of stmt.then) runStmt(s, ctx);
      } else {
        for (const s of stmt.else ?? []) runStmt(s, ctx);
      }
      return;

    default: {
      const never: never = stmt;
      throw exprError('FORMA_E_UNSUPPORTED', `unhandled statement ${JSON.stringify(never)}`, 0);
    }
  }
}

export function runProgram(stmts: Stmt[], ctx: EvalCtx): void {
  for (const stmt of stmts) runStmt(stmt, ctx);
}

export type { FormaExprError };
