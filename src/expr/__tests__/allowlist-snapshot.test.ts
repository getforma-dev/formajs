/**
 * The capability ledger.
 *
 * `allowlistSnapshot()` flattens every table in allowlist.ts into one sorted
 * list of names, and this test pins that list literally. The point is social,
 * not technical: widening the grammar means editing this array in the same
 * change, so every capability grant lands in front of a reviewer as a diff of
 * a file whose only job is to say what this language can reach.
 *
 * When a row here legitimately changes, update the array — do not relax the
 * assertion. "The snapshot is annoying" is the mechanism working.
 *
 * The counterpart to this file is no-escape-hatch.test.ts, which asserts the
 * OTHER half: that no capability arrives except through these tables.
 */
import { describe, expect, it } from 'vitest';
import { allowlistSnapshot, SAFE_GLOBALS } from '../index';

/** Every name this expression language grants, sorted. */
const EXPECTED: readonly string[] = [
  "array.at",
  "array.concat",
  "array.every",
  "array.filter",
  "array.find",
  "array.findIndex",
  "array.flat",
  "array.flatMap",
  "array.includes",
  "array.indexOf",
  "array.join",
  "array.lastIndexOf",
  "array.map",
  "array.reduce",
  "array.reverse",
  "array.slice",
  "array.some",
  "array.sort",
  "classList:method.add",
  "classList:method.contains",
  "classList:method.remove",
  "classList:method.replace",
  "classList:method.toggle",
  "classList:read.length",
  "classList:read.value",
  "deny.Function",
  "deny.__defineGetter__",
  "deny.__defineSetter__",
  "deny.__lookupGetter__",
  "deny.__lookupSetter__",
  "deny.__proto__",
  "deny.apply",
  "deny.arguments",
  "deny.bind",
  "deny.call",
  "deny.callee",
  "deny.caller",
  "deny.constructor",
  "deny.eval",
  "deny.prototype",
  "element:host.children",
  "element:host.classList",
  "element:host.dataset",
  "element:host.firstElementChild",
  "element:host.lastElementChild",
  "element:host.nextElementSibling",
  "element:host.previousElementSibling",
  "element:host.style",
  "element:method.blur",
  "element:method.click",
  "element:method.closest",
  "element:method.focus",
  "element:method.getAttribute",
  "element:method.getBoundingClientRect",
  "element:method.hasAttribute",
  "element:method.matches",
  "element:method.querySelector",
  "element:method.querySelectorAll",
  "element:method.removeAttribute",
  "element:method.scrollIntoView",
  "element:method.setAttribute",
  "element:method.toggleAttribute",
  "element:read.checked",
  "element:read.childElementCount",
  "element:read.className",
  "element:read.clientHeight",
  "element:read.clientWidth",
  "element:read.disabled",
  "element:read.hidden",
  "element:read.id",
  "element:read.innerText",
  "element:read.max",
  "element:read.min",
  "element:read.name",
  "element:read.nodeName",
  "element:read.offsetHeight",
  "element:read.offsetLeft",
  "element:read.offsetTop",
  "element:read.offsetWidth",
  "element:read.pattern",
  "element:read.placeholder",
  "element:read.readOnly",
  "element:read.required",
  "element:read.scrollHeight",
  "element:read.scrollLeft",
  "element:read.scrollTop",
  "element:read.scrollWidth",
  "element:read.selected",
  "element:read.step",
  "element:read.tagName",
  "element:read.textContent",
  "element:read.type",
  "element:read.value",
  "element:write.checked",
  "element:write.className",
  "element:write.disabled",
  "element:write.hidden",
  "element:write.id",
  "element:write.innerText",
  "element:write.max",
  "element:write.min",
  "element:write.name",
  "element:write.pattern",
  "element:write.placeholder",
  "element:write.readOnly",
  "element:write.required",
  "element:write.scrollLeft",
  "element:write.scrollTop",
  "element:write.selected",
  "element:write.step",
  "element:write.textContent",
  "element:write.type",
  "element:write.value",
  "event:host.currentTarget",
  "event:host.target",
  "event:method.preventDefault",
  "event:method.stopImmediatePropagation",
  "event:method.stopPropagation",
  "event:read.altKey",
  "event:read.button",
  "event:read.clientX",
  "event:read.clientY",
  "event:read.code",
  "event:read.ctrlKey",
  "event:read.deltaX",
  "event:read.deltaY",
  "event:read.detail",
  "event:read.isTrusted",
  "event:read.key",
  "event:read.metaKey",
  "event:read.repeat",
  "event:read.shiftKey",
  "event:read.type",
  "global.Array",
  "global.Array.from",
  "global.Array.isArray",
  "global.Array.of",
  "global.Boolean",
  "global.Date",
  "global.Date.now",
  "global.JSON",
  "global.JSON.parse",
  "global.JSON.stringify",
  "global.Math",
  "global.Math.E",
  "global.Math.PI",
  "global.Math.abs",
  "global.Math.cbrt",
  "global.Math.ceil",
  "global.Math.exp",
  "global.Math.floor",
  "global.Math.hypot",
  "global.Math.log",
  "global.Math.log10",
  "global.Math.log2",
  "global.Math.max",
  "global.Math.min",
  "global.Math.pow",
  "global.Math.random",
  "global.Math.round",
  "global.Math.sign",
  "global.Math.sqrt",
  "global.Math.trunc",
  "global.Number",
  "global.Number.EPSILON",
  "global.Number.MAX_SAFE_INTEGER",
  "global.Number.MIN_SAFE_INTEGER",
  "global.Number.isFinite",
  "global.Number.isInteger",
  "global.Number.isNaN",
  "global.Number.parseFloat",
  "global.Number.parseInt",
  "global.Object",
  "global.Object.entries",
  "global.Object.keys",
  "global.Object.values",
  "global.String",
  "global.String.fromCharCode",
  "global.parseFloat",
  "global.parseInt",
  "hof.every",
  "hof.filter",
  "hof.find",
  "hof.findIndex",
  "hof.flatMap",
  "hof.map",
  "hof.reduce",
  "hof.some",
  "hof.sort",
  "number.toFixed",
  "number.toPrecision",
  "number.toString",
  "string.at",
  "string.charAt",
  "string.charCodeAt",
  "string.concat",
  "string.endsWith",
  "string.includes",
  "string.indexOf",
  "string.lastIndexOf",
  "string.padEnd",
  "string.padStart",
  "string.repeat",
  "string.replace",
  "string.replaceAll",
  "string.slice",
  "string.split",
  "string.startsWith",
  "string.substring",
  "string.toLowerCase",
  "string.toUpperCase",
  "string.trim",
  "string.trimEnd",
  "string.trimStart",
  "style:deny.cssText",
  "style:method.getPropertyValue",
  "style:method.removeProperty",
  "style:method.setProperty",];

describe('the expression allowlist', () => {
  it('the allowlist is exactly this set of names', () => {
    expect(allowlistSnapshot()).toEqual([...EXPECTED]);
  });

  it('grants nothing that reaches the network, storage, timers or code evaluation', () => {
    // A second, independent reading of the same list: even if someone updates
    // the array above without thinking, these names may never appear in it.
    const forbidden = [
      'eval', 'Function', 'constructor', 'prototype', '__proto__',
      'fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'sessionStorage',
      'indexedDB', 'setTimeout', 'setInterval', 'requestAnimationFrame',
      'import', 'require', 'process', 'globalThis', 'window', 'document',
      'innerHTML', 'outerHTML', 'srcdoc', 'insertAdjacentHTML', 'write',
      'call', 'apply', 'bind', 'ownerDocument', 'parentNode', 'defaultView',
    ];
    const granted = allowlistSnapshot()
      // `deny.*` rows are the deny list itself — naming a key there is the
      // opposite of granting it.
      .filter((n) => !n.startsWith('deny.'))
      .map((n) => n.slice(n.lastIndexOf('.') + 1));
    for (const name of forbidden) {
      expect(granted, `"${name}" must never be granted`).not.toContain(name);
    }
  });

  it('every global namespace is a frozen, null-prototype table of captured intrinsics', () => {
    // What an expression holds when it names `Math` is never the real `Math`:
    // it is a frozen wrapper whose members were read once, at module init. So
    // `Math.constructor` has nothing to surrender even before the key filter
    // refuses it, and a page script that later reassigns `window.Math` changes
    // nothing about what expressions see.
    expect(Object.isFrozen(SAFE_GLOBALS)).toBe(true);
    expect(Object.getPrototypeOf(SAFE_GLOBALS)).toBeNull();

    for (const [name, host] of Object.entries(SAFE_GLOBALS)) {
      const intrinsic = (globalThis as Record<string, unknown>)[name];
      expect(Object.isFrozen(host), name).toBe(true);
      expect(host as unknown, name).not.toBe(intrinsic);

      // A namespace wraps nothing; a callable wraps the captured intrinsic
      // itself, which is exactly the value `Reflect.apply` needs and is
      // reachable only through a Call node.
      if (host.kind === 'namespace') expect(host.target, name).toBeNull();
      else expect(host.target, name).toBe(intrinsic);

      if (host.members) {
        expect(Object.isFrozen(host.members), name).toBe(true);
        expect(Object.getPrototypeOf(host.members), name).toBeNull();
      }
    }
  });
});
