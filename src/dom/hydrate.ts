/**
 * FormaJS DOM - Hydrate
 *
 * Descriptor-based island hydration. During hydration, h() returns plain
 * descriptor objects instead of DOM elements. A top-down walk (adoptNode)
 * then matches these descriptors against SSR DOM to attach events and
 * reactive bindings. No DOM elements are created during hydration.
 */

import { internalEffect, createSignal, untrack, __DEV__ } from 'forma/reactive';
import { h } from './element.js';
import { reconcileList, createList } from './list.js';
import { createShow } from './show.js';

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
  show: Map<number, { start: Comment; end: Comment; cachedContent: DocumentFragment | null }>;
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
  const show = new Map<number, { start: Comment; end: Comment; cachedContent: DocumentFragment | null }>();
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

      // Text marker: "f:t<index>"
      if (data.length >= 4 && data.charCodeAt(0) === 102 /* f */ && data.charCodeAt(1) === 58 /* : */ && data.charCodeAt(2) === 116 /* t */) {
        const idx = parseInt(data.slice(3), 10);
        if (!isNaN(idx)) {
          // The text node is the next sibling
          const next = node.nextSibling;
          if (next && next.nodeType === Node.TEXT_NODE) {
            text.set(idx, next as Text);
          }
        }
        continue;
      }

      // Show opening marker: "f:s<index>"
      if (data.length >= 4 && data.charCodeAt(0) === 102 /* f */ && data.charCodeAt(1) === 58 /* : */ && data.charCodeAt(2) === 115 /* s */) {
        const idx = parseInt(data.slice(3), 10);
        if (!isNaN(idx)) {
          pendingShow.set(idx, node as Comment);
        }
        continue;
      }

      // Show closing marker: "/f:s<index>"
      if (data.length >= 5 && data.charCodeAt(0) === 47 /* / */ && data.charCodeAt(1) === 102 /* f */ && data.charCodeAt(2) === 58 /* : */ && data.charCodeAt(3) === 115 /* s */) {
        const idx = parseInt(data.slice(4), 10);
        if (!isNaN(idx)) {
          const start = pendingShow.get(idx);
          if (start) {
            show.set(idx, { start, end: node as Comment, cachedContent: null });
            pendingShow.delete(idx);
          }
        }
        continue;
      }

      // List opening marker: "f:l<index>"
      if (data.length >= 4 && data.charCodeAt(0) === 102 /* f */ && data.charCodeAt(1) === 58 /* : */ && data.charCodeAt(2) === 108 /* l */) {
        const idx = parseInt(data.slice(3), 10);
        if (!isNaN(idx)) {
          pendingList.set(idx, node as Comment);
        }
        continue;
      }

      // List closing marker: "/f:l<index>"
      if (data.length >= 5 && data.charCodeAt(0) === 47 /* / */ && data.charCodeAt(1) === 102 /* f */ && data.charCodeAt(2) === 58 /* : */ && data.charCodeAt(3) === 108 /* l */) {
        const idx = parseInt(data.slice(4), 10);
        if (!isNaN(idx)) {
          const start = pendingList.get(idx);
          if (start) {
            list.set(idx, { start, end: node as Comment });
            pendingList.delete(idx);
          }
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
 * Attach event handlers and reactive attribute bindings to an existing
 * SSR element. Static (non-function) props are skipped because they are
 * already baked into the server HTML.
 */
export function applyDynamicProps(el: Element, props: Record<string, unknown> | null): void {
  if (!props) return;

  for (const key in props) {
    const value = props[key];

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

    // Reactive attribute binding (function, non-event)
    const fn = value as () => unknown;
    const attrKey = key; // capture for closure
    internalEffect(() => {
      const v = fn();
      if (v === false || v == null) {
        el.removeAttribute(attrKey);
      } else if (v === true) {
        el.setAttribute(attrKey, '');
      } else {
        el.setAttribute(attrKey, String(v));
      }
    });
  }
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
  return data.length >= 4 && data.charCodeAt(0) === 102 /* f */ && data.charCodeAt(1) === 58 /* : */ && data.charCodeAt(2) === 105 /* i */;
}

/** Check if comment data is a show start marker (f:sN). */
function isShowStart(data: string): boolean {
  return data.length >= 4 && data.charCodeAt(0) === 102 /* f */ && data.charCodeAt(1) === 58 /* : */ && data.charCodeAt(2) === 115 /* s */;
}

/** Check if comment data is a text marker (f:tN). */
function isTextStart(data: string): boolean {
  return data.length >= 4 && data.charCodeAt(0) === 102 /* f */ && data.charCodeAt(1) === 58 /* : */ && data.charCodeAt(2) === 116 /* t */;
}

/** Check if comment data is a list start marker (f:lN). */
function isListStart(data: string): boolean {
  return data.length >= 4 && data.charCodeAt(0) === 102 /* f */ && data.charCodeAt(1) === 58 /* : */ && data.charCodeAt(2) === 108 /* l */;
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
 * Set up reactive show effect after hydration adoption.
 *
 * During initial hydration, content is adopted in place (no DOM movement).
 * On first toggle, current content is scooped into a cached fragment.
 * Subsequent toggles swap between cached fragments (pure DOM moves, no re-render).
 */
function setupShowEffect(
  desc: ShowDescriptor,
  marker: { start: Comment; end: Comment; cachedContent: DocumentFragment | null },
): void {
  let currentCondition = !!desc.condition();
  let thenFragment: DocumentFragment | null = null;
  let elseFragment: DocumentFragment | null = null;

  // Reverse mismatch: SSR is empty but client condition is true.
  // Insert truthy content immediately so the user sees correct content.
  const hasSSRContent = marker.start.nextSibling !== marker.end;
  if (!hasSSRContent && currentCondition) {
    if (__DEV__) console.warn('[forma] Hydration: show condition mismatch — SSR empty but client condition is true');
    const trueBranch = desc.whenTrue();
    if (trueBranch instanceof Node) {
      marker.start.parentNode!.insertBefore(trueBranch, marker.end);
    }
  }

  internalEffect(() => {
    const next = !!desc.condition();
    if (next === currentCondition) return;
    currentCondition = next;

    const parent = marker.start.parentNode;
    if (!parent) return;

    // Cache current content
    const current = extractContentBetweenMarkers(marker.start, marker.end);
    if (!next) {
      thenFragment = current;
    } else {
      elseFragment = current;
    }

    // Insert the appropriate branch: cached fragment if available, else factory
    let branch: unknown = next
      ? (thenFragment ?? desc.whenTrue())
      : (desc.whenFalse ? (elseFragment ?? desc.whenFalse()) : null);

    if (next && thenFragment) thenFragment = null; // consumed
    if (!next && elseFragment) elseFragment = null; // consumed

    // Convert hydration descriptors to real DOM (happens when SSR/client
    // branch mismatch causes the factory to return a pre-computed descriptor)
    if (branch != null && !(branch instanceof Node)) {
      branch = ensureNode(branch);
    }

    if (branch instanceof Node) {
      parent.insertBefore(branch, marker.end);
    }
  });
}

// ---------------------------------------------------------------------------
// adoptBranchContent() — walk nested show/list descriptors in SSR content
// ---------------------------------------------------------------------------

/**
 * Recursively adopt the content between show markers against a descriptor
 * that may be a HydrationDescriptor, ShowDescriptor, or ListDescriptor.
 *
 * This handles the case where createShow nests: the outer show's
 * initialBranch is itself a ShowDescriptor (not a plain element), so we
 * need to find inner SSR markers and walk into them.
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
    let node: ChildNode | null = regionStart.nextSibling;
    while (node && node !== regionEnd) {
      if (node.nodeType === 8 && isShowStart((node as Comment).data)) {
        const innerStart = node as Comment;
        const innerEnd = findClosingMarker(innerStart);
        if (innerEnd) {
          // Recursively adopt the inner show's content
          if (desc.initialBranch) {
            adoptBranchContent(desc.initialBranch, innerStart, innerEnd);
          }
          // Set up the inner show's toggle effect
          setupShowEffect(desc, { start: innerStart, end: innerEnd, cachedContent: null });
        }
        break;
      }
      node = node.nextSibling;
    }
  }
  // ListDescriptor adoption within show markers is handled by the existing
  // list adoption code in adoptNode when it encounters list markers.
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
        // Island marker — create real DOM and insert before end marker
        const end = findClosingMarker(cursor as Comment);
        const fresh = descriptorToElement(child);
        if (end) {
          end.parentNode!.insertBefore(fresh, end);
          cursor = end.nextSibling;
        } else {
          ssrEl.appendChild(fresh);
          cursor = null;
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
          if (child.initialBranch) {
            // Walk the initial branch against SSR content between markers.
            // initialBranch can be a HydrationDescriptor (element), ShowDescriptor
            // (nested show), or ListDescriptor — adoptBranchContent handles all.
            adoptBranchContent(child.initialBranch, start, end);
          }
          setupShowEffect(child, { start, end, cachedContent: null });
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
          // Walk DOM between markers, collect SSR elements
          const ssrKeyMap = new Map<string | number, HTMLElement>();
          const ssrElements: HTMLElement[] = [];
          let node: Node | null = start.nextSibling;
          while (node && node !== end) {
            if (node.nodeType === 1) {
              const el = node as HTMLElement;
              ssrElements.push(el);
              const key = el.getAttribute('data-forma-key');
              if (key != null) {
                ssrKeyMap.set(key, el);
              }
            }
            node = node.nextSibling;
          }

          // Read current items without tracking (we set up our own effect below)
          const currentItems = untrack(() => child.items()) as any[];
          const listKeyFn = child.keyFn;
          const listRenderFn = child.renderFn;

          // Fallback: if no SSR elements have data-forma-key, match by index
          const useIndexFallback = ssrKeyMap.size === 0 && ssrElements.length > 0;

          // Match current items to SSR nodes by key (or index fallback)
          const adoptedNodes: Node[] = [];
          const adoptedItems: any[] = [];
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

            if (ssrNode) {
              // Reuse SSR element
              adoptedNodes.push(ssrNode);
              adoptedItems.push(item);
            } else {
              // Not found in SSR — render fresh, exit hydration mode temporarily
              if (__DEV__) console.warn(`[FormaJS] Hydration: list item key "${key}" not found in SSR — rendering fresh`);
              const prevHydrating = hydrating;
              hydrating = false;
              try {
                const [getIndex] = createSignal(i);
                const fresh = listRenderFn(item, getIndex);
                // Insert before end marker
                end.parentNode!.insertBefore(fresh, end);
                adoptedNodes.push(fresh);
                adoptedItems.push(item);
              } finally {
                hydrating = prevHydrating;
              }
            }
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

          // Set up state for reactive reconciliation.
          // Cache maps key → { element, item, getIndex, setIndex } so that
          // index signals can be updated after reconcileList reorders items
          // (same pattern as the non-hydration createList in list.ts).
          let cache = new Map<string | number, {
            element: HTMLElement;
            item: any;
            getIndex: () => number;
            setIndex: (v: number) => void;
          }>();

          // Seed cache with adopted items
          for (let i = 0; i < adoptedItems.length; i++) {
            const item = adoptedItems[i];
            const key = listKeyFn(item);
            const [getIndex, setIndex] = createSignal(i);
            cache.set(key, {
              element: adoptedNodes[i] as HTMLElement,
              item,
              getIndex,
              setIndex,
            });
          }

          let reconcileNodes = adoptedNodes.slice();
          let reconcileItems = adoptedItems.slice();

          // Attach reactive effect that calls reconcileList for subsequent updates
          internalEffect(() => {
            const newItems = child.items() as any[];

            // The parent is discovered lazily: once inserted into the live DOM
            const parent = start.parentNode;
            if (!parent) return;

            const result = reconcileList(
              parent,
              reconcileItems,
              newItems,
              reconcileNodes,
              listKeyFn,
              (item: any) => {
                const prevHydrating = hydrating;
                hydrating = false;
                try {
                  const key = listKeyFn(item);
                  const [getIndex, setIndex] = createSignal(0);
                  const element = untrack(() => listRenderFn(item, getIndex));
                  cache.set(key, { element, item, getIndex, setIndex });
                  return element;
                } finally {
                  hydrating = prevHydrating;
                }
              },
              (_node: Node, item: any) => {
                const key = listKeyFn(item);
                const cached = cache.get(key);
                if (cached) cached.item = item;
              },
              end,
            );

            // Rebuild cache + update index signals in a single pass
            const newCache = new Map<string | number, typeof cache extends Map<any, infer V> ? V : never>();
            for (let i = 0; i < newItems.length; i++) {
              const key = listKeyFn(newItems[i]!);
              const cached = cache.get(key);
              if (cached) {
                cached.setIndex(i);
                newCache.set(key, cached);
              }
            }
            cache = newCache;

            reconcileNodes = result.nodes;
            reconcileItems = result.items;
          });

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

