/**
 * Forma DOM - Island Activation
 *
 * Discovers SSR-rendered islands via [data-forma-island] attributes,
 * loads props (inline or script_tag), and hydrates each island inside
 * an independent createRoot scope with try/catch error isolation.
 */

import { createUnownedRoot, __DEV__ } from 'forma/reactive';
import { hydrateIsland } from './hydrate.js';

/**
 * Function that hydrates an island.
 *
 * @param el     The root element of the island (`[data-forma-island]`).
 *               Useful for layout measurement, focus management, CSS class
 *               toggling, third-party library init, or reading extra `data-*`
 *               attributes from the server-rendered shell.
 * @param props  Parsed props from `data-forma-props` (inline or script block),
 *               or `null` if no props were provided.
 * @returns      A component tree (from `h()` calls) for descriptor-based
 *               hydration, or `undefined` for imperative islands that set up
 *               their own effects.
 */
export type IslandHydrateFn = (el: HTMLElement, props: Record<string, unknown> | null) => unknown;

const FORBIDDEN_PROP_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitizeProps(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of FORBIDDEN_PROP_KEYS) {
    if (key in obj) delete (obj as any)[key];
  }
  return obj;
}

/**
 * Strip `__proto__` / `constructor` / `prototype` keys from an island props
 * object **at every depth**, in place.
 *
 * Island activation deliberately only sanitizes the TOP level (see
 * `sanitizeProps`): a deep walk of every payload on every hydration is a cost no
 * island should pay by default, and it would silently mutate large server
 * payloads. Call this yourself before handing props to something that merges
 * them into another object — `createStore`, a deep-merge helper, an
 * `Object.assign` chain — where a nested pollution key would matter.
 *
 * Iterative with an explicit stack and a WeakSet, so neither deeply nested nor
 * cyclic props can overflow the stack or loop forever.
 *
 * ```ts
 * activateIslands({
 *   Cart: (el, props) => renderCart(el, sanitizePropsDeep(props)),
 * });
 * ```
 *
 * Verified by: src/dom/__tests__/activate-isolation.test.ts > "sanitizePropsDeep strips forbidden keys at every depth"
 * Verified by: src/dom/__tests__/activate-isolation.test.ts > "sanitizePropsDeep terminates on cyclic props"
 */
export function sanitizePropsDeep<T>(props: T): T {
  const stack: unknown[] = [props];
  const seen = new WeakSet<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const key of FORBIDDEN_PROP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        const desc = Object.getOwnPropertyDescriptor(current, key);
        // A non-configurable key cannot be deleted; skipping it beats throwing.
        if (desc?.configurable) delete (current as Record<string, unknown>)[key];
      }
    }

    for (const k of Object.keys(current as Record<string, unknown>)) {
      stack.push((current as Record<string, unknown>)[k]);
    }
  }

  return props;
}

/**
 * Load props for an island from either inline attribute or shared script block.
 */
function loadIslandProps(
  root: HTMLElement,
  id: number,
  sharedProps: Record<string, unknown> | null,
): Record<string, unknown> | null {
  // Mode 1: Inline (small props, < 1KB)
  const inline = root.getAttribute('data-forma-props');
  if (inline) {
    return sanitizeProps(JSON.parse(inline));
  }

  // Mode 2: Script tag (1KB–50KB, pre-parsed)
  if (sharedProps && String(id) in sharedProps) {
    return sanitizeProps((sharedProps as any)[String(id)] as Record<string, unknown>);
  }

  // No props — island creates its own state
  return null;
}

/**
 * Read the shared `__forma_islands` props block.
 *
 * Two rules, both learned from the failure modes of the previous bare
 * `document.getElementById(...)` + `JSON.parse(...)`:
 *
 * - Only a `<script id="__forma_islands">` is accepted. `getElementById` alone
 *   matched ANY element with that id, so a user-controlled node appearing
 *   earlier in the document (a comment body, a profile field) could supply the
 *   props of every island on the page.
 * - A parse failure degrades to `null` (no shared props) instead of throwing.
 *   The throw happened before the island loop, so one malformed, truncated or
 *   empty block — `JSON.parse('')` throws — stopped EVERY island on the page
 *   from hydrating, including islands with inline props or no props at all.
 *
 * Verified by: src/dom/__tests__/activate-isolation.test.ts > "a malformed __forma_islands block does not stop islands from hydrating"
 * Verified by: src/dom/__tests__/activate-isolation.test.ts > "ignores a non-script element carrying id __forma_islands"
 */
function loadSharedProps(root: ParentNode): Record<string, unknown> | null {
  const scriptBlock =
    root.querySelector('script#__forma_islands') ??
    (root === (document as ParentNode) ? null : document.querySelector('script#__forma_islands'));
  if (!scriptBlock) return null;

  try {
    const parsed = JSON.parse(scriptBlock.textContent ?? '');
    return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch (err) {
    if (__DEV__) console.error('[forma] Malformed __forma_islands props block — islands will hydrate without shared props:', err);
    return null;
  }
}

/**
 * Discover and activate all SSR-rendered islands on the page.
 *
 * Each island is activated inside its own createRoot scope with try/catch
 * isolation — a broken island never takes down its siblings.
 *
 * @param registry  Map of component names to hydration functions.
 * @param root      Where to search for islands and the shared props block.
 *                  Defaults to `document`; pass a ShadowRoot (or any subtree
 *                  element) to activate islands that `document.querySelectorAll`
 *                  cannot reach — the mirror image of `deactivateAllIslands`,
 *                  which has always taken a root. The props block is looked up
 *                  inside `root` first and falls back to the document, so a
 *                  shadow subtree can share the page-level block.
 *
 * Verified by: src/dom/__tests__/activate-isolation.test.ts > "activates islands inside a shadow root when one is passed as root"
 */
export function activateIslands(
  registry: Record<string, IslandHydrateFn>,
  root: ParentNode = document,
): void {
  // Parse shared props once before the loop
  const sharedProps = loadSharedProps(root);

  const islands = root.querySelectorAll<HTMLElement>('[data-forma-island]');

  for (const island of islands) {
    // Skip islands already processed or with a deferred trigger already
    // scheduled, so a second activateIslands() (HMR / SPA re-mount) does not
    // double-hydrate, double-bind handlers, or double-register observers. A
    // freshly re-rendered island (status reset to 'pending', no scheduled
    // marker) re-activates.
    const status = island.getAttribute('data-forma-status');
    if (status === 'active' || status === 'hydrating' || status === 'disposed' || status === 'error') continue;
    if ((island as any).__formaScheduled) continue;

    // We are (re)activating this island — clear any prior disposed marker so a
    // freshly re-rendered island can hydrate again.
    delete (island as any).__formaDisposed;

    const id = parseInt(island.getAttribute('data-forma-island')!, 10);
    const componentName = island.getAttribute('data-forma-component')!;
    const hydrateFn = registry[componentName];

    if (!hydrateFn) {
      if (__DEV__) console.warn(`[forma] No hydrate function for island "${componentName}" (id=${id})`);
      island.setAttribute('data-forma-status', 'error');
      continue;
    }

    const trigger = island.getAttribute('data-forma-hydrate') || 'load';

    if (trigger === 'visible') {
      // Defer hydration until island enters the viewport
      (island as any).__formaScheduled = true;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.disconnect();
            delete (island as any).__formaObserver;
            hydrateIslandRoot(island, id, componentName, hydrateFn, sharedProps);
          }
        },
        { rootMargin: '200px' },
      );
      // Track the observer so deactivateIsland can disconnect it if the island
      // is torn down before it ever intersects (otherwise it leaks).
      (island as any).__formaObserver = observer;
      observer.observe(island);
    } else if (trigger === 'idle') {
      (island as any).__formaScheduled = true;
      const hydrate = () => hydrateIslandRoot(island, id, componentName, hydrateFn, sharedProps);
      // Track the timer so deactivateIsland can cancel it before it fires.
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(hydrate);
        (island as any).__formaIdleCancel = () => cancelIdleCallback(handle);
      } else {
        const handle = setTimeout(hydrate, 200);
        (island as any).__formaIdleCancel = () => clearTimeout(handle);
      }
    } else if (trigger === 'interaction') {
      (island as any).__formaScheduled = true;
      const hydrate = () => {
        island.removeEventListener('pointerdown', hydrate, true);
        island.removeEventListener('focusin', hydrate, true);
        delete (island as any).__formaInteractionHandler;
        hydrateIslandRoot(island, id, componentName, hydrateFn, sharedProps);
      };
      // Track the handler so deactivateIsland can remove it if the island is
      // torn down before the user ever interacts (otherwise it leaks and a
      // stray event would re-hydrate a disposed island).
      (island as any).__formaInteractionHandler = hydrate;
      island.addEventListener('pointerdown', hydrate, { capture: true, once: true });
      island.addEventListener('focusin', hydrate, { capture: true, once: true });
    } else {
      // load (default) — hydrate immediately
      hydrateIslandRoot(island, id, componentName, hydrateFn, sharedProps);
    }
  }
}

/**
 * Dispose a single island, tearing down its reactive root and all effects.
 *
 * Safe to call multiple times (idempotent). Sets `data-forma-status` to
 * `"disposed"` so the island can be distinguished from active/error states.
 */
export function deactivateIsland(el: HTMLElement): void {
  // Tear down any pending deferred-trigger work so it does not leak when the
  // island is torn down before it ever ran: the visible-trigger observer, and
  // the interaction-trigger pointerdown/focusin listeners (whose only other
  // removal path is inside a hydrate that may never fire).
  const observer = (el as any).__formaObserver as { disconnect: () => void } | undefined;
  if (observer) {
    observer.disconnect();
    delete (el as any).__formaObserver;
  }
  const interactionHandler = (el as any).__formaInteractionHandler as EventListener | undefined;
  if (interactionHandler) {
    el.removeEventListener('pointerdown', interactionHandler, true);
    el.removeEventListener('focusin', interactionHandler, true);
    delete (el as any).__formaInteractionHandler;
  }
  const idleCancel = (el as any).__formaIdleCancel as (() => void) | undefined;
  if (idleCancel) {
    idleCancel();
    delete (el as any).__formaIdleCancel;
  }
  delete (el as any).__formaScheduled;
  // Mark disposed so any deferred callback that still fires (e.g. a timer that
  // could not be cancelled) cannot resurrect a torn-down island.
  (el as any).__formaDisposed = true;

  const dispose = (el as any).__formaDispose;
  if (typeof dispose === 'function') {
    dispose();
    delete (el as any).__formaDispose;
    el.setAttribute('data-forma-status', 'disposed');
  }
}

/**
 * Dispose ALL active islands under a root element (or the whole document).
 *
 * Use this when swapping module content — e.g., replacing the contents of
 * a `<forma-stage>` Shadow DOM during AI generation. Prevents leaked effects
 * and event listeners from accumulating across swaps.
 *
 * `root` is a `ParentNode` so a ShadowRoot is accepted — the documented
 * forma-stage case did not typecheck under the previous `Element | Document`,
 * and it takes the same argument as `activateIslands`.
 */
export function deactivateAllIslands(root: ParentNode = document): void {
  // Tear down ALL islands — active ones AND pending deferred ones (visible/idle/
  // interaction), whose observers/listeners would otherwise survive a content
  // swap and later zombie-hydrate. deactivateIsland is idempotent and a no-op
  // for islands with no scheduled/active work.
  const islands = root.querySelectorAll<HTMLElement>('[data-forma-island]');
  for (const island of islands) {
    deactivateIsland(island);
  }
}

/** Hydrate a single island root with error isolation. */
function hydrateIslandRoot(
  root: HTMLElement,
  id: number,
  componentName: string,
  hydrateFn: IslandHydrateFn,
  sharedProps: Record<string, unknown> | null,
): void {
  // A deferred callback (timer/event) may fire after the island was deactivated;
  // do not resurrect it.
  if ((root as any).__formaDisposed) return;
  let disposeRoot: (() => void) | undefined;
  try {
    // Clear the deferred-trigger marker now that hydration is happening; the
    // 'hydrating'/'active' status guards prevent re-runs from here on.
    delete (root as any).__formaScheduled;
    const props = loadIslandProps(root, id, sharedProps);
    root.setAttribute('data-forma-status', 'hydrating');

    // hydrateIsland may replace the shell element with the component's own
    // root element (CSR fallback for empty islands). Track the active root.
    let activeRoot: Element = root;
    createUnownedRoot((dispose) => {
      // Publish the disposer BEFORE running the component. Effects are created
      // as the component runs, so if it throws half-way the ones already created
      // are live — and if the disposer were only assigned after hydrateIsland
      // returned, nothing would ever reach them: the island would keep reacting
      // to signal writes forever and deactivateIsland would find nothing to
      // dispose. The catch below uses this handle to tear the partial root down.
      disposeRoot = dispose;
      (root as any).__formaDispose = dispose;
      activeRoot = hydrateIsland(() => hydrateFn(root, props), root);
      if (activeRoot !== root) {
        // The shell was replaced — move the handle onto the element that is
        // actually in the document, so deactivateIsland finds it there.
        delete (root as any).__formaDispose;
        (activeRoot as any).__formaDispose = dispose;
      }
    });

    activeRoot.setAttribute('data-forma-status', 'active');
  } catch (err) {
    if (__DEV__) console.error(`[forma] Island "${componentName}" (id=${id}) failed:`, err);
    // Dispose whatever was built before the throw: a failed island must not
    // leave live effects writing into DOM nobody will hydrate again.
    // Verified by: src/dom/__tests__/activate-isolation.test.ts > "disposes effects created before a failing island threw"
    if (disposeRoot) {
      try { disposeRoot(); } catch { /* a broken disposer must not mask the original error */ }
      delete (root as any).__formaDispose;
    }
    root.setAttribute('data-forma-status', 'error');
  }
}
