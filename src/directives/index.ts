/**
 * FormaJS Directives Runtime
 *
 * Zero-build-step CDN drop-in that makes HTML reactive using data-forma-* attributes.
 * This is "Path 1" of FormaJS — the simplest way to add reactivity to any page.
 *
 * Usage:
 *   <script src="https://cdn.getforma.dev/directives.js"></script>
 *   <div data-forma-state="{ count: 0 }">
 *     <p data-forma-text="count"></p>
 *     <button data-forma-click="count++">+1</button>
 *   </div>
 *
 * Expressions are evaluated using `new Function()` with state variables
 * available as local params (same approach as Alpine.js).
 */

import { createSignal, createEffect, batch, untrack } from '../reactive/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DirectiveScope {
  /** The root element with data-forma-state */
  root: HTMLElement;
  /** Reactive getter/setter pairs keyed by property name */
  signals: Map<string, [get: () => unknown, set: (v: unknown) => void]>;
  /** All effect disposers for cleanup */
  disposers: (() => void)[];
}

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

/**
 * Create a function that evaluates an expression in the context of a state scope.
 * State properties are available as local variables.
 *
 * For "getter" expressions (text, show, class, attr, for, if):
 *   new Function('$state', 'count', 'name', 'return (count + 1)')
 *
 * For "setter" expressions (click, input):
 *   new Function('$state', '$event', 'count', 'name', '...setters', 'count++; $state.count = count;')
 *
 * The $state proxy ensures writes go through signal setters.
 */
function createGetter(expr: string, keys: string[]): Function {
  try {
    return new Function('$state', ...keys, `return (${expr})`);
  } catch {
    console.warn(`[forma-directives] Invalid expression: ${expr}`);
    return () => undefined;
  }
}

function createAction(expr: string, keys: string[]): Function {
  // For action expressions, we need to:
  // 1. Destructure current signal values as mutable local variables
  // 2. Execute the expression
  // 3. Write back all locals to $state (which triggers signal setters)
  const writebacks = keys.map(k => `$state.${k} = ${k};`).join('\n');
  try {
    return new Function(
      '$state',
      '$event',
      ...keys,
      `${expr};\n${writebacks}`,
    );
  } catch {
    console.warn(`[forma-directives] Invalid action expression: ${expr}`);
    return () => {};
  }
}

// ---------------------------------------------------------------------------
// State proxy — bridges between JS property access and signals
// ---------------------------------------------------------------------------

function createStateProxy(
  signals: Map<string, [get: () => unknown, set: (v: unknown) => void]>,
): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_, prop: string) {
      const sig = signals.get(prop);
      return sig ? sig[0]() : undefined;
    },
    set(_, prop: string, value: unknown) {
      const sig = signals.get(prop);
      if (sig) {
        sig[1](value);
      } else {
        // Dynamically add new signals for new properties
        const [get, set] = createSignal<unknown>(value);
        signals.set(prop, [get, set]);
      }
      return true;
    },
    has(_, prop: string) {
      return signals.has(prop);
    },
    ownKeys() {
      return Array.from(signals.keys());
    },
    getOwnPropertyDescriptor(_, prop: string) {
      if (signals.has(prop)) {
        return { configurable: true, enumerable: true, writable: true };
      }
      return undefined;
    },
  });
}

// ---------------------------------------------------------------------------
// Get current signal values (untracked) for use in action expressions
// ---------------------------------------------------------------------------

function getValues(signals: Map<string, [get: () => unknown, set: (v: unknown) => void]>): unknown[] {
  return Array.from(signals.values()).map(([get]) => untrack(get));
}

// ---------------------------------------------------------------------------
// Directive processors
// ---------------------------------------------------------------------------

function processText(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  const keys = Array.from(scope.signals.keys());
  const fn = createGetter(expr, keys);
  const proxy = createStateProxy(scope.signals);

  const dispose = createEffect(() => {
    const values = Array.from(scope.signals.values()).map(([get]) => get());
    const result = fn(proxy, ...values);
    el.textContent = result == null ? '' : String(result);
  });
  scope.disposers.push(dispose);
}

function processHtml(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  const keys = Array.from(scope.signals.keys());
  const fn = createGetter(expr, keys);
  const proxy = createStateProxy(scope.signals);

  const dispose = createEffect(() => {
    const values = Array.from(scope.signals.values()).map(([get]) => get());
    const result = fn(proxy, ...values);
    el.innerHTML = result == null ? '' : String(result);
  });
  scope.disposers.push(dispose);
}

function processShow(
  el: HTMLElement,
  expr: string,
  scope: DirectiveScope,
  invert: boolean = false,
): void {
  const keys = Array.from(scope.signals.keys());
  const fn = createGetter(expr, keys);
  const proxy = createStateProxy(scope.signals);

  // Capture the original display value
  const originalDisplay = el.style.display;

  const dispose = createEffect(() => {
    const values = Array.from(scope.signals.values()).map(([get]) => get());
    let visible = !!fn(proxy, ...values);
    if (invert) visible = !visible;
    el.style.display = visible ? originalDisplay : 'none';
  });
  scope.disposers.push(dispose);
}

function processClick(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  const keys = Array.from(scope.signals.keys());
  const fn = createAction(expr, keys);
  const proxy = createStateProxy(scope.signals);

  const handler = (event: Event) => {
    batch(() => {
      const values = getValues(scope.signals);
      fn(proxy, event, ...values);
    });
  };

  el.addEventListener('click', handler);
  scope.disposers.push(() => el.removeEventListener('click', handler));
}

function processInput(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  const keys = Array.from(scope.signals.keys());
  const fn = createAction(expr, keys);
  const proxy = createStateProxy(scope.signals);

  const handler = (event: Event) => {
    batch(() => {
      const values = getValues(scope.signals);
      fn(proxy, event, ...values);
    });
  };

  el.addEventListener('input', handler);
  scope.disposers.push(() => el.removeEventListener('input', handler));
}

function processModel(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  const keys = Array.from(scope.signals.keys());
  const getterFn = createGetter(expr, keys);
  const proxy = createStateProxy(scope.signals);

  const tagName = el.tagName.toLowerCase();
  const inputEl = el as HTMLInputElement;

  // Determine the type for proper binding
  const isCheckbox = tagName === 'input' && inputEl.type === 'checkbox';
  const isRadio = tagName === 'input' && inputEl.type === 'radio';
  const isSelect = tagName === 'select';

  // Read: effect updates DOM from signal
  const dispose = createEffect(() => {
    const values = Array.from(scope.signals.values()).map(([get]) => get());
    const value = getterFn(proxy, ...values);

    if (isCheckbox) {
      inputEl.checked = !!value;
    } else if (isRadio) {
      inputEl.checked = inputEl.value === String(value);
    } else {
      inputEl.value = value == null ? '' : String(value);
    }
  });
  scope.disposers.push(dispose);

  // Write: input events update signal
  const eventName = isSelect ? 'change' : 'input';
  const handler = () => {
    let newValue: unknown;
    if (isCheckbox) {
      newValue = inputEl.checked;
    } else if (isRadio) {
      newValue = inputEl.value;
    } else {
      newValue = inputEl.value;
    }
    // Directly set via proxy — expr is just a property name
    const propName = expr.trim();
    if (scope.signals.has(propName)) {
      scope.signals.get(propName)![1](newValue);
    }
  };

  el.addEventListener(eventName, handler);
  scope.disposers.push(() => el.removeEventListener(eventName, handler));
}

function processClass(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  const keys = Array.from(scope.signals.keys());
  const fn = createGetter(expr, keys);
  const proxy = createStateProxy(scope.signals);

  const dispose = createEffect(() => {
    const values = Array.from(scope.signals.values()).map(([get]) => get());
    const classMap = fn(proxy, ...values) as Record<string, boolean>;
    if (classMap && typeof classMap === 'object') {
      for (const [cls, active] of Object.entries(classMap)) {
        if (active) {
          el.classList.add(cls);
        } else {
          el.classList.remove(cls);
        }
      }
    }
  });
  scope.disposers.push(dispose);
}

function processAttr(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  const keys = Array.from(scope.signals.keys());
  const fn = createGetter(expr, keys);
  const proxy = createStateProxy(scope.signals);

  const dispose = createEffect(() => {
    const values = Array.from(scope.signals.values()).map(([get]) => get());
    const attrMap = fn(proxy, ...values) as Record<string, unknown>;
    if (attrMap && typeof attrMap === 'object') {
      for (const [attr, value] of Object.entries(attrMap)) {
        if (value === false || value == null) {
          el.removeAttribute(attr);
        } else if (value === true) {
          el.setAttribute(attr, '');
        } else {
          el.setAttribute(attr, String(value));
        }
      }
    }
  });
  scope.disposers.push(dispose);
}

function processIf(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  const keys = Array.from(scope.signals.keys());
  const fn = createGetter(expr, keys);
  const proxy = createStateProxy(scope.signals);

  const placeholder = document.createComment(`forma-if: ${expr}`);
  let isInserted = true;
  const parentNode = el.parentNode!;

  const dispose = createEffect(() => {
    const values = Array.from(scope.signals.values()).map(([get]) => get());
    const show = !!fn(proxy, ...values);

    if (show && !isInserted) {
      parentNode.insertBefore(el, placeholder);
      parentNode.removeChild(placeholder);
      isInserted = true;
    } else if (!show && isInserted) {
      parentNode.insertBefore(placeholder, el);
      parentNode.removeChild(el);
      isInserted = false;
    }
  });
  scope.disposers.push(dispose);
}

function processFor(
  el: Element,
  expr: string,
  scope: DirectiveScope,
): void {
  // Parse "item in items" pattern
  const match = expr.match(/^\s*(\w+)\s+in\s+(.+)$/);
  if (!match) {
    console.warn(`[forma-directives] Invalid for expression: ${expr}`);
    return;
  }

  const itemName = match[1]!;
  const listExpr = match[2]!;

  const keys = Array.from(scope.signals.keys());
  const fn = createGetter(listExpr, keys);
  const proxy = createStateProxy(scope.signals);

  // Replace element with a placeholder comment
  const placeholder = document.createComment(`forma-for: ${expr}`);
  const template = el.cloneNode(true) as Element;
  template.removeAttribute('data-forma-for');

  const parent = el.parentNode!;
  parent.replaceChild(placeholder, el);

  let currentElements: Element[] = [];

  const dispose = createEffect(() => {
    const values = Array.from(scope.signals.values()).map(([get]) => get());
    const items = fn(proxy, ...values);

    // Remove old elements
    for (const oldEl of currentElements) {
      oldEl.remove();
    }
    currentElements = [];

    if (!Array.isArray(items)) return;

    // Create new elements
    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const clone = template.cloneNode(true) as Element;

      // Create a child scope that includes the loop variable
      const childSignals = new Map(scope.signals);
      const [getItem, setItem] = createSignal<unknown>(item);
      childSignals.set(itemName, [getItem, setItem]);

      // Also provide $index
      const [getIndex] = createSignal<unknown>(i);
      childSignals.set('$index', [getIndex, () => {}]);

      // Process directives on the cloned element and its children
      const childScope: DirectiveScope = {
        root: scope.root,
        signals: childSignals,
        disposers: scope.disposers,
      };
      processElement(clone, childScope);
      walkChildren(clone, childScope);

      frag.appendChild(clone);
      currentElements.push(clone);
    }

    placeholder.parentNode!.insertBefore(frag, placeholder.nextSibling);
  });
  scope.disposers.push(dispose);
}

// ---------------------------------------------------------------------------
// DOM walking
// ---------------------------------------------------------------------------

function processElement(el: Element, scope: DirectiveScope): void {
  // Skip if this element has its own data-forma-state (handled separately)
  // but only if it's not the root element of this scope
  if (el !== scope.root && el.hasAttribute('data-forma-state')) {
    return;
  }

  // data-forma-for needs special treatment — it replaces the element
  if (el.hasAttribute('data-forma-for')) {
    processFor(el, el.getAttribute('data-forma-for')!, scope);
    return; // for replaces the element, don't process children
  }

  // Process each directive
  if (el.hasAttribute('data-forma-text')) {
    processText(el, el.getAttribute('data-forma-text')!, scope);
  }

  if (el.hasAttribute('data-forma-html')) {
    processHtml(el, el.getAttribute('data-forma-html')!, scope);
  }

  if (el.hasAttribute('data-forma-show')) {
    processShow(el as HTMLElement, el.getAttribute('data-forma-show')!, scope);
  }

  if (el.hasAttribute('data-forma-hide')) {
    processShow(el as HTMLElement, el.getAttribute('data-forma-hide')!, scope, true);
  }

  if (el.hasAttribute('data-forma-click')) {
    processClick(el, el.getAttribute('data-forma-click')!, scope);
  }

  if (el.hasAttribute('data-forma-input')) {
    processInput(el, el.getAttribute('data-forma-input')!, scope);
  }

  if (el.hasAttribute('data-forma-model')) {
    processModel(el, el.getAttribute('data-forma-model')!, scope);
  }

  if (el.hasAttribute('data-forma-class')) {
    processClass(el, el.getAttribute('data-forma-class')!, scope);
  }

  if (el.hasAttribute('data-forma-attr')) {
    processAttr(el, el.getAttribute('data-forma-attr')!, scope);
  }

  if (el.hasAttribute('data-forma-if')) {
    processIf(el, el.getAttribute('data-forma-if')!, scope);
  }
}

function walkChildren(parent: Element | DocumentFragment, scope: DirectiveScope): void {
  // Snapshot the children since processing may modify the DOM
  const children = Array.from(parent.children);
  for (const child of children) {
    if (child.hasAttribute('data-forma-state')) {
      // Nested state — create a child scope that inherits parent
      initScope(child as HTMLElement, scope);
    } else {
      processElement(child, scope);
      // Only walk children if the element wasn't replaced by for/if
      if (child.parentNode) {
        walkChildren(child, scope);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Scope initialization
// ---------------------------------------------------------------------------

function initScope(el: HTMLElement, parentScope?: DirectiveScope): DirectiveScope {
  const stateExpr = el.getAttribute('data-forma-state');
  if (!stateExpr) {
    throw new Error('[forma-directives] data-forma-state attribute is empty');
  }

  // Parse the state object
  let stateObj: Record<string, unknown>;
  try {
    stateObj = new Function(`return (${stateExpr})`)() as Record<string, unknown>;
  } catch {
    console.warn(`[forma-directives] Invalid state expression: ${stateExpr}`);
    return { root: el, signals: new Map(), disposers: [] };
  }

  // Create signals for each property
  const signals = new Map<string, [get: () => unknown, set: (v: unknown) => void]>();

  // Inherit parent scope signals first
  if (parentScope) {
    for (const [key, pair] of parentScope.signals) {
      signals.set(key, pair);
    }
  }

  // Create signals for own state (overwrites parent if same key)
  for (const [key, value] of Object.entries(stateObj)) {
    const [get, set] = createSignal<unknown>(value);
    signals.set(key, [get, set]);
  }

  const scope: DirectiveScope = {
    root: el,
    signals,
    disposers: [],
  };

  // Process directives on the root element itself (except data-forma-state)
  processElement(el, scope);

  // Walk children
  walkChildren(el, scope);

  return scope;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** All active scopes for cleanup */
const activeScopes: DirectiveScope[] = [];

/**
 * Initialize FormaJS directives on the current page.
 * Scans for all elements with `data-forma-state` and makes them reactive.
 *
 * Called automatically on DOMContentLoaded when using the IIFE bundle.
 * Can also be called manually for dynamically added content.
 */
export function initDirectives(root: Element | Document = document): DirectiveScope[] {
  const scopes: DirectiveScope[] = [];

  // Collect candidate elements: if root itself has data-forma-state, include it
  const candidates: Element[] = [];
  if (root instanceof Element && root.hasAttribute('data-forma-state')) {
    candidates.push(root);
  }
  for (const el of root.querySelectorAll('[data-forma-state]')) {
    candidates.push(el);
  }

  for (const el of candidates) {
    // Skip if this element is nested inside another data-forma-state candidate
    // (it will be initialized by its parent's walkChildren)
    const parent = el.parentElement;
    if (parent) {
      const ancestor = parent.closest('[data-forma-state]');
      // Only skip if the ancestor is also in our candidate list
      if (ancestor && candidates.includes(ancestor)) {
        continue;
      }
    }

    const scope = initScope(el as HTMLElement);
    scopes.push(scope);
    activeScopes.push(scope);
  }

  return scopes;
}

/**
 * Dispose all directive scopes, removing all reactive effects and event listeners.
 */
export function destroyDirectives(): void {
  for (const scope of activeScopes) {
    for (const dispose of scope.disposers) {
      dispose();
    }
    scope.disposers.length = 0;
  }
  activeScopes.length = 0;
}

// ---------------------------------------------------------------------------
// Auto-initialization for IIFE bundle
// ---------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initDirectives());
  } else {
    initDirectives();
  }
}
