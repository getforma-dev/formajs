/**
 * FormaJS DOM - Hydrate
 *
 * Descriptor-based island hydration. During hydration, h() returns plain
 * descriptor objects instead of DOM elements. A top-down walk (adoptNode)
 * then matches these descriptors against SSR DOM to attach events and
 * reactive bindings. No DOM elements are created during hydration.
 */

import { internalEffect, createSignal, untrack, createRoot, registerDisposer, __DEV__ } from 'forma/reactive';
import { h } from './element.js';
import { reconcileList, createList } from './list.js';
import { createShow } from './show.js';
import { isEventHandlerAttr, isRawHtmlAttr, isUnsafeAttrWrite } from '../security/url-safety.js';

// Same symbol identity as element.ts — Symbol.for() guarantees cross-module
// sharing so cleanup(el) in element.ts aborts controllers created here.
const ABORT_SYM = Symbol.for('forma-abort');

// ---------------------------------------------------------------------------
// Hydration state — module-level boolean
// ---------------------------------------------------------------------------

/** True while hydration is in progress. Checked by h() to branch. */
export let hydrating = false;

/**
 * Set the hydrating state. Used internally by hydration functions.
 * Required because `export let` cannot be reassigned from outside the module.
 */
export function setHydrating(value: boolean): void {
  hydrating = value;
}

// ---------------------------------------------------------------------------
// Descriptor interfaces
// ---------------------------------------------------------------------------

/** Descriptor returned by h() during hydration instead of a real Element. */
export interface HydrationDescriptor {
  type: 'element';
  tag: string;
  props: Record<string, unknown> | null;
  children: unknown[];
}

/** Descriptor returned by createShow() during hydration. */
export interface ShowDescriptor {
  type: 'show';
  condition: () => unknown;
  whenTrue: () => unknown;
  whenFalse?: () => unknown;
  initialBranch: unknown;
}

/** Descriptor returned by createList() during hydration. */
export interface ListDescriptor {
  type: 'list';
  items: () => unknown[];
  keyFn: (item: unknown) => string | number;
  renderFn: (item: unknown, index: () => number) => HTMLElement;
  options?: Record<string, unknown>;
}

/** Maps built by collectMarkers() for O(1) marker lookup during adoption. */
export interface MarkerMap {
  text: Map<number, Text>;
  show: Map<number, { start: Comment; end: Comment }>;
  list: Map<number, { start: Comment; end: Comment }>;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Check if a value is a HydrationDescriptor. */
export function isDescriptor(v: unknown): v is HydrationDescriptor {
  return v != null && typeof v === 'object' && 'type' in v && v.type === 'element';
}

/** Check if a value is a ShowDescriptor. */
export function isShowDescriptor(v: unknown): v is ShowDescriptor {
  return v != null && typeof v === 'object' && 'type' in v && v.type === 'show';
}

/** Check if a value is a ListDescriptor. */
export function isListDescriptor(v: unknown): v is ListDescriptor {
  return v != null && typeof v === 'object' && 'type' in v && v.type === 'list';
}

// ---------------------------------------------------------------------------
// Marker grammar
// ---------------------------------------------------------------------------

// Marker kind characters, as char codes: f:t0 / f:s0 / f:l0 / f:i0.
const KIND_TEXT = 116; /* t */
const KIND_SHOW = 115; /* s */
const KIND_LIST = 108; /* l */
const KIND_ISLAND = 105; /* i */

/**
 * Parse a `f:<kind><decimal index>` marker starting at `offset` (1 for the
 * closing `/f:<kind>N` form). Returns the index, or -1 when the comment is not
 * a marker of that kind.
 *
 * The marker GRAMMAR is the wire contract shared with the Rust walker and ksx
 * and is not changed here. The PARSER is deliberately stricter than a prefix
 * test: every character after the kind must be a decimal digit, which is
 * exactly what the walker and the compiler emit. Without that, an authored
 * template comment such as `<!--f:side note-->` (the walker passes authored
 * comments through nearly verbatim) is read as a show marker and desyncs the
 * adoption cursor for the rest of its parent.
 *
 * Verified by: src/dom/__tests__/hydrate.test.ts > "ignores an authored comment that only shares a marker prefix"
 */
function markerIndex(data: string, kind: number, offset: number): number {
  if (
    data.charCodeAt(offset) !== 102 /* f */ ||
    data.charCodeAt(offset + 1) !== 58 /* : */ ||
    data.charCodeAt(offset + 2) !== kind
  ) {
    return -1;
  }
  const first = offset + 3;
  if (data.length <= first) return -1;
  let idx = 0;
  for (let i = first; i < data.length; i++) {
    const c = data.charCodeAt(i);
    if (c < 48 /* 0 */ || c > 57 /* 9 */) return -1;
    idx = idx * 10 + (c - 48);
  }
  return idx;
}

// ---------------------------------------------------------------------------
// collectMarkers() — single-pass TreeWalker
// ---------------------------------------------------------------------------

/**
 * Walk the DOM under `root` once, collecting text and show markers into a
 * MarkerMap for O(1) lookup during adoptNode().
 *
 * Text markers:  `<!--f:t0-->`, `<!--f:t1-->`, ... followed by a Text node
 * Show markers:  `<!--f:s0-->` ... `<!--/f:s0-->` pairs
 */
export function collectMarkers(root: Element): MarkerMap {
  const text = new Map<number, Text>();
  const show = new Map<number, { start: Comment; end: Comment }>();
  const list = new Map<number, { start: Comment; end: Comment }>();

  // Pending show-start comments keyed by index, waiting for their closing marker
  const pendingShow = new Map<number, Comment>();
  // Pending list-start comments keyed by index, waiting for their closing marker
  const pendingList = new Map<number, Comment>();

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, {
    acceptNode(node) {
      // Skip child island subtrees (REJECT = skip node AND all descendants)
      if (node !== root && node.nodeType === 1 &&
          (node as Element).hasAttribute('data-forma-island')) {
        return NodeFilter.FILTER_REJECT;
      }
      // Only process comments and text nodes
      if (node.nodeType === Node.COMMENT_NODE || node.nodeType === Node.TEXT_NODE) {
        return NodeFilter.FILTER_ACCEPT;
      }
      // Elements: skip the node itself but walk into children
      return NodeFilter.FILTER_SKIP;
    }
  });

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (node.nodeType === Node.COMMENT_NODE) {
      const data = (node as Comment).data;
      const closing = data.charCodeAt(0) === 47 /* / */;
      const offset = closing ? 1 : 0;

      // Text marker: "f:t<index>"
      if (!closing) {
        const idx = markerIndex(data, KIND_TEXT, 0);
        if (idx >= 0) {
          // The text node is the next sibling
          const next = node.nextSibling;
          if (next && next.nodeType === Node.TEXT_NODE) {
            text.set(idx, next as Text);
          }
          continue;
        }
      }

      // Show markers: "f:s<index>" … "/f:s<index>"
      const showIdx = markerIndex(data, KIND_SHOW, offset);
      if (showIdx >= 0) {
        if (closing) {
          const start = pendingShow.get(showIdx);
          if (start) {
            show.set(showIdx, { start, end: node as Comment });
            pendingShow.delete(showIdx);
          }
        } else {
          pendingShow.set(showIdx, node as Comment);
        }
        continue;
      }

      // List markers: "f:l<index>" … "/f:l<index>"
      const listIdx = markerIndex(data, KIND_LIST, offset);
      if (listIdx >= 0) {
        if (closing) {
          const start = pendingList.get(listIdx);
          if (start) {
            list.set(listIdx, { start, end: node as Comment });
            pendingList.delete(listIdx);
          }
        } else {
          pendingList.set(listIdx, node as Comment);
        }
        continue;
      }
    }
  }

  return { text, show, list };
}

// ---------------------------------------------------------------------------
// applyDynamicProps()
// ---------------------------------------------------------------------------

/**
 * Prop name → HTML attribute name. Same three mappings as `PROP_TO_ATTR` in
 * src/ssr/render.ts; duplicated rather than imported so the client bundle never
 * pulls in the SSR renderer. Without it a reactive `className` binding writes a
 * `classname="…"` attribute, which styles nothing.
 *
 * Verified by: src/dom/__tests__/hydrate.test.ts > "maps className/htmlFor/tabIndex to their HTML attribute names"
 */
const PROP_TO_ATTR: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  tabIndex: 'tabindex',
};

/**
 * Attach event handlers and reactive attribute bindings to an existing
 * SSR element. Static (non-function) props are skipped because they are
 * already baked into the server HTML.
 *
 * Adoption applies the same three rules as h() and the SSR renderers, so this
 * path cannot drift from the other two:
 * - `ref` is a callback, not an attribute: it is invoked with the element.
 * - any `on…` name (whatever its casing) never reaches setAttribute — writing
 *   it would install a real inline event handler the server deliberately
 *   dropped.
 * - reactive values go through `isUnsafeAttrWrite` (the shared client/SSR
 *   predicate) on every run, and the attribute is REMOVED rather than written
 *   when the value is dangerous.
 *
 * Verified by: src/dom/__tests__/hydrate.test.ts > "calls a function ref with the adopted element instead of writing a ref attribute"
 * Verified by: src/dom/__tests__/hydrate.test.ts > "never writes an inline event-handler attribute for an odd-cased on* prop"
 * Verified by: src/dom/__tests__/hydrate.test.ts > "removes a URL attribute whose reactive value uses a dangerous scheme"
 */
export function applyDynamicProps(el: Element, props: Record<string, unknown> | null): void {
  if (!props) return;

  let ref: ((el: Element) => void) | null = null;

  for (const key in props) {
    const value = props[key];

    // ref is a callback, not an attribute — call it once the element is bound
    // (h() does the same after it finishes building the element).
    if (key === 'ref') {
      if (typeof value === 'function') ref = value as (el: Element) => void;
      continue;
    }

    // Skip non-function values — they are static and already in the SSR HTML
    if (typeof value !== 'function') continue;

    // Event handlers: onXxx — use AbortController so cleanup(el) removes them
    if (key.charCodeAt(0) === 111 /* o */ && key.charCodeAt(1) === 110 /* n */ && key.length > 2) {
      let ac = (el as any)[ABORT_SYM] as AbortController | undefined;
      if (!ac) {
        ac = new AbortController();
        (el as any)[ABORT_SYM] = ac;
      }
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener, { signal: ac.signal });
      continue;
    }

    const attrKey = PROP_TO_ATTR[key] ?? key;

    // Any other `on…` casing (ONCLICK, Onerror) reached here instead of the
    // fast path above. setAttribute lowercases qualified names on HTML
    // elements, so writing it would create a live inline handler out of a prop
    // the SSR renderer drops. Never write it.
    if (isEventHandlerAttr(attrKey)) {
      if (__DEV__) console.warn(`[forma] Hydration: dropped "${attrKey}" on <${el.localName}> (inline-event-handler) — use the lowercase on* prop form for listeners`);
      el.removeAttribute(attrKey);
      continue;
    }
    if (__DEV__ && isRawHtmlAttr(attrKey)) {
      console.warn(`[forma] Hydration: "${attrKey}" on <${el.localName}> is a raw-HTML sink — its value is parsed as a document, so escaping does not neutralize it. Only pass trusted markup.`);
    }

    // Reactive attribute binding (function, non-event). isUnsafeAttrWrite is the
    // same predicate h() and the SSR renderer use, so a payload the server
    // refused to emit is not re-added here at hydration.
    const fn = value as () => unknown;
    const tag = el.localName;
    internalEffect(() => {
      const v = fn();
      if (v === false || v == null) {
        el.removeAttribute(attrKey);
      } else if (v === true) {
        el.setAttribute(attrKey, '');
      } else {
        const str = String(v);
        if (isUnsafeAttrWrite(tag, attrKey, str)) {
          if (__DEV__) console.warn(`[forma] Hydration: dropped "${attrKey}" on <${tag}> (unsafe-URL)`);
          el.removeAttribute(attrKey);
          return;
        }
        el.setAttribute(attrKey, str);
      }
    });
  }

  if (ref) ref(el);
}

// ---------------------------------------------------------------------------
// descriptorToElement()
// ---------------------------------------------------------------------------

/**
 * Convert any hydration-mode value (descriptor, show, list, or Node) back
 * into a real DOM Node. Used when SSR content mismatches client state and
 * the framework needs to create fresh DOM from captured descriptors.
 *
 * Temporarily exits hydration mode so h(), createShow(), createList()
 * create real elements with reactive bindings.
 */
export function ensureNode(value: unknown): Node | null {
  if (value instanceof Node) return value;
  if (value == null || value === false || value === true) return null;
  if (typeof value === 'string') return new Text(value);
  if (typeof value === 'number') return new Text(String(value));
  if (isDescriptor(value)) return descriptorToElement(value);
  if (isShowDescriptor(value)) {
    const prevH = hydrating;
    hydrating = false;
    try {
      return createShow(
        value.condition,
        () => ensureNode(value.whenTrue()) ?? document.createComment('empty'),
        value.whenFalse
          ? () => ensureNode(value.whenFalse!()) ?? document.createComment('empty')
          : undefined,
      );
    } finally {
      hydrating = prevH;
    }
  }
  if (isListDescriptor(value)) {
    const prevH = hydrating;
    hydrating = false;
    try {
      return createList(value.items, value.keyFn, value.renderFn, value.options);
    } finally {
      hydrating = prevH;
    }
  }
  return null;
}

/**
 * Convert a HydrationDescriptor back into a real DOM Element by calling h().
 * Used as a fallback when SSR DOM is missing or mismatched.
 *
 * Temporarily exits hydration mode so h() creates real elements.
 * Handles nested ShowDescriptor and ListDescriptor children by converting
 * them to real reactive primitives (createShow, createList).
 */
export function descriptorToElement(desc: HydrationDescriptor): Element {
  const prevHydrating = hydrating;
  hydrating = false;

  try {
    // Map children: recurse for nested descriptors, convert Show/List
    const children = desc.children.map((child) => {
      if (isDescriptor(child)) return descriptorToElement(child);
      if (isShowDescriptor(child)) return ensureNode(child);
      if (isListDescriptor(child)) return ensureNode(child);
      return child;
    });

    return h(desc.tag, desc.props, ...children);
  } finally {
    hydrating = prevHydrating;
  }
}

// ---------------------------------------------------------------------------
// DOM cursor helpers for adoptNode
// ---------------------------------------------------------------------------

/** Check if comment data is an island start marker (f:iN). */
function isIslandStart(data: string): boolean {
  return markerIndex(data, KIND_ISLAND, 0) >= 0;
}

/** Check if comment data is a show start marker (f:sN). */
function isShowStart(data: string): boolean {
  return markerIndex(data, KIND_SHOW, 0) >= 0;
}

/** Check if comment data is a text marker (f:tN). */
function isTextStart(data: string): boolean {
  return markerIndex(data, KIND_TEXT, 0) >= 0;
}

/** Check if comment data is a list start marker (f:lN). */
function isListStart(data: string): boolean {
  return markerIndex(data, KIND_LIST, 0) >= 0;
}

/** Find the closing comment marker for a start marker (e.g., f:i0 → /f:i0). */
function findClosingMarker(start: Comment): Comment | null {
  const closing = '/' + start.data;
  let node: Node | null = start.nextSibling;
  while (node) {
    if (node.nodeType === 8 && (node as Comment).data === closing) {
      return node as Comment;
    }
    node = node.nextSibling;
  }
  return null;
}

/** Find the first Text node between two comment markers (exclusive). */
function findTextBetween(start: Comment, end: Comment): Text | null {
  let node: Node | null = start.nextSibling;
  while (node && node !== end) {
    if (node.nodeType === 3) return node as Text;
    node = node.nextSibling;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Show descriptor helpers
// ---------------------------------------------------------------------------

/**
 * Find the first Element node between two comment markers (exclusive).
 */
function nextElementBetweenMarkers(start: Comment, end: Comment): Element | undefined {
  let node: Node | null = start.nextSibling;
  while (node && node !== end) {
    if (node.nodeType === 1) return node as Element;
    node = node.nextSibling;
  }
  return undefined;
}

/**
 * Extract all nodes between two comment markers into a DocumentFragment.
 * The markers themselves are left in place.
 */
function extractContentBetweenMarkers(start: Comment, end: Comment): DocumentFragment {
  const frag = document.createDocumentFragment();
  let node = start.nextSibling;
  while (node && node !== end) {
    const next = node.nextSibling;
    frag.appendChild(node);
    node = next;
  }
  return frag;
}

/**
 * Adopt one SSR show region: bind the initial branch to the server content and
 * install the toggle effect.
 *
 * The adoption itself runs inside its own reactive root so the bindings it
 * creates die with that branch instead of outliving the island.
 *
 * Verified by: src/dom/__tests__/hydrate.test.ts > "disposes the adopted branch bindings when the server content is dropped"
 */
function adoptShowRegion(desc: ShowDescriptor, start: Comment, end: Comment): void {
  let adoptedDispose: (() => void) | null = null;
  if (desc.initialBranch != null) {
    adoptedDispose = createRoot((dispose) => {
      adoptBranchContent(desc.initialBranch, start, end);
      return dispose;
    });
  }
  setupShowEffect(desc, start, end, adoptedDispose);
}

/**
 * Set up the reactive show effect after hydration adoption.
 *
 * During initial hydration, content is adopted in place (no DOM movement).
 * On each toggle the outgoing branch is scooped into a fragment and the
 * incoming branch is either re-inserted from its cached fragment or built by
 * its factory. Two properties this relies on:
 *
 * 1. A branch is built inside `createRoot` + `untrack` (as the CSR path in
 *    show.ts does). Without untrack, the branch's own bindings become
 *    dependencies of THIS effect and alien-signals tears them down on the next
 *    toggle, so a cached branch would come back frozen. A cached branch is
 *    deliberately NOT disposed while it waits off-DOM — its effects keep
 *    writing to the detached nodes, which is what makes re-insertion show
 *    current data. The cost is that a hidden branch keeps recomputing; it is
 *    reclaimed when the island root is disposed.
 * 2. Server-rendered content is never cached under a branch label. Which branch
 *    the server rendered cannot be recovered from the DOM (both branches can
 *    produce identical tags), so if the client condition disagrees with the
 *    server the label would be wrong forever: the false branch would keep
 *    re-inserting the server's truthy UI. The adopted content is therefore
 *    dropped (and its bindings disposed) the first time it leaves the DOM, and
 *    the branch is rebuilt from its factory when the condition returns.
 *
 * Verified by: src/dom/__tests__/hydrate.test.ts > "forward mismatch: the server branch is never re-inserted as the other branch across repeated toggles"
 * Verified by: src/dom/__tests__/hydrate.test.ts > "forward mismatch with no whenFalse: the server content does not come back as the false branch"
 * Verified by: src/dom/__tests__/hydrate.test.ts > "a branch built by its factory keeps updating after a toggle round-trip"
 */
function setupShowEffect(
  desc: ShowDescriptor,
  start: Comment,
  end: Comment,
  adoptedDispose: (() => void) | null,
): void {
  let currentCondition = !!untrack(() => desc.condition());

  // Cached branch fragments and the disposer of the root owning each one.
  let thenFragment: DocumentFragment | null = null;
  let thenDispose: (() => void) | null = null;
  let elseFragment: DocumentFragment | null = null;
  let elseDispose: (() => void) | null = null;

  // Disposer for whatever is between the markers right now.
  let currentDispose: (() => void) | null = adoptedDispose;
  // True while the content between the markers is the server's.
  let holdingSSR = start.nextSibling !== end;

  /** Build a branch in its own root; records its disposer as the current one. */
  const renderBranch = (cond: boolean): Node | null => {
    const factory = cond ? desc.whenTrue : desc.whenFalse;
    if (!factory) return null;
    let branchDispose!: () => void;
    const node = createRoot((dispose) => {
      branchDispose = dispose;
      return untrack(() => {
        const raw = factory();
        // ensureNode covers a factory that returns a descriptor (possible when
        // the branch was pre-computed during hydration mode).
        return raw instanceof Node ? raw : ensureNode(raw);
      });
    });
    if (!node) {
      branchDispose();
      return null;
    }
    currentDispose = branchDispose;
    return node;
  };

  // Mismatch repair, both directions. `initialBranch` is what the client would
  // render right now (createShow computed it from the live condition), so
  // comparing "does the client branch have content" against "does the region
  // have content" catches the two cases the DOM can actually prove.
  if (holdingSSR && desc.initialBranch == null) {
    if (__DEV__) console.warn('[forma] Hydration: show condition mismatch — client branch renders nothing but SSR left content');
    extractContentBetweenMarkers(start, end); // dropped
    if (currentDispose) {
      currentDispose();
      currentDispose = null;
    }
    holdingSSR = false;
  } else if (!holdingSSR && desc.initialBranch != null) {
    if (__DEV__) console.warn('[forma] Hydration: show condition mismatch — SSR empty but the client branch has content');
    const branch = renderBranch(currentCondition);
    if (branch) start.parentNode!.insertBefore(branch, end);
  }

  internalEffect(() => {
    const next = !!desc.condition();
    if (next === currentCondition) return;
    currentCondition = next;

    const parent = start.parentNode;
    if (!parent) return;

    const leaving = extractContentBetweenMarkers(start, end);

    if (holdingSSR) {
      // Unlabellable server content — drop it and its bindings (see 2 above).
      holdingSSR = false;
      if (currentDispose) currentDispose();
    } else if (next) {
      // We were showing the false branch.
      elseFragment = leaving;
      elseDispose = currentDispose;
    } else {
      thenFragment = leaving;
      thenDispose = currentDispose;
    }
    currentDispose = null;

    let branch: Node | null;
    if (next) {
      if (thenFragment) {
        branch = thenFragment;
        currentDispose = thenDispose;
        thenFragment = null;
        thenDispose = null;
      } else {
        branch = renderBranch(true);
      }
    } else if (elseFragment) {
      branch = elseFragment;
      currentDispose = elseDispose;
      elseFragment = null;
      elseDispose = null;
    } else {
      branch = renderBranch(false);
    }

    if (branch) parent.insertBefore(branch, end);
  });

  // Branch roots created during a later toggle have no lexical parent root, so
  // register an explicit teardown for every root this show owns — the one in
  // the DOM and the cached ones, whose effects are still live by design.
  registerDisposer(() => {
    if (currentDispose) currentDispose();
    if (thenDispose) thenDispose();
    if (elseDispose) elseDispose();
    currentDispose = thenDispose = elseDispose = null;
    thenFragment = elseFragment = null;
  });
}

// ---------------------------------------------------------------------------
// adoptListRegion() — adopt an f:lN region against a ListDescriptor
// ---------------------------------------------------------------------------

/**
 * One row of an adopted list: the index signal reconcileList keeps in sync and
 * the disposer of the row's reactive root.
 *
 * Unlike CachedItem in list.ts this holds no element/item copy, because the
 * adopted list path does not implement `updateOnItemChange: 'rerender'` — a
 * same-key row whose item object changed keeps its server DOM until the key
 * changes. Storing them would only be write-only state.
 */
interface AdoptedRow {
  getIndex: () => number;
  setIndex: (v: number) => void;
  dispose: () => void;
}

/**
 * Bind a server-rendered row: re-run renderFn in hydration mode (which builds
 * NO DOM — h() returns descriptors) and walk the descriptor against the server
 * row, so the row's event handlers and reactive bindings attach exactly like
 * they do for any other adopted element. Returns the element that is in the DOM
 * afterwards — the server row, or a replacement if its tag does not match.
 *
 * A renderFn that builds DOM directly instead of calling h() has no descriptor
 * to adopt; the server row is kept unchanged and the throwaway node is dropped,
 * which is the old behaviour for every row.
 *
 * Verified by: src/dom/__tests__/list-hydration.test.ts > "attaches event handlers from renderFn to adopted SSR rows"
 */
function adoptRow(
  renderFn: (item: unknown, index: () => number) => HTMLElement,
  item: unknown,
  getIndex: () => number,
  rowEl: HTMLElement,
): HTMLElement {
  const prevHydrating = hydrating;
  hydrating = true;
  let rendered: unknown;
  try {
    rendered = untrack(() => renderFn(item, getIndex));
  } finally {
    hydrating = prevHydrating;
  }

  if (!isDescriptor(rendered)) return rowEl;

  if (rowEl.tagName !== rendered.tag.toUpperCase()) {
    // Tag drift: adoptNode would replaceWith() and we would lose track of the
    // live node, so do the replacement here where the caller sees the result.
    const fresh = descriptorToElement(rendered) as HTMLElement;
    rowEl.replaceWith(fresh);
    return fresh;
  }

  adoptNode(rendered, rowEl);
  return rowEl;
}

/**
 * Adopt the SSR rows inside one `f:lN` region and attach the reconcile effect
 * that keeps them in sync afterwards.
 *
 * Every row — adopted or freshly rendered — owns a reactive root, and that
 * root is disposed when the row leaves the list or when the island is torn
 * down. Without it the row's bindings stay subscribed to shared signals and
 * keep writing into detached DOM for the lifetime of the page (the CSR path in
 * list.ts has always done this; adoption did not).
 *
 * Verified by: src/dom/__tests__/list-hydration.test.ts > "disposes the effects of a row removed after adoption"
 * Verified by: src/dom/__tests__/list-hydration.test.ts > "disposes every row when the island root is disposed"
 */
function adoptListRegion(desc: ListDescriptor, start: Comment, end: Comment): void {
  const listKeyFn = desc.keyFn;
  const listRenderFn = desc.renderFn;

  // Walk DOM between markers, collect SSR rows.
  const ssrKeyMap = new Map<string, HTMLElement>();
  const ssrElements: HTMLElement[] = [];
  const duplicateRows: HTMLElement[] = [];
  let node: Node | null = start.nextSibling;
  while (node && node !== end) {
    if (node.nodeType === 1) {
      const el = node as HTMLElement;
      const key = el.getAttribute('data-forma-key');
      if (key != null && ssrKeyMap.has(key)) {
        // Duplicate data-forma-key: only one row can be matched to the item
        // with that key, and the loser is tracked by nothing afterwards — it
        // would sit between the markers forever as a row reconcileList never
        // sees. First occurrence wins; the rest are removed here.
        //
        // Verified by: src/dom/__tests__/list-hydration.test.ts > "removes a duplicate data-forma-key row instead of leaving a ghost"
        if (__DEV__) console.warn(`[FormaJS] Hydration: duplicate data-forma-key "${key}" in list — removing the extra SSR row`);
        duplicateRows.push(el);
      } else {
        ssrElements.push(el);
        if (key != null) ssrKeyMap.set(key, el);
      }
    }
    node = node.nextSibling;
  }
  for (const dup of duplicateRows) {
    if (dup.parentNode) dup.parentNode.removeChild(dup);
  }

  // Read current items without tracking (we set up our own effect below)
  const currentItems = untrack(() => desc.items()) as unknown[];

  // Fallback: if no SSR elements have data-forma-key, match by index
  const useIndexFallback = ssrKeyMap.size === 0 && ssrElements.length > 0;

  // key → row state, so index signals can be updated after reconcileList
  // reorders items and each row's root can be disposed with the row
  // (same pattern as the non-hydration createList in list.ts).
  let cache = new Map<string | number, AdoptedRow>();
  const adoptedNodes: Node[] = [];
  const adoptedItems: unknown[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < currentItems.length; i++) {
    const item = currentItems[i];
    const key = listKeyFn(item);

    let ssrNode: HTMLElement | undefined;
    if (useIndexFallback) {
      // Index-based matching: SSR elements lack keys, adopt by position
      if (i < ssrElements.length) {
        ssrNode = ssrElements[i];
        usedIndices.add(i);
      }
    } else {
      // Key-based matching: SSR keys from getAttribute() are always strings
      ssrNode = ssrKeyMap.get(String(key));
      if (ssrNode) ssrKeyMap.delete(String(key));
    }

    const [getIndex, setIndex] = createSignal(i);
    let rowDispose!: () => void;
    let element: HTMLElement;

    if (ssrNode) {
      const row = ssrNode;
      element = createRoot((dispose) => {
        rowDispose = dispose;
        return adoptRow(listRenderFn, item, getIndex, row);
      });
    } else {
      // Not found in SSR — render fresh, exit hydration mode temporarily
      if (__DEV__) console.warn(`[FormaJS] Hydration: list item key "${key}" not found in SSR — rendering fresh`);
      const prevHydrating = hydrating;
      hydrating = false;
      try {
        element = createRoot((dispose) => {
          rowDispose = dispose;
          return untrack(() => listRenderFn(item, getIndex));
        });
        end.parentNode!.insertBefore(element, end);
      } finally {
        hydrating = prevHydrating;
      }
    }

    cache.set(key, { getIndex, setIndex, dispose: rowDispose });
    adoptedNodes.push(element);
    adoptedItems.push(item);
  }

  // Remove unused SSR nodes (keys that weren't matched, or excess index-based)
  if (useIndexFallback) {
    for (let i = 0; i < ssrElements.length; i++) {
      if (!usedIndices.has(i) && ssrElements[i]!.parentNode) {
        ssrElements[i]!.parentNode!.removeChild(ssrElements[i]!);
      }
    }
  } else {
    for (const [unusedKey, unusedNode] of ssrKeyMap) {
      if (__DEV__) console.warn(`[FormaJS] Hydration: removing extra SSR list item with key "${unusedKey}"`);
      if (unusedNode.parentNode) {
        unusedNode.parentNode.removeChild(unusedNode);
      }
    }
  }

  // Reorder adopted nodes to match item order (insert before end marker)
  const parent = start.parentNode!;
  for (const adoptedNode of adoptedNodes) {
    parent.insertBefore(adoptedNode, end);
  }

  let reconcileNodes: Node[] = adoptedNodes.slice();
  let reconcileItems: unknown[] = adoptedItems.slice();

  // Attach reactive effect that calls reconcileList for subsequent updates
  internalEffect(() => {
    const newItems = desc.items() as unknown[];

    // The parent is discovered lazily: once inserted into the live DOM
    const listParent = start.parentNode;
    if (!listParent) return;

    const result = reconcileList(
      listParent,
      reconcileItems,
      newItems,
      reconcileNodes,
      listKeyFn,
      (item: unknown) => {
        const prevHydrating = hydrating;
        hydrating = false;
        try {
          const key = listKeyFn(item);
          const [getIndex, setIndex] = createSignal(0);
          let rowDispose!: () => void;
          const element = createRoot((dispose) => {
            rowDispose = dispose;
            return untrack(() => listRenderFn(item, getIndex));
          });
          cache.set(key, { getIndex, setIndex, dispose: rowDispose });
          return element;
        } finally {
          hydrating = prevHydrating;
        }
      },
      // updateFn: reused rows keep their DOM. The index signal is refreshed in
      // the pass below, so there is nothing to do per reused row here.
      () => {},
      end,
    );

    // Rebuild cache + update index signals in a single pass
    const newCache = new Map<string | number, AdoptedRow>();
    for (let i = 0; i < newItems.length; i++) {
      const key = listKeyFn(newItems[i]!);
      const cached = cache.get(key);
      if (cached) {
        cached.setIndex(i);
        newCache.set(key, cached);
      }
    }

    // Dispose removed rows' reactive roots (createList does the same).
    for (const [key, cached] of cache) {
      if (!newCache.has(key)) cached.dispose();
    }
    cache = newCache;

    reconcileNodes = result.nodes;
    reconcileItems = result.items;
  });

  // Rows created by a later reconcile have no lexical parent root (the effect
  // runs during a flush), so their roots would survive island teardown if the
  // cache did not dispose them explicitly.
  registerDisposer(() => {
    for (const cached of cache.values()) cached.dispose();
    cache = new Map();
    reconcileNodes = [];
    reconcileItems = [];
  });
}

// ---------------------------------------------------------------------------
// adoptBranchContent() — walk nested show/list descriptors in SSR content
// ---------------------------------------------------------------------------

/** Find the first `f:<kind>N` start marker between two markers (exclusive). */
function nextMarkerBetween(
  regionStart: Comment,
  regionEnd: Comment,
  isStart: (data: string) => boolean,
): Comment | null {
  let node: ChildNode | null = regionStart.nextSibling;
  while (node && node !== regionEnd) {
    if (node.nodeType === 8 && isStart((node as Comment).data)) return node as Comment;
    node = node.nextSibling;
  }
  return null;
}

/**
 * Recursively adopt the content between show markers against a descriptor
 * that may be a HydrationDescriptor, ShowDescriptor, or ListDescriptor.
 *
 * This handles the case where a branch is not a plain element: the outer show's
 * initialBranch can itself be a ShowDescriptor or a ListDescriptor (e.g.
 * `createShow(cond, () => createList(...))` with no wrapper element), so we
 * find the inner SSR markers and walk into them. adoptNode only reaches list
 * markers while walking an ELEMENT's children, so a bare list branch would
 * otherwise keep its server rows with no reconcile effect bound to them.
 */
function adoptBranchContent(
  desc: unknown,
  regionStart: Comment,
  regionEnd: Comment,
): void {
  if (isDescriptor(desc)) {
    // Plain element — find it between markers and adopt
    const el = nextElementBetweenMarkers(regionStart, regionEnd);
    if (el) adoptNode(desc, el);
  } else if (isShowDescriptor(desc)) {
    // Nested show — find inner show markers between region markers
    const innerStart = nextMarkerBetween(regionStart, regionEnd, isShowStart);
    if (innerStart) {
      const innerEnd = findClosingMarker(innerStart);
      if (innerEnd) adoptShowRegion(desc, innerStart, innerEnd);
    }
  } else if (isListDescriptor(desc)) {
    // Bare list branch — find its f:lN region between the show markers.
    const innerStart = nextMarkerBetween(regionStart, regionEnd, isListStart);
    if (innerStart) {
      const innerEnd = findClosingMarker(innerStart);
      if (innerEnd) adoptListRegion(desc, innerStart, innerEnd);
    }
  }
}

// ---------------------------------------------------------------------------
// adoptNode() — top-down descriptor walk with DOM cursor
// ---------------------------------------------------------------------------

/**
 * Walk a descriptor tree top-down, matching each descriptor against the
 * corresponding SSR DOM using a childNode cursor. Attaches event handlers
 * and reactive bindings without creating new DOM nodes.
 *
 * The cursor approach handles:
 * - Island markers (<!--f:iN-->): creates real DOM from descriptor
 * - Show markers (<!--f:sN-->): binds show effects or reactive text
 * - Text markers (<!--f:tN-->): binds reactive text effects
 * - Tag mismatches: falls back to descriptorToElement()
 */
export function adoptNode(
  desc: HydrationDescriptor,
  ssrEl: Element | undefined,
): void {
  // Mismatch check
  if (!ssrEl || ssrEl.tagName !== desc.tag.toUpperCase()) {
    if (__DEV__) console.warn(`Hydration mismatch: expected <${desc.tag}>, got <${ssrEl?.tagName?.toLowerCase() ?? 'nothing'}>`);
    const fresh = descriptorToElement(desc);
    if (ssrEl) ssrEl.replaceWith(fresh);
    return;
  }

  // Attach dynamic props
  applyDynamicProps(ssrEl, desc.props);

  // Walk children via DOM cursor (instead of children[index])
  let cursor: ChildNode | null = ssrEl.firstChild;

  for (const child of desc.children) {
    // Skip falsy children
    if (child === false || child == null) continue;

    if (isDescriptor(child)) {
      // Skip whitespace-only text nodes
      while (cursor && cursor.nodeType === 3 && !(cursor as Text).data.trim()) {
        cursor = cursor.nextSibling;
      }

      // Skip child island elements — they are handled by their own activation
      while (cursor && cursor.nodeType === 1 &&
             (cursor as Element).hasAttribute('data-forma-island')) {
        cursor = cursor.nextSibling;
      }

      if (!cursor) {
        // No more DOM nodes — append fresh
        ssrEl.appendChild(descriptorToElement(child));
        continue;
      }

      if (cursor.nodeType === 1) {
        // Element node — adopt recursively
        const el = cursor as Element;
        cursor = cursor.nextSibling;
        adoptNode(child, el);
      } else if (cursor.nodeType === 8 && isIslandStart((cursor as Comment).data)) {
        // Island region. The compiler always emits a shell element between
        // ISLAND_START/ISLAND_END (emitIsland writes either the resolved
        // component root or a plain <div>), and the walker stamps the
        // data-forma-* attributes onto it. That shell is activateIslands'
        // business: creating DOM from our descriptor here would put a second
        // copy of the island's content next to the server's, and — for a
        // registered child — hydrate it twice. Only a genuinely empty region
        // (no server output at all) is filled from the descriptor.
        //
        // Verified by: src/dom/__tests__/hydrate.test.ts > "does not duplicate a nested island that already has an SSR shell"
        const islandStart = cursor as Comment;
        const end = findClosingMarker(islandStart);
        const shell = end ? nextElementBetweenMarkers(islandStart, end) : undefined;
        if (shell && end) {
          cursor = end.nextSibling;
        } else {
          const fresh = descriptorToElement(child);
          if (end) {
            end.parentNode!.insertBefore(fresh, end);
            cursor = end.nextSibling;
          } else {
            ssrEl.appendChild(fresh);
            cursor = null;
          }
        }
      } else {
        // Unexpected node — create fresh and append
        ssrEl.appendChild(descriptorToElement(child));
      }

    } else if (isShowDescriptor(child)) {
      // Advance cursor to next show marker
      while (cursor && !(cursor.nodeType === 8 && isShowStart((cursor as Comment).data))) {
        cursor = cursor.nextSibling;
      }

      if (cursor) {
        const start = cursor as Comment;
        const end = findClosingMarker(start);
        if (end) {
          // adoptShowRegion walks the initial branch against the SSR content
          // between the markers (element, nested show, or bare list) and then
          // installs the toggle effect.
          adoptShowRegion(child, start, end);
          cursor = end.nextSibling;
        }
      }

    } else if (isListDescriptor(child)) {
      // Advance cursor to next list marker
      while (cursor && !(cursor.nodeType === 8 && isListStart((cursor as Comment).data))) {
        cursor = cursor.nextSibling;
      }

      if (cursor) {
        const start = cursor as Comment;
        const end = findClosingMarker(start);
        if (end) {
          adoptListRegion(child, start, end);
          cursor = end.nextSibling;
        }
      }

    } else if (typeof child === 'function') {
      // Reactive binding — could be text (signal getter) or element (returns descriptor).
      // Peek at the return value to determine type before choosing the adoption path.
      while (cursor && cursor.nodeType === 3 && !(cursor as Text).data.trim()) {
        cursor = cursor.nextSibling;
      }

      // If cursor is at an element, check whether function returns a descriptor
      if (cursor && cursor.nodeType === 1) {
        const initial = (child as () => unknown)();
        if (isDescriptor(initial)) {
          // Function returned a descriptor — adopt the element at cursor
          const el = cursor as Element;
          cursor = cursor.nextSibling;
          adoptNode(initial, el);
          continue;
        }
        // Not a descriptor — fall through to text handling
      }

      if (cursor && cursor.nodeType === 8) {
        const data = (cursor as Comment).data;

        if (isTextStart(data)) {
          // Text marker: <!--f:tN-->text<!--/f:tN-->
          const endMarker = findClosingMarker(cursor as Comment);
          let textNode = cursor.nextSibling;
          if (!textNode || textNode.nodeType !== 3) {
            // Defensive fallback: SSR should have emitted a text node between
            // markers. If missing, create one — but warn in dev mode.
            if (__DEV__) console.warn(`[FormaJS] Hydration: created text node for marker ${data} — SSR walker should emit content between markers`);
            const created = document.createTextNode('');
            cursor.parentNode!.insertBefore(created, endMarker || cursor.nextSibling);
            textNode = created;
          }
          internalEffect(() => {
            (textNode as Text).data = String((child as () => unknown)());
          });
          cursor = endMarker ? endMarker.nextSibling : textNode.nextSibling;
        } else if (isShowStart(data)) {
          // Show marker used for reactive text (IR compiled inline ternary as ShowIf)
          const start = cursor as Comment;
          const end = findClosingMarker(start);
          if (end) {
            let textNode = findTextBetween(start, end);
            if (!textNode) {
              // Defensive fallback: SSR should have emitted content between
              // show markers for reactive text. Warn in dev mode.
              if (__DEV__) console.warn(`[FormaJS] Hydration: created text node for show marker ${start.data} — SSR walker should emit content between markers`);
              textNode = document.createTextNode('');
              start.parentNode!.insertBefore(textNode, end);
            }
            internalEffect(() => {
              (textNode as Text).data = String((child as () => unknown)());
            });
            cursor = end.nextSibling;
          } else {
            cursor = cursor.nextSibling;
          }
        } else {
          cursor = cursor.nextSibling;
        }
      } else if (cursor && cursor.nodeType === 3) {
        // Existing text node without markers — bind reactive effect directly
        const textNode = cursor as Text;
        cursor = cursor.nextSibling;
        internalEffect(() => {
          textNode.data = String((child as () => unknown)());
        });
      } else {
        // No cursor (empty parent) or unexpected node — SSR element has no
        // children where a reactive text binding is expected. This means the
        // IR didn't cover this part of the component tree. Warn and create.
        if (__DEV__) console.warn(`[FormaJS] Hydration: created text node in empty <${ssrEl.tagName.toLowerCase()}> — IR may not cover this component`);
        const textNode = document.createTextNode('');
        ssrEl.appendChild(textNode);
        internalEffect(() => {
          textNode.data = String((child as () => unknown)());
        });
      }
    } else if (typeof child === 'string' || typeof child === 'number') {
      // Static text — advance cursor past corresponding text node
      if (cursor && cursor.nodeType === 3) {
        cursor = cursor.nextSibling;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// hydrateIsland() — full orchestration
// ---------------------------------------------------------------------------

/**
 * Hydrate an SSR island in-place. Runs the component in hydration mode so
 * h() returns descriptors, then walks the descriptor tree against the SSR DOM
 * to attach event handlers and reactive bindings. No DOM elements are created.
 *
 * The component function MUST be called inside a reactive root (createRoot)
 * so that effects created during adoption are properly tracked.
 *
 * Returns the active root element — usually `target`, but may be a replacement
 * element when the CSR fallback fires (empty island shell replaced by the
 * component's own root element).
 *
 * @param component  A function that builds the UI (calls h(), createShow, etc.)
 * @param target     The container element with `data-forma-ssr` attribute
 */
export function hydrateIsland(component: () => unknown, target: Element): Element {
  // Check if the island has SSR content to hydrate against.
  // An empty island shell (tag + static attrs from compiler, no children)
  // has nothing to hydrate — fall through to CSR mode.
  const hasSSRContent = target.childElementCount > 0 ||
    (target.childNodes.length > 0 &&
     Array.from(target.childNodes).some(n =>
       n.nodeType === 1 || (n.nodeType === 3 && (n as Text).data.trim())));

  if (!hasSSRContent) {
    // CSR fallback: SSR emitted an empty shell element for this island.
    // Run the component in normal (non-hydration) mode and replace the
    // shell with the component's own root element.
    if (__DEV__) {
      const name = target.getAttribute('data-forma-component') || 'unknown';
      console.warn(
        `[forma] Island "${name}" has no SSR content — falling back to CSR. ` +
        `This means the IR walker did not render content between ISLAND_START and ISLAND_END.`,
      );
    }

    const result = component();
    if (result instanceof Element) {
      // Transfer data-forma-* attributes from the shell to the component's root
      for (const attr of Array.from(target.attributes)) {
        if (attr.name.startsWith('data-forma-')) {
          result.setAttribute(attr.name, attr.value);
        }
      }
      target.replaceWith(result);
      return result;
    } else if (result instanceof Node) {
      target.appendChild(result);
    }
    return target;
  }

  // 1. Enter hydration mode (h() returns descriptors)
  setHydrating(true);

  // 2. Run component — builds descriptor tree, zero DOM work
  let descriptor: unknown;
  try {
    descriptor = component();
  } finally {
    // 3. Exit hydration mode
    setHydrating(false);
  }

  // Guard: if component returned nothing (e.g. mock fn in tests, or simple
  // islands that only set up effects), skip adoption entirely.
  if (!descriptor || !isDescriptor(descriptor)) {
    target.removeAttribute('data-forma-ssr');
    return target;
  }

  // 4. Walk descriptor tree top-down against SSR DOM.
  // For island activation: the target IS the island root element (has
  // data-forma-island). Adopt directly on target.
  // For mount() container pattern: target is a wrapper, adopt on target.children[0].
  if (target.hasAttribute('data-forma-island')) {
    adoptNode(descriptor, target);
  } else {
    adoptNode(descriptor, target.children[0] as Element);
  }

  // 5. Remove SSR marker
  target.removeAttribute('data-forma-ssr');
  return target;
}

