/**
 * Forma DOM - List
 *
 * Keyed list reconciliation with Longest Increasing Subsequence (LIS).
 * The LIS tells us the maximum set of DOM nodes that can stay in place;
 * only the remaining nodes need to be moved. This minimises DOM operations
 * to exactly `n - LIS_length` moves — provably optimal.
 *
 * Algorithm used by ivi, Inferno, and (with variations) Solid, Vue 3, Svelte.
 *
 * Uses comment-node markers instead of a wrapper <div>, so the list can be
 * placed inside <table>, <ul>, <select>, etc. without breaking semantics.
 *
 * Total module budget: <2KB minified.
 */

import { createSignal, internalEffect, untrack, __DEV__ } from '../reactive';
import { hydrating } from './hydrate.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Return value from {@link reconcileList} — the new nodes and items arrays. */
export interface ReconcileResult<T> {
  /** The DOM nodes currently in the list, in order. */
  nodes: Node[];
  /** The items array corresponding to the current nodes. */
  items: T[];
}

/** Animation hooks for list transitions. */
export interface ListTransitionHooks {
  /** Called after a new node is inserted into the DOM. */
  onInsert?: (node: Node) => void;
  /** Called before a node is removed. Call `done()` when the exit animation finishes. */
  onBeforeRemove?: (node: Node, done: () => void) => void;
}

interface CachedItem<T> {
  element: HTMLElement;
  item: T;
  getIndex: () => number;
  setIndex: (v: number) => void;
}

export interface CreateListOptions {
  /**
   * How to handle same-key items whose object identity changed.
   * - 'none' (default): keep the existing row node for maximum throughput.
   * - 'rerender': re-render changed rows and patch static row DOM in place.
   */
  updateOnItemChange?: 'none' | 'rerender';
}

// ---------------------------------------------------------------------------
// LIS — O(n log n) via patience sorting + binary search
// ---------------------------------------------------------------------------

/**
 * Find the longest increasing subsequence.
 * Returns indices into the input array.
 * O(n log n) time, O(n) space.
 */
export function longestIncreasingSubsequence(arr: number[]): number[] {
  const n = arr.length;
  if (n === 0) return [];

  // Pre-allocate typed arrays — avoids V8 array growth overhead on push
  const tails = new Int32Array(n);
  const tailIndices = new Int32Array(n);
  const predecessor = new Int32Array(n).fill(-1);
  let tailsLen = 0;

  for (let i = 0; i < n; i++) {
    const val = arr[i]!;

    // Binary search: leftmost tail >= val
    let lo = 0, hi = tailsLen;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < val) lo = mid + 1;
      else hi = mid;
    }

    tails[lo] = val;
    tailIndices[lo] = i;
    if (lo > 0) predecessor[i] = tailIndices[lo - 1]!;
    if (lo >= tailsLen) tailsLen++;
  }

  // Reconstruct — return plain array since callers expect number[]
  const result = new Array<number>(tailsLen);
  let idx = tailIndices[tailsLen - 1]!;
  for (let i = tailsLen - 1; i >= 0; i--) {
    result[i] = idx;
    idx = predecessor[idx]!;
  }

  return result;
}

// ---------------------------------------------------------------------------
// reconcileList — low-level keyed reconciler
// ---------------------------------------------------------------------------

/** Below this threshold, use flat array scan instead of Map for better cache locality. */
const SMALL_LIST_THRESHOLD = 32;
const ABORT_SYM = Symbol.for('forma-abort');
const CACHE_SYM = Symbol.for('forma-attr-cache');
const DYNAMIC_CHILD_SYM = Symbol.for('forma-dynamic-child');

function canPatchStaticElement(target: Node, source: Node): target is HTMLElement {
  return target instanceof HTMLElement
    && source instanceof HTMLElement
    && target.tagName === source.tagName
    && !(target as any)[ABORT_SYM]
    && !(target as any)[CACHE_SYM]
    && !(target as any)[DYNAMIC_CHILD_SYM]
    && !(source as any)[ABORT_SYM]
    && !(source as any)[CACHE_SYM]
    && !(source as any)[DYNAMIC_CHILD_SYM];
}

function patchStaticElement(target: HTMLElement, source: HTMLElement): void {
  // Sync attributes (events/reactive bindings are excluded by canPatchStaticElement).
  const sourceAttrNames = new Set<string>();
  for (const attr of Array.from(source.attributes)) {
    sourceAttrNames.add(attr.name);
    if (target.getAttribute(attr.name) !== attr.value) {
      target.setAttribute(attr.name, attr.value);
    }
  }
  for (const attr of Array.from(target.attributes)) {
    if (!sourceAttrNames.has(attr.name)) {
      target.removeAttribute(attr.name);
    }
  }

  // Move freshly rendered children into the existing keyed node.
  target.replaceChildren(...Array.from(source.childNodes));
}

/**
 * Small-list reconciler: uses flat arrays + indexOf instead of Map/Set.
 * For < 32 items, linear scan is faster than hash computation overhead.
 */
function reconcileSmall<T>(
  parent: Node,
  oldItems: T[],
  newItems: T[],
  oldNodes: Node[],
  keyFn: (item: T) => string | number,
  createFn: (item: T) => Node,
  updateFn: (node: Node, item: T) => void,
  beforeNode?: Node | null,
  hooks?: ListTransitionHooks,
): ReconcileResult<T> {
  const oldLen = oldItems.length;
  const newLen = newItems.length;

  // Build flat arrays for old keys/nodes — better cache locality than Map
  const oldKeys: (string | number)[] = new Array(oldLen);
  for (let i = 0; i < oldLen; i++) {
    oldKeys[i] = keyFn(oldItems[i]!);
  }

  // Classify each new item: find matching old index via linear scan
  const oldIndices = new Array<number>(newLen);
  const oldUsed = new Uint8Array(oldLen); // 0 = unused, 1 = used

  for (let i = 0; i < newLen; i++) {
    const key = keyFn(newItems[i]!);
    let found = -1;
    for (let j = 0; j < oldLen; j++) {
      if (!oldUsed[j] && oldKeys[j] === key) {
        found = j;
        oldUsed[j] = 1;
        break;
      }
    }
    oldIndices[i] = found;
  }

  // Remove old items not reused
  for (let i = 0; i < oldLen; i++) {
    if (!oldUsed[i]) {
      if (hooks?.onBeforeRemove) {
        const node = oldNodes[i]!;
        hooks.onBeforeRemove(node, () => {
          if (node.parentNode) node.parentNode.removeChild(node);
        });
      } else {
        parent.removeChild(oldNodes[i]!);
      }
    }
  }

  // Fast path: same keys, same order -> just update, 0 DOM moves
  if (oldLen === newLen) {
    let allSameOrder = true;
    for (let i = 0; i < newLen; i++) {
      if (oldIndices[i] !== i) {
        allSameOrder = false;
        break;
      }
    }
    if (allSameOrder) {
      const nodes = new Array<Node>(newLen);
      for (let i = 0; i < newLen; i++) {
        const node = oldNodes[i]!;
        updateFn(node, newItems[i]!);
        nodes[i] = node;
      }
      return { nodes, items: newItems };
    }
  }

  // LIS for minimum moves (still needed even for small lists)
  const reusedIndices: number[] = [];
  const reusedPositions: number[] = [];
  for (let i = 0; i < newLen; i++) {
    if (oldIndices[i] !== -1) {
      reusedIndices.push(oldIndices[i]!);
      reusedPositions.push(i);
    }
  }

  const lisOfReused = longestIncreasingSubsequence(reusedIndices);
  // Use Uint8Array as a bitmap instead of Set for small lists
  const lisFlags = new Uint8Array(newLen);
  for (const li of lisOfReused) {
    lisFlags[reusedPositions[li]!] = 1;
  }

  // Build result: walk right-to-left for stable insertBefore targets
  const newNodes = new Array<Node>(newLen);
  let nextSibling: Node | null = beforeNode ?? null;

  for (let i = newLen - 1; i >= 0; i--) {
    let node: Node;
    let isNew = false;

    if (oldIndices[i] === -1) {
      node = createFn(newItems[i]!);
      isNew = true;
    } else {
      node = oldNodes[oldIndices[i]!]!;
      updateFn(node, newItems[i]!);

      if (lisFlags[i]) {
        newNodes[i] = node;
        nextSibling = node;
        continue;
      }
    }

    if (nextSibling) {
      parent.insertBefore(node, nextSibling);
    } else {
      parent.appendChild(node);
    }

    if (isNew) hooks?.onInsert?.(node);

    newNodes[i] = node;
    nextSibling = node;
  }

  return { nodes: newNodes, items: newItems };
}

/**
 * Reconcile a DOM parent's children to match a new array of items.
 * Uses keyed reconciliation with LIS for minimum DOM operations.
 *
 * For small lists (< 32 items), uses a flat array scan path that avoids
 * Map/Set hash overhead and provides better cache locality.
 *
 * @param parent     - The container DOM element
 * @param oldItems   - Previous array (from last reconciliation)
 * @param newItems   - New array to render
 * @param oldNodes   - Previous DOM nodes array
 * @param keyFn      - Extracts a unique key from each item
 * @param createFn   - Creates a new DOM node for an item
 * @param updateFn   - Updates an existing DOM node with new item data
 * @param beforeNode - Optional boundary marker. When provided, new nodes are
 *                     inserted before this node instead of appended to parent.
 *                     This allows the reconciler to operate within a range
 *                     delimited by comment markers.
 * @returns Object with new nodes array and items array for next call
 */
export function reconcileList<T>(
  parent: Node,
  oldItems: T[],
  newItems: T[],
  oldNodes: Node[],
  keyFn: (item: T) => string | number,
  createFn: (item: T) => Node,
  updateFn: (node: Node, item: T) => void,
  beforeNode?: Node | null,
  hooks?: ListTransitionHooks,
): ReconcileResult<T> {
  const oldLen = oldItems.length;
  const newLen = newItems.length;

  // --- Trivial: new is empty -> remove all ---
  if (newLen === 0) {
    for (let i = 0; i < oldLen; i++) {
      if (hooks?.onBeforeRemove) {
        const node = oldNodes[i]!;
        hooks.onBeforeRemove(node, () => {
          if (node.parentNode) node.parentNode.removeChild(node);
        });
      } else {
        parent.removeChild(oldNodes[i]!);
      }
    }
    return { nodes: [], items: [] };
  }

  // --- Trivial: old is empty -> create all ---
  if (oldLen === 0) {
    const nodes = new Array<Node>(newLen);
    for (let i = 0; i < newLen; i++) {
      const node = createFn(newItems[i]!);
      if (beforeNode) {
        parent.insertBefore(node, beforeNode);
      } else {
        parent.appendChild(node);
      }
      hooks?.onInsert?.(node);
      nodes[i] = node;
    }
    return { nodes, items: newItems };
  }

  // --- Small list path: flat array scan, no Map/Set overhead ---
  if (oldLen < SMALL_LIST_THRESHOLD) {
    return reconcileSmall(parent, oldItems, newItems, oldNodes, keyFn, createFn, updateFn, beforeNode, hooks);
  }

  // --- Large list path: Map-based approach ---
  const oldKeyMap = new Map<string | number, number>();
  for (let i = 0; i < oldLen; i++) {
    oldKeyMap.set(keyFn(oldItems[i]!), i);
  }

  // --- Classify each new item: reuse or create ---
  // Use Uint8Array bitmap instead of Set for O(1) lookup without hash overhead
  const oldIndices = new Array<number>(newLen); // -1 means new item
  const oldUsed = new Uint8Array(oldLen);

  for (let i = 0; i < newLen; i++) {
    const key = keyFn(newItems[i]!);
    const oldIdx = oldKeyMap.get(key);
    if (oldIdx !== undefined) {
      oldIndices[i] = oldIdx;
      oldUsed[oldIdx] = 1;
    } else {
      oldIndices[i] = -1;
    }
  }

  // --- Remove old items not in new array ---
  for (let i = 0; i < oldLen; i++) {
    if (!oldUsed[i]) {
      if (hooks?.onBeforeRemove) {
        const node = oldNodes[i]!;
        hooks.onBeforeRemove(node, () => {
          if (node.parentNode) node.parentNode.removeChild(node);
        });
      } else {
        parent.removeChild(oldNodes[i]!);
      }
    }
  }

  // --- Fast path: same keys, same order -> just update, 0 DOM moves ---
  if (oldLen === newLen) {
    let allSameOrder = true;
    for (let i = 0; i < newLen; i++) {
      if (oldIndices[i] !== i) {
        allSameOrder = false;
        break;
      }
    }
    if (allSameOrder) {
      const nodes = new Array<Node>(newLen);
      for (let i = 0; i < newLen; i++) {
        const node = oldNodes[i]!;
        updateFn(node, newItems[i]!);
        nodes[i] = node;
      }
      return { nodes, items: newItems };
    }
  }

  // --- Find LIS of old indices (reused items only) ---
  const reusedIndices: number[] = [];
  const reusedPositions: number[] = []; // position in new array
  for (let i = 0; i < newLen; i++) {
    if (oldIndices[i] !== -1) {
      reusedIndices.push(oldIndices[i]!);
      reusedPositions.push(i);
    }
  }

  const lisOfReused = longestIncreasingSubsequence(reusedIndices);
  // Use Uint8Array bitmap instead of Set for O(1) lookup without hash overhead
  const lisFlags = new Uint8Array(newLen);
  for (const li of lisOfReused) {
    lisFlags[reusedPositions[li]!] = 1;
  }

  // --- Build result: walk right-to-left for stable insertBefore targets ---
  const newNodes = new Array<Node>(newLen);
  let nextSibling: Node | null = beforeNode ?? null;

  for (let i = newLen - 1; i >= 0; i--) {
    let node: Node;
    let isNew = false;

    if (oldIndices[i] === -1) {
      // NEW: create and insert
      node = createFn(newItems[i]!);
      isNew = true;
    } else {
      // REUSE: update content
      node = oldNodes[oldIndices[i]!]!;
      updateFn(node, newItems[i]!);

      if (lisFlags[i]) {
        // LIS item: already in correct relative position, don't move
        newNodes[i] = node;
        nextSibling = node;
        continue;
      }
    }

    // Insert/move into position
    if (nextSibling) {
      parent.insertBefore(node, nextSibling);
    } else {
      parent.appendChild(node);
    }

    if (isNew) hooks?.onInsert?.(node);

    newNodes[i] = node;
    nextSibling = node;
  }

  return { nodes: newNodes, items: newItems };
}

// ---------------------------------------------------------------------------
// createList — high-level reactive API
// ---------------------------------------------------------------------------

/**
 * Create a reactively-bound list of DOM elements with keyed reconciliation.
 *
 * Returns a `DocumentFragment` containing two comment markers
 * (`<!--forma-list-start-->` and `<!--forma-list-end-->`) that delimit the
 * list's range in the DOM. All managed elements live between these markers.
 *
 * This avoids a wrapper `<div>` which would break `<table>`, `<ul>`,
 * `<select>` semantics and pollute the DOM.
 *
 * When the `items` signal changes, only the minimal set of DOM mutations is
 * performed using the LIS algorithm:
 * - New keys: create elements via `renderFn`
 * - Removed keys: remove elements from DOM
 * - Moved keys: reorder elements using minimum moves (n - LIS)
 * - Same keys: keep row nodes and update index signals
 *   (or re-render row content when `updateOnItemChange: 'rerender'`)
 *
 * @param items    Signal getter returning the current array of items.
 * @param keyFn    Extracts a unique key from each item.
 * @param renderFn Renders a single item. Receives the item and a reactive index getter.
 * @returns A DocumentFragment to insert into the DOM. The fragment includes
 *          start/end comment markers and any initial list items.
 *
 * ```ts
 * const frag = createList(
 *   todos,
 *   (t) => t.id,
 *   (todo, index) => h('li', null, () => `${index() + 1}. ${todo.text}`),
 * );
 * container.appendChild(frag);
 * ```
 */
export function createList<T>(
  items: () => T[],
  keyFn: (item: T) => string | number,
  renderFn: (item: T, index: () => number) => HTMLElement,
  options?: CreateListOptions,
): DocumentFragment {
  if (hydrating) {
    return { type: 'list', items, keyFn, renderFn, options } as unknown as DocumentFragment;
  }

  const startMarker = document.createComment('forma-list-start');
  const endMarker = document.createComment('forma-list-end');

  const fragment = document.createDocumentFragment();
  fragment.appendChild(startMarker);
  fragment.appendChild(endMarker);

  // Cache: key -> { element, item, setIndex }
  let cache = new Map<string | number, CachedItem<T>>();
  let currentNodes: Node[] = [];
  let currentItems: T[] = [];
  const updateOnItemChange = options?.updateOnItemChange ?? 'none';

  internalEffect(() => {
    const newItems = items();

    // The parent is discovered lazily: once the fragment has been inserted
    // into the live DOM the markers have a parentNode.
    const parent = startMarker.parentNode;
    if (!parent) {
      // Markers are not yet in the DOM — nothing to reconcile.
      // This can happen if the effect fires synchronously before mount.
      return;
    }

    // Edge case: non-array
    if (!Array.isArray(newItems)) {
      if (__DEV__) {
        console.warn('[forma] createList: value is not an array, treating as empty');
      }
      // Remove all nodes between the markers
      for (const node of currentNodes) {
        if (node.parentNode === parent) parent.removeChild(node);
      }
      cache = new Map();
      currentNodes = [];
      currentItems = [];
      return;
    }

    // Filter nullish items — avoid array allocation when no nulls found (common case)
    let cleanItems: T[] = newItems;
    for (let i = 0; i < newItems.length; i++) {
      if (newItems[i] == null) {
        cleanItems = newItems.filter(item => item != null);
        break;
      }
    }

    // Dev-mode duplicate key detection
    if (__DEV__) {
      const seen = new Set<string | number>();
      for (const item of cleanItems) {
        const key = keyFn(item);
        if (seen.has(key)) {
          console.warn('[forma] createList: duplicate key detected:', key);
        }
        seen.add(key);
      }
    }

    const updateRow = updateOnItemChange === 'rerender'
      ? (node: Node, item: T): void => {
        const key = keyFn(item);
        const cached = cache.get(key);
        if (!cached) return;
        if (cached.item === item) return;
        cached.item = item;

        if (!(node instanceof HTMLElement)) return;
        if ((node as any)[ABORT_SYM] || (node as any)[CACHE_SYM] || (node as any)[DYNAMIC_CHILD_SYM]) {
          return;
        }

        const next = untrack(() => renderFn(item, cached.getIndex));
        if (canPatchStaticElement(node, next)) {
          patchStaticElement(node, next);
          cached.element = node;
        }
      }
      : (_node: Node, item: T): void => {
        const key = keyFn(item);
        const cached = cache.get(key);
        if (cached) cached.item = item;
      };

    const result = reconcileList<T>(
      parent,
      currentItems,
      cleanItems,
      currentNodes,
      keyFn,
      // createFn: create element + cache entry
      (item) => {
        const key = keyFn(item);
        const [getIndex, setIndex] = createSignal(0);
        // Prevent child effects created during render from being nested under
        // the reconciler effect, which can stall their updates on reorders.
        const element = untrack(() => renderFn(item, getIndex));
        cache.set(key, { element, item, getIndex, setIndex });
        return element;
      },
      updateRow,
      // beforeNode: insert items before the end marker
      endMarker,
    );

    // Rebuild cache + update index signals in a single pass.
    // Avoids .map() array allocation + Set construction from the previous approach.
    const newCache = new Map<string | number, CachedItem<T>>();
    for (let i = 0; i < cleanItems.length; i++) {
      const key = keyFn(cleanItems[i]!);
      const cached = cache.get(key);
      if (cached) {
        cached.setIndex(i);
        newCache.set(key, cached);
      }
    }
    cache = newCache;

    currentNodes = result.nodes;
    currentItems = result.items;
  });

  return fragment;
}
