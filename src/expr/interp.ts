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

export interface ScopeLike {
  getters: Record<string, () => unknown>;
  setters: Record<string, (v: unknown) => void>;
}

interface Frame {
  names: string[];
  values: unknown[];
  parent: Frame | null;
}

export interface EvalCtx {
  scope: ScopeLike;
  frame: Frame | null;
  steps: number;
  budget: number;
}

/** Prototype of a plain object literal, captured once. */
const OBJECT_PROTO = Object.getPrototypeOf({}) as object;

let stepBudget: number = LIMITS.STEP_BUDGET;

/** Override the per-evaluation step budget (`data-forma-expr-budget`). */
export function setStepBudget(n: number): void {
  stepBudget = Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : LIMITS.STEP_BUDGET;
}

export function getStepBudget(): number {
  return stepBudget;
}

export function makeCtx(scope: ScopeLike): EvalCtx {
  return { scope, frame: null, steps: 0, budget: stepBudget };
}

function step(ctx: EvalCtx, at: number): void {
  if (++ctx.steps > ctx.budget) {
    throw exprError('FORMA_E_BUDGET', `expression exceeded its ${ctx.budget}-step budget`, at);
  }
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
  } else if (method === 'padStart' || method === 'padEnd') {
    const n = Number(args[0]);
    if (!(n >= 0) || n > LIMITS.MAX_STRING_LENGTH) {
      throw exprError('FORMA_E_BUDGET', 'pad length is too large', at);
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
      return Reflect.apply(fn, undefined, jsArgs.slice(0, arity));
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
      const args = node.args.map((a) => evalArg(a, ctx));
      return checkResultSize(
        Reflect.apply(target.target as (...a: unknown[]) => unknown, undefined, args.slice(0, target.maxArgs)),
        at,
      );
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

  guardArgs(method, args, at);
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
        out += value === null || value === undefined ? '' : stringify(value, node.i);
        out += node.quasis[i + 1] ?? '';
        if (out.length > LIMITS.MAX_STRING_LENGTH) {
          throw exprError('FORMA_E_BUDGET', 'the resulting string is too large', node.i);
        }
      }
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
          const sum = l + r;
          return checkResultSize(sum, node.i);
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
    const desc = Object.getOwnPropertyDescriptor(recv as object, key);
    if (desc && !Object.hasOwn(desc, 'value')) {
      throw exprError('FORMA_E_ASSIGN_DENIED', `"${key}" is an accessor property`, at);
    }
    Reflect.set(recv as object, key, value);
    return;
  }

  throw exprError('FORMA_E_ASSIGN_DENIED', `cannot assign to a property of a ${describeKind(recv)} value`, at);
}

function applyOp(op: '=' | '+=' | '-=' | '*=' | '/=', current: unknown, operand: unknown): unknown {
  switch (op) {
    case '=': return operand;
    case '+=': return (current as number) + (operand as number);
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
        setter(applyOp(stmt.op, current, evalExpr(stmt.value, ctx)));
        return;
      }
      const recv = evalExpr(target.object, ctx);
      if (recv === null || recv === undefined) {
        throw exprError('FORMA_E_ASSIGN_DENIED', 'cannot assign to a property of null', target.i);
      }
      const key = target.k === 'Member' ? target.key : safeKey(evalExpr(target.key, ctx), target.i);
      const current = stmt.op === '=' ? undefined : safeRead(recv, key, target.i, false);
      writeMember(recv, safeKey(key, target.i), applyOp(stmt.op, current, evalExpr(stmt.value, ctx)), target.i);
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
        setter((resolveIdent(target.name, ctx, target.i) as number) + delta);
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
      writeMember(recv, key, (safeRead(recv, key, target.i, false) as number) + delta, target.i);
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
