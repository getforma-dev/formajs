/**
 * Forma DOM - Element
 *
 * Hyperscript-style element factory (`h`) and Fragment helper.
 * Backed by alien-signals via forma/reactive.
 *
 * Supports both HTML and SVG elements with automatic namespace detection.
 * Provides event listener cleanup via AbortController.
 */

import { internalEffect } from 'forma/reactive';
import { hydrating, type HydrationDescriptor } from './hydrate.js';

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
// Element prototype cache — cloneNode(false) is a C++ memcpy, faster than
// createElement which must parse the tag string and validate.
// "Flexible Wings" exploit: the prototypes pass static inspection (they're
// standard elements) but flex at runtime to avoid parsing overhead.
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
// Event name cache — avoids .slice(2).toLowerCase() string allocations
// on every event binding. "Super Clipping" exploit.
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

/** Handle style prop. Reconciles object styles by removing stale keys. */
function handleStyle(el: Element, _key: string, value: unknown): void {
  if (typeof value === 'function') {
    let prevKeys: string[] = [];
    internalEffect(() => {
      const v = (value as () => string | Record<string, string>)();
      if (typeof v === 'string') {
        const cache = getCache(el);
        if (cache['style'] === v) return;
        cache['style'] = v;
        prevKeys = [];
        (el as HTMLElement | SVGElement).style.cssText = v;
      } else if (v && typeof v === 'object') {
        const style = (el as HTMLElement | SVGElement).style;
        const nextKeys = Object.keys(v);
        // Remove keys that were present last time but are absent now
        for (const k of prevKeys) {
          if (!(k in (v as Record<string, string>))) {
            style.removeProperty(k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()));
          }
        }
        Object.assign(style, v);
        prevKeys = nextKeys;
      }
    });
  } else if (typeof value === 'string') {
    const cache = getCache(el);
    if (cache['style'] === value) return;
    cache['style'] = value;
    (el as HTMLElement | SVGElement).style.cssText = value;
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

/** Handle xlink: namespaced SVG attributes. */
function handleXLink(el: Element, key: string, value: unknown): void {
  const localName = key.slice(6); // strip "xlink:" prefix
  if (typeof value === 'function') {
    internalEffect(() => {
      const v = (value as () => unknown)();
      if (v == null || v === false) {
        el.removeAttributeNS(XLINK_NS, localName);
      } else {
        el.setAttributeNS(XLINK_NS, key, String(v));
      }
    });
  } else {
    if (value == null || value === false) {
      el.removeAttributeNS(XLINK_NS, localName);
    } else {
      el.setAttributeNS(XLINK_NS, key, String(value));
    }
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

/** Handle generic attributes with setAttribute/removeAttribute. */
function handleGenericAttr(el: Element, key: string, value: unknown): void {
  if (typeof value === 'function') {
    internalEffect(() => {
      const v = (value as () => unknown)();
      if (v == null || v === false) {
        const cache = getCache(el);
        if (cache[key] === null) return;
        cache[key] = null;
        el.removeAttribute(key);
      } else {
        const strVal = String(v);
        const cache = getCache(el);
        if (cache[key] === strVal) return;
        cache[key] = strVal;
        el.setAttribute(key, strVal);
      }
    });
  } else {
    if (value == null || value === false) {
      const cache = getCache(el);
      if (cache[key] === null) return;
      cache[key] = null;
      el.removeAttribute(key);
    } else {
      const strVal = String(value);
      const cache = getCache(el);
      if (cache[key] === strVal) return;
      cache[key] = strVal;
      el.setAttribute(key, strVal);
    }
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
    (el as HTMLElement).className = value as string;
    return;
  }

  if (key === 'style') {
    if (typeof value === 'string') {
      (el as HTMLElement | SVGElement).style.cssText = value;
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
    el.setAttributeNS(XLINK_NS, key, String(value));
    return;
  }

  // Boolean attrs
  if (BOOLEAN_ATTRS.has(key)) {
    if (value) el.setAttribute(key, '');
    return;
  }

  // Generic: true → empty string attribute, else stringified value
  if (value === true) {
    el.setAttribute(key, '');
  } else {
    el.setAttribute(key, String(value));
  }
}

/** Append a single child to a parent node. */
function appendChild(parent: Node, child: unknown): void {
  // "Active Suspension" exploit: check the MOST COMMON type first.
  // In h('div', props, h('span'), h('button')), children are Nodes 70%+ of the time.
  // instanceof Node returns false in O(1) for primitives (null, string, number)
  // because V8 checks "is this an object?" first — no prototype chain walk.
  // This saves 3-5 wasted type comparisons vs the conventional null-first order.
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
  //   - primitive (string/number/null) → bind as text
  if (typeof child === 'function') {
    if (parent instanceof Element) {
      (parent as any)[DYNAMIC_CHILD_SYM] = true;
    }
    let currentNode: Node | null = null;
    internalEffect(() => {
      const v = (child as () => unknown)();
      if (v instanceof Node) {
        // Function returned a DOM element — adopt or replace
        if (currentNode) {
          parent.replaceChild(v, currentNode);
        } else {
          parent.appendChild(v);
        }
        currentNode = v;
      } else {
        // Primitive value — bind as text
        const text = typeof v === 'symbol' ? String(v) : String(v ?? '');
        if (!currentNode) {
          currentNode = new Text(text);
          parent.appendChild(currentNode);
        } else if (currentNode.nodeType === 3) {
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
  if (ELEMENT_PROTOS && ELEMENT_PROTOS[tagName]) {
    el = ELEMENT_PROTOS[tagName]!.cloneNode(false) as HTMLElement;
  } else if (SVG_TAGS.has(tagName)) {
    el = document.createElementNS(SVG_NS, tagName);
  } else {
    el = getProto(tagName).cloneNode(false) as HTMLElement;
  }

  // "Blown Diffuser" exploit: split props into static and dynamic paths.
  // Static props (string/number/boolean literals) go through a zero-cache
  // fast path. Only dynamic props (function values) need the attribute cache
  // for diffing on re-runs. This avoids:
  // - Object.create(null) allocation for elements with only static props
  // - Cache read/write operations that always miss on first call
  // - getCache() indirection in every prop handler
  if (props) {
    let hasDynamic = false;
    for (const key in props) {
      if (key === 'ref') continue;
      const value = props[key];

      // Event handlers: no cache needed, direct binding
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
