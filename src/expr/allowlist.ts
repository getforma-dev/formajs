/**
 * THE ALLOWLIST. Every capability this expression language has is a row in this
 * file, and nowhere else.
 *
 * The design rule, written down so it survives the next feature request:
 * **any request to support X is answered by adding X to a table here, never by
 * widening dispatch.** If X cannot be expressed as a table entry, the answer is
 * no. See CONTRIBUTING.md, "The expression allowlist".
 *
 * `allowlist-snapshot.test.ts` asserts the exact sorted name list, so a new
 * capability cannot land without a reviewer seeing the diff of that snapshot in
 * the same change.
 * Verified by: src/expr/__tests__/allowlist-snapshot.test.ts > "the allowlist is exactly this set of names"
 *
 * This is the one file under src/expr/ exempt from the escape-hatch grep gate:
 * the deny list has to name the keys it denies, and the method tables have to
 * capture intrinsics off `Array.prototype` and friends.
 */
import { hostFn, hostNamespace, type Host } from './host';

/**
 * Keys no receiver ever exposes, whatever the syntax that produced them —
 * `.constructor`, `['constructor']`, `[k]` where k came from server JSON, or a
 * template-literal key. `safeKey` applies this at RUNTIME to the evaluated key,
 * which is what makes every spelling of the bypass equivalent and equally dead.
 * Verified by: src/expr/__tests__/adversarial.test.ts > "every spelling of a constructor reach is denied"
 */
export const DENY_KEYS: ReadonlySet<string> = new Set([
  'constructor',
  '__proto__',
  'prototype',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'eval',
  'Function',
  'call',
  'apply',
  'bind',
  'caller',
  'callee',
  'arguments',
]);

/** Longest key we will look up. Bounds the cost of a hostile computed key. */
export const MAX_KEY_LENGTH = 128;

type Fn = (...args: never[]) => unknown;

function table(entries: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.assign(Object.create(null) as Record<string, unknown>, entries));
}

// ── Data-receiver methods (captured intrinsics, frozen at module init) ──
//
// These are read from `Array.prototype` / `String.prototype` ONCE, here. The
// interpreter calls `Reflect.apply(TABLE[m], recv, args)`, so a receiver that
// carries its own `filter` never contributes it, and another script poisoning
// `Array.prototype.filter` later cannot change what we invoke.
// Verified by: src/expr/__tests__/adversarial.test.ts > "a poisoned Array.prototype.filter is not what runs"

const AP = Array.prototype;
const SP = String.prototype;
const NP = Number.prototype;

/** Non-mutating array methods. `sort`/`reverse` run on a defensive copy. */
export const ARRAY_METHODS = table({
  at: AP.at,
  concat: AP.concat,
  every: AP.every,
  filter: AP.filter,
  find: AP.find,
  findIndex: AP.findIndex,
  flat: AP.flat,
  flatMap: AP.flatMap,
  includes: AP.includes,
  indexOf: AP.indexOf,
  join: AP.join,
  lastIndexOf: AP.lastIndexOf,
  map: AP.map,
  reduce: AP.reduce,
  reverse: AP.reverse,
  slice: AP.slice,
  some: AP.some,
  sort: AP.sort,
}) as Readonly<Record<string, Fn>>;

/** Array methods that must never see the live array — they mutate in place. */
export const ARRAY_COPY_FIRST: ReadonlySet<string> = new Set(['sort', 'reverse']);

export const STRING_METHODS = table({
  at: SP.at,
  charAt: SP.charAt,
  charCodeAt: SP.charCodeAt,
  concat: SP.concat,
  endsWith: SP.endsWith,
  includes: SP.includes,
  indexOf: SP.indexOf,
  lastIndexOf: SP.lastIndexOf,
  padEnd: SP.padEnd,
  padStart: SP.padStart,
  repeat: SP.repeat,
  replace: SP.replace,
  replaceAll: SP.replaceAll,
  slice: SP.slice,
  split: SP.split,
  startsWith: SP.startsWith,
  substring: SP.substring,
  toLowerCase: SP.toLowerCase,
  toUpperCase: SP.toUpperCase,
  trim: SP.trim,
  trimEnd: SP.trimEnd,
  trimStart: SP.trimStart,
}) as Readonly<Record<string, Fn>>;

export const NUMBER_METHODS = table({
  toFixed: NP.toFixed,
  toPrecision: NP.toPrecision,
  toString: NP.toString,
}) as Readonly<Record<string, Fn>>;

/**
 * Higher-order array methods and the maximum number of parameters their
 * callback may declare. An arrow function is legal ONLY in argument slot 0 of
 * one of these — that positional rule is what stops arrows becoming values.
 * Verified by: src/expr/__tests__/validate.test.ts > "an arrow outside a callback slot is a validation error"
 */
export const HOF_CALLBACK_PARAMS: Readonly<Record<string, number>> = table({
  every: 2,
  filter: 2,
  find: 2,
  findIndex: 2,
  flatMap: 2,
  map: 2,
  reduce: 3,
  some: 2,
  sort: 2,
}) as Readonly<Record<string, number>>;

// ── DOM host tables ──
//
// Host receivers differ from data receivers in one way, stated plainly: their
// target is a DOM object the RUNTIME created and wrapped, never a value that
// came from state, JSON or an attribute. So the method is looked up on that
// target rather than from a captured intrinsic — there is no attacker-supplied
// receiver to impersonate one. The name must still be in the fixed table below.

/** Element properties an expression may read. */
export const ELEMENT_READ_PROPS: ReadonlySet<string> = new Set([
  'checked', 'childElementCount', 'className', 'clientHeight', 'clientWidth',
  'disabled', 'hidden', 'id', 'innerText', 'max', 'min', 'name', 'nodeName',
  'offsetHeight', 'offsetLeft', 'offsetTop', 'offsetWidth', 'pattern',
  'placeholder', 'readOnly', 'required', 'scrollHeight', 'scrollLeft',
  'scrollTop', 'scrollWidth', 'selected', 'step', 'tagName', 'textContent',
  'type', 'value',
]);

/** Element properties an expression may write. A strict subset of the reads. */
export const ELEMENT_WRITE_PROPS: ReadonlySet<string> = new Set([
  'checked', 'className', 'disabled', 'hidden', 'id', 'innerText', 'max', 'min',
  'name', 'pattern', 'placeholder', 'readOnly', 'required', 'scrollLeft',
  'scrollTop', 'selected', 'step', 'textContent', 'type', 'value',
]);

/** Element methods an expression may call. */
export const ELEMENT_METHODS: ReadonlySet<string> = new Set([
  'blur', 'click', 'closest', 'focus', 'getAttribute', 'getBoundingClientRect',
  'hasAttribute', 'matches', 'querySelector', 'querySelectorAll',
  'removeAttribute', 'scrollIntoView', 'setAttribute', 'toggleAttribute',
]);

/** Element properties that yield another host rather than a plain value. */
export const ELEMENT_HOST_PROPS: Readonly<Record<string, 'classList' | 'style' | 'dataset' | 'element' | 'elementList'>> =
  table({
    classList: 'classList',
    dataset: 'dataset',
    style: 'style',
    children: 'elementList',
    firstElementChild: 'element',
    lastElementChild: 'element',
    nextElementSibling: 'element',
    previousElementSibling: 'element',
  }) as Readonly<Record<string, 'classList' | 'style' | 'dataset' | 'element' | 'elementList'>>;

/** Element methods whose result is an element (or list of elements). */
export const ELEMENT_METHOD_RESULT: Readonly<Record<string, 'element' | 'elementList' | 'rect'>> = table({
  closest: 'element',
  querySelector: 'element',
  querySelectorAll: 'elementList',
  getBoundingClientRect: 'rect',
}) as Readonly<Record<string, 'element' | 'elementList' | 'rect'>>;

/** Plain-data view of a DOMRect — the real one is not a plain object. */
export const RECT_KEYS: readonly string[] = ['x', 'y', 'width', 'height', 'top', 'right', 'bottom', 'left'];

/** Event properties an expression may read. */
export const EVENT_READ_PROPS: ReadonlySet<string> = new Set([
  'altKey', 'button', 'clientX', 'clientY', 'code', 'ctrlKey', 'deltaX',
  'deltaY', 'detail', 'isTrusted', 'key', 'metaKey', 'repeat', 'shiftKey',
  'type',
]);

/** Event methods an expression may call. */
export const EVENT_METHODS: ReadonlySet<string> = new Set([
  'preventDefault', 'stopImmediatePropagation', 'stopPropagation',
]);

/** Event properties that yield an element host. */
export const EVENT_HOST_PROPS: ReadonlySet<string> = new Set(['currentTarget', 'target']);

export const CLASSLIST_METHODS: ReadonlySet<string> = new Set([
  'add', 'contains', 'remove', 'replace', 'toggle',
]);
export const CLASSLIST_READ_PROPS: ReadonlySet<string> = new Set(['length', 'value']);

export const STYLE_METHODS: ReadonlySet<string> = new Set([
  'getPropertyValue', 'removeProperty', 'setProperty',
]);

/**
 * `style` accepts any CSSOM property name, with one exception: `cssText` is a
 * whole-declaration STRING assignment, which is precisely the sink a strict
 * `style-src` blocks and which CSP.md promises FormaJS does not use.
 * Verified by: src/expr/__tests__/adversarial.test.ts > "$el.style.cssText is denied"
 */
export const STYLE_DENY_PROPS: ReadonlySet<string> = new Set(['cssText']);

// ── Frozen global namespaces ──
//
// Captured intrinsics in interpreter-owned tables. Identifier resolution NEVER
// consults `globalThis`, so `document`, `fetch`, `window` and `localStorage`
// are unreachable rather than blocked — there is no lookup that could find them.
// Verified by: src/expr/__tests__/adversarial.test.ts > "no global is reachable by name"

export const SAFE_GLOBALS: Readonly<Record<string, Host>> = table({
  Math: hostNamespace('Math', {
    abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
    trunc: Math.trunc, sign: Math.sign, min: Math.min, max: Math.max,
    pow: Math.pow, sqrt: Math.sqrt, cbrt: Math.cbrt, log: Math.log,
    log2: Math.log2, log10: Math.log10, exp: Math.exp, random: Math.random,
    hypot: Math.hypot, PI: Math.PI, E: Math.E,
  }),
  JSON: hostNamespace('JSON', { parse: JSON.parse, stringify: JSON.stringify }),
  Object: hostNamespace('Object', {
    entries: Object.entries, keys: Object.keys, values: Object.values,
  }),
  Array: hostNamespace('Array', { from: Array.from, isArray: Array.isArray, of: Array.of }),
  Date: hostNamespace('Date', { now: Date.now }),
  Number: hostFn('Number', Number as unknown as Fn, 1, {
    EPSILON: Number.EPSILON,
    MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
    MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER,
    isFinite: Number.isFinite,
    isInteger: Number.isInteger,
    isNaN: Number.isNaN,
    parseFloat: Number.parseFloat,
    parseInt: Number.parseInt,
  }),
  String: hostFn('String', String as unknown as Fn, 1, { fromCharCode: String.fromCharCode }),
  Boolean: hostFn('Boolean', Boolean as unknown as Fn, 1),
  parseInt: hostFn('parseInt', parseInt as unknown as Fn, 2),
  parseFloat: hostFn('parseFloat', parseFloat as unknown as Fn, 1),
}) as Readonly<Record<string, Host>>;

/**
 * Every name this language grants, flattened and sorted. The snapshot test
 * compares against this, so widening any table above is visible in review.
 */
export function allowlistSnapshot(): string[] {
  const names: string[] = [];
  const push = (group: string, keys: Iterable<string>): void => {
    for (const k of keys) names.push(`${group}.${k}`);
  };
  push('array', Object.keys(ARRAY_METHODS));
  push('string', Object.keys(STRING_METHODS));
  push('number', Object.keys(NUMBER_METHODS));
  push('hof', Object.keys(HOF_CALLBACK_PARAMS));
  push('element:read', ELEMENT_READ_PROPS);
  push('element:write', ELEMENT_WRITE_PROPS);
  push('element:method', ELEMENT_METHODS);
  push('element:host', Object.keys(ELEMENT_HOST_PROPS));
  push('event:read', EVENT_READ_PROPS);
  push('event:method', EVENT_METHODS);
  push('event:host', EVENT_HOST_PROPS);
  push('classList:method', CLASSLIST_METHODS);
  push('classList:read', CLASSLIST_READ_PROPS);
  push('style:method', STYLE_METHODS);
  push('style:deny', STYLE_DENY_PROPS);
  push('deny', DENY_KEYS);
  for (const [name, host] of Object.entries(SAFE_GLOBALS)) {
    names.push(`global.${name}`);
    for (const member of Object.keys(host.members ?? {})) names.push(`global.${name}.${member}`);
  }
  return names.sort();
}
