/**
 * Forma DOM - Element
 *
 * Hyperscript-style element factory (`h`) and Fragment helper.
 * Backed by alien-signals via forma/reactive.
 *
 * Supports both HTML and SVG elements with automatic namespace detection.
 * Provides event listener cleanup via AbortController.
 */

import { internalEffect, __DEV__ } from 'forma/reactive';
import { hydrating } from './hydrate.js';
import {
  isDangerousUrl,
  isEventHandlerAttr,
  isRawHtmlAttr,
  isUnsafeAttrWrite,
  isUrlAttr,
} from '../security/url-safety.js';

/**
 * Symbol used as JSX Fragment factory. h(Fragment, null, ...children) returns DocumentFragment.
 *
 * Typed as a callable for TypeScript's JSX checker — at runtime it's a symbol
 * that h() detects via `tag === Fragment`. esbuild transforms `<>...</>` into
 * `h(Fragment, null, ...)` which never actually calls Fragment.
 */
export const Fragment: (props: { children?: unknown }) => DocumentFragment =
  Symbol.for('forma.fragment') as any;

// ---------------------------------------------------------------------------
// SVG namespace and tag detection
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Tags that exist in BOTH HTML and SVG, so their namespace must be resolved by
 * context (not by name). Without an SVG context these resolve to HTML.
 */
const DUAL_USE_SVG_TAGS = new Set(['a', 'title', 'script', 'style', 'font']);

/** The namespace active for the current synchronous `svg()` build, if any. */
let currentNamespace: string | null = null;

/**
 * Run `build()` with the SVG namespace active so nested `h()` calls create
 * SVG-namespaced elements — including dual-use tags like `<a>` that `h()` would
 * otherwise create as HTML. `h()` resolves tags by this explicit context (there
 * is no automatic parent-walk); a `foreignObject` creates the SVG element but
 * does not auto-switch its descendants back to HTML (author those with plain
 * `h()` outside `svg()`). MathML is not supported.
 *
 * ```ts
 * const icon = svg(() => h('svg', { viewBox: '0 0 10 10' }, h('a', { href: '#' })));
 * ```
 */
export function svg<T extends Node>(build: () => T): T {
  const prev = currentNamespace;
  currentNamespace = SVG_NS;
  try {
    return build();
  } finally {
    currentNamespace = prev;
  }
}

/** Known SVG tag names for O(1) lookup. */
const SVG_TAGS = new Set([
  'svg',
  'path',
  'circle',
  'rect',
  'line',
  'polyline',
  'polygon',
  'ellipse',
  'g',
  'text',
  'tspan',
  'textPath',
  'defs',
  'use',
  'symbol',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'linearGradient',
  'radialGradient',
  'stop',
  'filter',
  'feGaussianBlur',
  'feColorMatrix',
  'feOffset',
  'feBlend',
  'feMerge',
  'feMergeNode',
  'feComposite',
  'feFlood',
  'feMorphology',
  'feTurbulence',
  'feDisplacementMap',
  'feImage',
  'foreignObject',
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
  'image',
  'switch',
  'desc',
  'title',
  'metadata',
]);

// ---------------------------------------------------------------------------
// Boolean HTML attributes (set/remove via setAttribute/removeAttribute)
// ---------------------------------------------------------------------------

const BOOLEAN_ATTRS = new Set([
  'disabled',
  'checked',
  'readonly',
  'required',
  'autofocus',
  'autoplay',
  'controls',
  'default',
  'defer',
  'formnovalidate',
  'hidden',
  'ismap',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'reversed',
  'selected',
  'async',
]);

// ---------------------------------------------------------------------------
// Element prototype cache. Rationale, not a measurement: one detached element
// per common tag is created on first use, and every later h('div') shallow-
// clones it instead of going back through createElement's tag-name validation.
// (An earlier version of this comment asserted "cloneNode is a C++ memcpy" and
// that it is "faster than createElement" — engine internals nobody here has
// benchmarked. The behaviour that IS load-bearing is that a clone is a fresh,
// detached, attribute-free element, which the tests cover.)
// ---------------------------------------------------------------------------

let ELEMENT_PROTOS: Record<string, HTMLElement> | null = null;

function getProto(tag: string): HTMLElement {
  if (!ELEMENT_PROTOS) {
    ELEMENT_PROTOS = Object.create(null);
    // Pre-create prototypes for the 30 most common HTML tags
    for (const t of [
      'div', 'span', 'p', 'a', 'li', 'ul', 'ol', 'button', 'input',
      'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'header',
      'footer', 'main', 'nav', 'table', 'tr', 'td', 'th', 'tbody',
      'img', 'form', 'select', 'option', 'textarea', 'i', 'b', 'strong',
      'em', 'small', 'article', 'aside', 'details', 'summary',
    ]) {
      ELEMENT_PROTOS![t] = document.createElement(t);
    }
  }
  return ELEMENT_PROTOS![tag] ?? (ELEMENT_PROTOS![tag] = document.createElement(tag));
}

// ---------------------------------------------------------------------------
// Event name cache — memoizes the `onClick` → `click` conversion so repeated
// bindings of the same prop name do not re-run slice + toLowerCase.
// ---------------------------------------------------------------------------

const EVENT_NAMES: Record<string, string> = Object.create(null);

function eventName(key: string): string {
  return EVENT_NAMES[key] ?? (EVENT_NAMES[key] = key.slice(2).toLowerCase());
}

// ---------------------------------------------------------------------------
// Symbol-based AbortController storage (avoids WeakMap overhead)
// ---------------------------------------------------------------------------

const ABORT_SYM = Symbol.for('forma-abort');

/** Get or lazily create an AbortController for an element. */
function getAbortController(el: Element): AbortController {
  let controller = (el as any)[ABORT_SYM] as AbortController | undefined;
  if (!controller) {
    controller = new AbortController();
    (el as any)[ABORT_SYM] = controller;
  }
  return controller;
}

/**
 * Remove all event listeners previously attached via `h()` on the given element.
 *
 * Calls `AbortController.abort()` for the element, which automatically removes
 * every listener that was registered with its signal. The controller is then
 * deleted so a fresh one is created if the element is reused.
 */
export function cleanup(el: Element): void {
  const controller = (el as any)[ABORT_SYM] as AbortController | undefined;
  if (controller) {
    controller.abort();
    delete (el as any)[ABORT_SYM];
  }
}

// ---------------------------------------------------------------------------
// Attribute diffing cache (avoids redundant DOM writes)
// ---------------------------------------------------------------------------

const CACHE_SYM = Symbol.for('forma-attr-cache');
const DYNAMIC_CHILD_SYM = Symbol.for('forma-dynamic-child');

function getCache(el: Element): Record<string, unknown> {
  return (el as any)[CACHE_SYM] ?? ((el as any)[CACHE_SYM] = Object.create(null));
}

// ---------------------------------------------------------------------------
// Prop handler functions (extracted for dispatch table)
// ---------------------------------------------------------------------------

type PropHandler = (el: Element, key: string, value: unknown) => void;

/**
 * Dev-only diagnostic for a prop the attribute-safety guards refused to write.
 * Silent in production, mirroring the SSR renderer, which drops the same props
 * without failing the render.
 */
function warnDropped(el: Element, key: string, reason: string): void {
  console.warn(
    `[forma] Dropped ${reason} prop "${key}" on <${el.localName}> — the SSR ` +
    `renderer drops it too, so allowing it here would re-introduce at hydration ` +
    `exactly what the server refused to emit.`,
  );
}

/**
 * Dev-only diagnostic for `srcdoc`, whose value the browser parses as an HTML
 * document. Attribute escaping does not neutralize it, so it is a
 * trusted-content sink; it is warned about, never blocked, because a sandboxed
 * `<iframe srcdoc>` is a legitimate pattern.
 */
function warnRawHtmlAttr(el: Element, key: string): void {
  console.warn(
    `[forma] "${key}" on <${el.localName}> is a raw-HTML sink: its value is ` +
    `parsed as an HTML document, and escaping does not neutralize it. Only pass ` +
    `trusted markup (and prefer a sandboxed iframe).`,
  );
}

/** Handle class / className prop. */
function handleClass(el: Element, _key: string, value: unknown): void {
  if (typeof value === 'function') {
    internalEffect(() => {
      const v = (value as () => string)();
      const cache = getCache(el);
      if (cache['class'] === v) return;
      cache['class'] = v;
      if (el instanceof HTMLElement) {
        el.className = v;
      } else {
        el.setAttribute('class', v);
      }
    });
  } else {
    const cache = getCache(el);
    if (cache['class'] === value) return;
    cache['class'] = value;
    if (el instanceof HTMLElement) {
      el.className = value as string;
    } else {
      el.setAttribute('class', value as string);
    }
  }
}

/**
 * Parse a CSS string (e.g. "color: red; font-size: 14px") into a style object.
 * Uses camelCase keys for CSSOM assignment via Object.assign(el.style, ...).
 * This avoids el.style.cssText which is blocked by strict CSP style-src policies.
 */
function parseCssString(css: string): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim();
    const val = decl.slice(colon + 1).trim();
    if (prop && val) {
      // kebab-case → camelCase (e.g. "font-size" → "fontSize")
      const camel = prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      obj[camel] = val;
    }
  }
  return obj;
}

/** Apply a style object to an element via CSSOM (CSP-safe). */
function applyStyleObj(el: Element, obj: Record<string, string>, prevKeys: string[]): string[] {
  const style = (el as HTMLElement | SVGElement).style;
  const nextKeys = Object.keys(obj);
  for (const k of prevKeys) {
    if (!(k in obj)) {
      style.removeProperty(k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
    }
  }
  Object.assign(style, obj);
  return nextKeys;
}

/**
 * Handle the `style` prop.
 *
 * A style string is parsed into declarations and written one property at a time
 * through the CSSOM (`el.style.foo = …` / `removeProperty`). Two consequences,
 * both load-bearing:
 *
 * - `cssText` is never assigned, and neither is the `style` content attribute.
 *   A `style-src` policy without `'unsafe-inline'` blocks writing that
 *   attribute but permits CSSOM property writes, which is why this path works
 *   on a CSP-hardened page. (The browser still reflects the resulting
 *   declaration block back into the attribute — that reflection is the
 *   browser's, not ours, and CSP does not block it.)
 * - A reactive style RECONCILES: a declaration present on the previous run and
 *   absent on this one is removed individually, rather than the whole block
 *   being rewritten.
 *
 * Verified by: src/dom/__tests__/element.test.ts > "reconciles a reactive style per declaration instead of rewriting the block"
 * Verified by: src/dom/__tests__/element.test.ts > "never assigns cssText anywhere in the element factory"
 */
function handleStyle(el: Element, _key: string, value: unknown): void {
  if (typeof value === 'function') {
    let prevKeys: string[] = [];
    internalEffect(() => {
      const v = (value as () => string | Record<string, string>)();
      if (typeof v === 'string') {
        const cache = getCache(el);
        if (cache['style'] === v) return;
        cache['style'] = v;
        prevKeys = applyStyleObj(el, parseCssString(v), prevKeys);
      } else if (v && typeof v === 'object') {
        prevKeys = applyStyleObj(el, v as Record<string, string>, prevKeys);
      }
    });
  } else if (typeof value === 'string') {
    const cache = getCache(el);
    if (cache['style'] === value) return;
    cache['style'] = value;
    applyStyleObj(el, parseCssString(value), []);
  } else if (value && typeof value === 'object') {
    Object.assign((el as HTMLElement | SVGElement).style, value);
  }
}

/** Handle event handler props (onClick, onInput, etc.). Cached eventName. */
function handleEvent(el: Element, key: string, value: unknown): void {
  const controller = getAbortController(el);
  el.addEventListener(
    eventName(key),
    value as EventListener,
    { signal: controller.signal },
  );
}

/**
 * Handle dangerouslySetInnerHTML prop.
 *
 * **Security:** No sanitization is performed. Never pass user-controlled
 * strings through `__html` — this will create an XSS vulnerability.
 * Only use with trusted, server-generated markup.
 *
 * Supports both static `{ __html: string }` values and reactive functions
 * that return `{ __html: string }`.
 */
function handleInnerHTML(el: Element, _key: string, value: unknown): void {
  if (typeof value === 'function') {
    internalEffect(() => {
      const resolved = (value as () => unknown)();
      if (resolved == null) {
        el.innerHTML = '';
        return;
      }
      if (typeof resolved !== 'object' || !('__html' in (resolved as any))) {
        throw new TypeError(
          'dangerouslySetInnerHTML: expected { __html: string }, got ' + typeof resolved,
        );
      }
      const html = (resolved as { __html: string }).__html;
      if (typeof html !== 'string') {
        throw new TypeError(
          'dangerouslySetInnerHTML: __html must be a string, got ' + typeof html,
        );
      }
      const cache = getCache(el);
      if (cache['innerHTML'] === html) return;
      cache['innerHTML'] = html;
      el.innerHTML = html;
    });
  } else {
    if (value == null) {
      el.innerHTML = '';
      return;
    }
    if (typeof value !== 'object' || !('__html' in (value as any))) {
      throw new TypeError(
        'dangerouslySetInnerHTML: expected { __html: string }, got ' + typeof value,
      );
    }
    const html = (value as { __html: string }).__html;
    if (typeof html !== 'string') {
      throw new TypeError(
        'dangerouslySetInnerHTML: __html must be a string, got ' + typeof html,
      );
    }
    el.innerHTML = html;
  }
}

/**
 * Handle xlink: namespaced SVG attributes.
 *
 * `xlink:href` is a URL attribute — on `<use>` it dereferences into a document
 * context — so every write goes through the same guard as `href`/`src`; a
 * rejected value removes the attribute rather than leaving a stale one.
 *
 * Verified by: src/dom/__tests__/element-url-safety.test.ts > "drops a javascript: xlink:href on <use>"
 */
function handleXLink(el: Element, key: string, value: unknown): void {
  const localName = key.slice(6); // strip "xlink:" prefix
  const write = (v: unknown): void => {
    if (v == null || v === false) {
      el.removeAttributeNS(XLINK_NS, localName);
      return;
    }
    const strVal = String(v);
    if (isUnsafeAttrWrite(el.localName, key, strVal)) {
      if (__DEV__) warnDropped(el, key, 'unsafe-URL');
      el.removeAttributeNS(XLINK_NS, localName);
      return;
    }
    el.setAttributeNS(XLINK_NS, key, strVal);
  };

  if (typeof value === 'function') {
    internalEffect(() => { write((value as () => unknown)()); });
  } else {
    write(value);
  }
}

/** Handle boolean attributes (disabled, checked, etc.). */
function handleBooleanAttr(el: Element, key: string, value: unknown): void {
  if (typeof value === 'function') {
    internalEffect(() => {
      const v = (value as () => boolean)();
      const cache = getCache(el);
      if (cache[key] === v) return;
      cache[key] = v;
      if (v) {
        el.setAttribute(key, '');
      } else {
        el.removeAttribute(key);
      }
    });
  } else {
    const cache = getCache(el);
    if (cache[key] === value) return;
    cache[key] = value;
    if (value) {
      el.setAttribute(key, '');
    } else {
      el.removeAttribute(key);
    }
  }
}

/**
 * Handle generic attributes with setAttribute/removeAttribute.
 *
 * This is the tail of the prop dispatch, so it is where an attacker-supplied
 * prop name/value lands. Two writes are refused here, matching what the SSR
 * renderer's `renderAttr` refuses:
 *
 * - any `on…`-named prop, in any casing. `applyProp`'s fast path only routes
 *   lowercase `on` to addEventListener, so `ONCLICK`/`Onerror` would otherwise
 *   reach setAttribute — which ASCII-lowercases qualified names on HTML
 *   elements and produces a live inline handler.
 * - a URL attribute carrying a script-executing scheme, checked against the
 *   element's tag so an image sink can still take `data:image/svg+xml`.
 *
 * A rejected reactive value removes the attribute instead of leaving the
 * previous (accepted) one in place, so the DOM never disagrees with the cache.
 *
 * Verified by: src/dom/__tests__/element-url-safety.test.ts > "drops an uppercase-cased function prop instead of stringifying it into an attribute"
 * Verified by: src/dom/__tests__/element-url-safety.test.ts > "drops a javascript: src on a reactive binding and removes the stale safe value"
 */
function handleGenericAttr(el: Element, key: string, value: unknown): void {
  if (isEventHandlerAttr(key)) {
    if (__DEV__) warnDropped(el, key, 'inline-event-handler');
    return;
  }
  if (__DEV__ && isRawHtmlAttr(key)) warnRawHtmlAttr(el, key);
  // `key` is fixed for this binding, so the (allocating) URL-attribute lookup
  // happens once, not on every reactive re-run.
  const urlAttr = isUrlAttr(key);

  const write = (v: unknown): void => {
    const cache = getCache(el);
    if (v != null && v !== false) {
      const strVal = String(v);
      if (!urlAttr || !isDangerousUrl(strVal, el.localName)) {
        if (cache[key] === strVal) return;
        cache[key] = strVal;
        el.setAttribute(key, strVal);
        return;
      }
      if (__DEV__) warnDropped(el, key, 'unsafe-URL');
    }
    if (cache[key] === null) return;
    cache[key] = null;
    el.removeAttribute(key);
  };

  if (typeof value === 'function') {
    internalEffect(() => { write((value as () => unknown)()); });
  } else {
    write(value);
  }
}

// ---------------------------------------------------------------------------
// Prop dispatch table (O(1) Map lookup replaces sequential if/else chain)
// ---------------------------------------------------------------------------

const PROP_HANDLERS = new Map<string, PropHandler>();

// Register specific prop handlers
PROP_HANDLERS.set('class', handleClass);
PROP_HANDLERS.set('className', handleClass);
PROP_HANDLERS.set('style', handleStyle);
PROP_HANDLERS.set('ref', () => {}); // no-op, handled in h()
PROP_HANDLERS.set('dangerouslySetInnerHTML', handleInnerHTML);

// Register boolean attrs into the dispatch table
for (const attr of BOOLEAN_ATTRS) {
  PROP_HANDLERS.set(attr, handleBooleanAttr);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Apply a single prop to an element (supports both HTML and SVG). */
function applyProp(el: Element, key: string, value: unknown): void {
  // "Twin Chassis" exploit: inline check for the #1 most common prop
  // String === is ~2ns vs Map.get() ~8ns. Saves 75% dispatch time for 'class'.
  if (key === 'class') { handleClass(el, key, value); return; }

  // 2. Event handler detection (2-char check, faster than startsWith)
  // Events are the #2 most common prop type — check before Map.
  // Deliberately case-SENSITIVE: only `onClick`-style props become listeners.
  // Other casings (`ONCLICK`) fall through to handleGenericAttr, which drops
  // them rather than writing an inline handler attribute — the same rule the
  // SSR renderer applies, so a tree renders identically on both sides.
  if (key.charCodeAt(0) === 111 /* 'o' */ && key.charCodeAt(1) === 110 /* 'n' */ && key.length > 2) {
    handleEvent(el, key, value); return;
  }

  // 3. Dispatch table for remaining known props (className, style, boolean attrs)
  const handler = PROP_HANDLERS.get(key);
  if (handler) { handler(el, key, value); return; }

  // 4. xlink: namespace (rare, check last)
  if (key.charCodeAt(0) === 120 /* 'x' */ && key.startsWith('xlink:')) {
    handleXLink(el, key, value); return;
  }

  // 5. Generic attribute fallback
  handleGenericAttr(el, key, value);
}

// ---------------------------------------------------------------------------
// "Blown Diffuser" — static prop fast path (no cache, no effects)
// Used only during h() initial element creation for non-function prop values.
// Saves: getCache() lookup, cache diff check, cache write — per static prop.
// ---------------------------------------------------------------------------

function applyStaticProp(el: Element, key: string, value: unknown): void {
  if (value == null || value === false) return;

  if (key === 'class' || key === 'className') {
    if (el instanceof HTMLElement) {
      el.className = value as string;
    } else {
      el.setAttribute('class', value as string);
    }
    return;
  }

  if (key === 'style') {
    if (typeof value === 'string') {
      applyStyleObj(el, parseCssString(value), []);
    } else if (value && typeof value === 'object') {
      Object.assign((el as HTMLElement | SVGElement).style, value);
    }
    return;
  }

  if (key === 'dangerouslySetInnerHTML') {
    if (typeof value !== 'object' || !('__html' in (value as any))) {
      throw new TypeError(
        'dangerouslySetInnerHTML: expected { __html: string }, got ' + typeof value,
      );
    }
    const html = (value as { __html: string }).__html;
    if (typeof html !== 'string') {
      throw new TypeError(
        'dangerouslySetInnerHTML: __html must be a string, got ' + typeof html,
      );
    }
    el.innerHTML = html;
    return;
  }

  // xlink: namespace
  if (key.charCodeAt(0) === 120 /* x */ && key.startsWith('xlink:')) {
    const strVal = String(value);
    if (isUnsafeAttrWrite(el.localName, key, strVal)) {
      if (__DEV__) warnDropped(el, key, 'unsafe-URL');
      return;
    }
    el.setAttributeNS(XLINK_NS, key, strVal);
    return;
  }

  // Boolean attrs
  if (BOOLEAN_ATTRS.has(key)) {
    if (value) el.setAttribute(key, '');
    return;
  }

  // Generic tail. This is the fast path an attacker-supplied prop reaches, so
  // it refuses the same writes as handleGenericAttr (and as the SSR renderer):
  // any `on…`-named prop — including the `value === true` case, which would
  // otherwise emit a bare `ONCLICK` attribute — and script-scheme URLs, checked
  // against the element's tag.
  // Verified by: src/dom/__tests__/element-url-safety.test.ts > "drops on* props in the value===true branch"
  if (isEventHandlerAttr(key)) {
    if (__DEV__) warnDropped(el, key, 'inline-event-handler');
    return;
  }
  if (__DEV__ && isRawHtmlAttr(key)) warnRawHtmlAttr(el, key);

  // true → empty string attribute, else stringified value
  if (value === true) {
    el.setAttribute(key, '');
    return;
  }
  const strVal = String(value);
  if (isUrlAttr(key) && isDangerousUrl(strVal, el.localName)) {
    if (__DEV__) warnDropped(el, key, 'unsafe-URL');
    return;
  }
  el.setAttribute(key, strVal);
}

/** Append a single child to a parent node. */
function appendChild(parent: Node, child: unknown): void {
  // Rationale for the branch ORDER, not a measured claim: the Node check is
  // first because nested h() calls are the common child in this codebase's own
  // trees, and `instanceof` on a primitive is rejected without walking a
  // prototype chain, so putting it first costs the other branches nothing.
  // (The earlier version of this comment asserted "70%+ of children are Nodes"
  // and "saves 3-5 comparisons"; neither figure was ever measured.)
  if (child instanceof Node) {
    parent.appendChild(child);
    return;
  }

  // "Track Limits": new Text() bypasses Document.createTextNode's validation.
  if (typeof child === 'string') {
    parent.appendChild(new Text(child));
    return;
  }

  // Null/false/true → skip (React-style conditional pattern)
  if (child == null || child === false || child === true) {
    return;
  }

  if (typeof child === 'number') {
    parent.appendChild(new Text(String(child)));
    return;
  }

  // Function child: reactive binding via signal getter.
  // The return value determines the binding type:
  //   - Node (from h() call) → append/replace as element
  //   - Array (from .map()) → wrap in DocumentFragment, append/replace
  //   - primitive (string/number/null) → bind as text
  if (typeof child === 'function') {
    if (parent instanceof Element) {
      (parent as any)[DYNAMIC_CHILD_SYM] = true;
    }
    let currentNode: Node | null = null;
    // Fragment children are tracked separately because DocumentFragment
    // empties itself on appendChild — we need to remove children manually.
    let currentFragChildren: Node[] | null = null;
    let warnedArray = false;
    const DEBUG = typeof (globalThis as any).__FORMA_DEBUG__ !== 'undefined';

    // Helper: remove all tracked fragment children or the single current node
    const clearCurrent = () => {
      if (currentFragChildren) {
        for (const c of currentFragChildren) {
          if (c.parentNode === parent) parent.removeChild(c);
        }
        currentFragChildren = null;
      }
      if (currentNode && currentNode.parentNode === parent) {
        parent.removeChild(currentNode);
      }
      currentNode = null;
    };

    internalEffect(() => {
      const v = (child as () => unknown)();

      // Array return (e.g. from .map()) → wrap in DocumentFragment
      let resolved: unknown = v;
      if (Array.isArray(v)) {
        const frag = document.createDocumentFragment();
        for (const item of v) {
          if (item instanceof Node) frag.appendChild(item);
          else if (Array.isArray(item)) {
            if (DEBUG) console.warn('[forma] Nested arrays in function children are not supported. Flatten the array or use createList().');
          } else if (item != null && item !== false && item !== true) {
            frag.appendChild(new Text(String(item)));
          }
        }
        // Empty array → treat as null (no DOM output)
        resolved = frag.childNodes.length > 0 ? frag : null;

        if (DEBUG && !warnedArray) {
          warnedArray = true;
          console.warn('[forma] Function child returned an array — auto-wrapped in DocumentFragment. Consider using createList() or wrapping in a container element for better performance.');
        }
      }

      if (resolved instanceof Node) {
        // Clear previous state (fragment children or single node)
        clearCurrent();

        // Track fragment children before appendChild empties the fragment
        const isNewFrag = resolved instanceof DocumentFragment;
        if (isNewFrag) {
          currentFragChildren = Array.from(resolved.childNodes);
        }

        // Insert the new node/fragment
        parent.appendChild(resolved);
        currentNode = isNewFrag ? null : (resolved as Node);
      } else if (resolved == null || resolved === false || resolved === true) {
        // Null/false/true/empty array — remove current content
        clearCurrent();
      } else {
        // Primitive value — bind as text
        // Clear fragment children if transitioning from array → primitive
        if (currentFragChildren) {
          for (const c of currentFragChildren) {
            if (c.parentNode === parent) parent.removeChild(c);
          }
          currentFragChildren = null;
        }
        const text = typeof resolved === 'symbol' ? String(resolved) : String(resolved ?? '');
        if (!currentNode) {
          currentNode = new Text(text);
          parent.appendChild(currentNode);
        } else if (currentNode.nodeType === 3) {
          // In-place text update — avoids DOM removal/insertion
          (currentNode as Text).data = text;
        } else {
          const tn = new Text(text);
          parent.replaceChild(tn, currentNode);
          currentNode = tn;
        }
      }
    });
    return;
  }

  if (Array.isArray(child)) {
    for (const item of child) {
      appendChild(parent, item);
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a real DOM element with optional props and children.
 *
 * Supports both HTML and SVG elements. SVG tags are detected automatically
 * and created with the correct SVG namespace. Inside a `foreignObject`,
 * children switch back to the HTML namespace.
 *
 * Event listeners are attached with an AbortController signal so they can
 * be removed in bulk via `cleanup(el)`.
 *
 * Hyperscript-style API:
 * ```ts
 * h('div', { class: 'container', onClick: handleClick },
 *   h('span', null, 'Hello'),
 *   h('span', null, name),  // name is a signal getter
 * )
 *
 * h('svg', { viewBox: '0 0 24 24', fill: 'none' },
 *   h('path', { d: 'M12 2L2 22h20L12 2z', stroke: 'currentColor' }),
 * )
 * ```
 */
// Overloads: function component, Fragment, string
export function h(tag: (props: Record<string, unknown>) => unknown, props?: Record<string, unknown> | null, ...children: unknown[]): Node;
export function h(tag: typeof Fragment, props?: null, ...children: unknown[]): DocumentFragment;
export function h(tag: string, props?: Record<string, unknown> | null, ...children: unknown[]): HTMLElement;
export function h(
  tag: string | typeof Fragment | ((props: Record<string, unknown>) => unknown),
  props?: Record<string, unknown> | null,
  ...children: unknown[]
): HTMLElement | DocumentFragment {
  // Function component: call with merged props + children
  if (typeof tag === 'function' && tag !== Fragment) {
    const mergedProps = { ...(props ?? {}), children };
    return tag(mergedProps) as unknown as HTMLElement;
  }

  // Fragment: return DocumentFragment with children
  if (tag === Fragment) {
    const frag = document.createDocumentFragment();
    for (const child of children) {
      appendChild(frag, child);
    }
    return frag;
  }

  // After the Fragment guard above, tag is guaranteed to be a string
  const tagName = tag as string;

  if (hydrating) {
    return { type: 'element', tag: tagName, props: props ?? null, children } as unknown as HTMLElement;
  }

  // "Flexible Wings" exploit: for HTML elements, clone a pre-created prototype
  // instead of calling createElement. cloneNode(false) is a single C++ memcpy
  // that copies the element's internal state without parsing the tag string.
  // Skip the SVG Set lookup entirely when the tag is in the proto cache (hot path).
  let el: Element;
  // When an svg() context is active, consult SVG membership BEFORE the proto
  // cache so dual-use tags (notably <a>) get the SVG namespace instead of
  // resolving to their cached HTML prototype.
  const svgCtx = currentNamespace === SVG_NS;
  if (svgCtx && (SVG_TAGS.has(tagName) || DUAL_USE_SVG_TAGS.has(tagName))) {
    el = document.createElementNS(SVG_NS, tagName);
  } else if (!svgCtx && DUAL_USE_SVG_TAGS.has(tagName)) {
    // Dual-use tags (a, title, script, style, font) default to HTML with no
    // svg() context, even though they are also in SVG_TAGS.
    el = getProto(tagName).cloneNode(false) as HTMLElement;
  } else if (ELEMENT_PROTOS && ELEMENT_PROTOS[tagName]) {
    el = ELEMENT_PROTOS[tagName]!.cloneNode(false) as HTMLElement;
  } else if (SVG_TAGS.has(tagName)) {
    el = document.createElementNS(SVG_NS, tagName);
  } else {
    el = getProto(tagName).cloneNode(false) as HTMLElement;
  }

  // Props are split into a static and a dynamic path. Static props
  // (string/number/boolean literals) are written once and never re-read, so
  // they skip the attribute cache entirely; only function-valued props need it,
  // to diff against the previous value on re-runs. An element with no dynamic
  // prop therefore never allocates a cache object.
  // Verified by: src/dom/__tests__/element.test.ts > "allocates no attribute cache for an element with only static props"
  if (props) {
    let hasDynamic = false;
    for (const key in props) {
      if (key === 'ref') continue;
      const value = props[key];

      // Event handlers: no cache needed, direct binding. Case-sensitive by
      // design — see applyProp; other casings are dropped downstream instead of
      // becoming inline handler attributes.
      if (key.charCodeAt(0) === 111 /* o */ && key.charCodeAt(1) === 110 /* n */ && key.length > 2) {
        handleEvent(el, key, value);
        continue;
      }

      // Dynamic prop (function value, not event): needs cache + effect
      if (typeof value === 'function') {
        if (!hasDynamic) {
          // Lazy-allocate cache only when first dynamic prop is found
          (el as any)[CACHE_SYM] = Object.create(null);
          hasDynamic = true;
        }
        applyProp(el, key, value);
        continue;
      }

      // Static prop: zero-cache fast path — direct DOM write
      applyStaticProp(el, key, value);
    }
  }

  // Append children — fast path for single string/number child avoids
  // Text node allocation + separate appendChild. el.textContent is a single
  // native C++ call that combines both operations.
  const childLen = children.length;
  if (childLen === 1) {
    const only = children[0];
    if (typeof only === 'string') {
      el.textContent = only;
    } else if (typeof only === 'number') {
      el.textContent = String(only);
    } else {
      appendChild(el, only);
    }
  } else if (childLen > 1) {
    for (const child of children) {
      appendChild(el, child);
    }
  }

  // Call ref after element is fully constructed
  if (props && typeof props['ref'] === 'function') {
    (props['ref'] as (el: Element) => void)(el);
  }

  return el as unknown as HTMLElement;
}

/**
 * Create a DocumentFragment from children.
 *
 * ```ts
 * fragment(
 *   h('li', null, 'one'),
 *   h('li', null, 'two'),
 * )
 * ```
 */
export function fragment(...children: unknown[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const child of children) {
    appendChild(frag, child);
  }
  return frag;
}
