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

// ---------------------------------------------------------------------------
// Scheduled-or-active island count
// ---------------------------------------------------------------------------

/**
 * How many islands currently hold state that {@link deactivateIsland} would
 * have to tear down: a deferred trigger's IntersectionObserver, idle timer or
 * interaction listeners, or a hydrated island's reactive root.
 *
 * This exists so `deactivateIslandsIn` (src/dom/list.ts) can decide with an
 * integer compare whether a departing list row can possibly contain an island,
 * instead of running `querySelectorAll('[data-forma-island]')` over every
 * removed row on every page. An island cannot acquire any of that state without
 * going through {@link activateIslands} — which is the only caller of
 * `hydrateIslandRoot` — so zero here means no element anywhere has anything to
 * deactivate, and the scan is provably wasted work.
 *
 * The per-element `__formaTracked` marker is what keeps the count honest: both
 * transitions are idempotent per element, so re-activating an island cannot
 * inflate the count (which would silently restore the scan cost) and the
 * deliberately-idempotent `deactivateIsland` cannot drive it below the number
 * of islands still live (which would silently restore the leak).
 *
 * Verified by: src/dom/__tests__/list-disposal.test.ts > "does not scan a removed row when no island has ever been activated"
 * Verified by: src/dom/__tests__/list-disposal.test.ts > "still deactivates a live island after a different island was deactivated"
 * Verified by: src/dom/__tests__/list-disposal.test.ts > "still deactivates a live island after the same island was deactivated twice"
 */
let scheduledOrActiveIslands = 0;

function trackIsland(el: Element): void {
  if ((el as any).__formaTracked) return;
  (el as any).__formaTracked = true;
  scheduledOrActiveIslands++;
}

function untrackIsland(el: Element): void {
  if (!(el as any).__formaTracked) return;
  delete (el as any).__formaTracked;
  scheduledOrActiveIslands--;
}

/**
 * @internal — true when at least one island is scheduled or active anywhere.
 *
 * Verified by: src/dom/__tests__/list-disposal.test.ts > "stops scanning once every island has been deactivated with deactivateAllIslands"
 */
export function hasScheduledOrActiveIslands(): boolean {
  return scheduledOrActiveIslands > 0;
}

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
 * Verified by: src/dom/__tests__/activate.test.ts > "error in island 0 does not prevent island 1 from activating"
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
    // Verified by: src/dom/__tests__/activate-reactivate.test.ts > "does not re-run a load island when activateIslands is called twice"
    // Verified by: src/dom/__tests__/activate-reactivate.test.ts > "does not attach duplicate handlers on re-activation"
    // Verified by: src/dom/__tests__/activate-reactivate.test.ts > "does not double-register a visible-trigger observer on re-invocation"
    // Verified by: src/dom/__tests__/activate-reactivate.test.ts > "re-activates a freshly re-rendered island (status reset to pending)"
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

    // From here every branch either schedules deferred work or hydrates, so the
    // island now has something to tear down and must be counted. Every exit —
    // deactivateIsland, deactivateAllIslands, disposal of a row containing it,
    // and the failed-hydration path below — untracks it again.
    trackIsland(island);

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
 *
 * Verified by: src/dom/__tests__/deactivate.test.ts > "is idempotent — double disposal does not throw"
 * Verified by: src/dom/__tests__/deactivate.test.ts > "stops effects from running after disposal"
 */
export function deactivateIsland(el: HTMLElement): void {
  // Tear down any pending deferred-trigger work so it does not leak when the
  // island is torn down before it ever ran: the visible-trigger observer, and
  // the interaction-trigger pointerdown/focusin listeners (whose only other
  // removal path is inside a hydrate that may never fire).
  // Verified by: src/dom/__tests__/activate-visible-leak.test.ts > "disconnects the observer when the island is deactivated before intersecting"
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
  // Nothing above is left to tear down, so this island no longer forces list
  // rows to be scanned. Marker-guarded, so the documented idempotence of this
  // function cannot double-decrement and hide an island that is still live.
  untrackIsland(el);
  // Mark disposed so any deferred callback that still fires (e.g. a timer that
  // could not be cancelled) cannot resurrect a torn-down island.
  // Verified by: src/dom/__tests__/activate-visible-leak.test.ts > "a deferred callback that fires after disposal cannot resurrect the island"
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
        // actually in the document, so deactivateIsland finds it there. The
        // tracking marker moves with the handle: it has to sit on the element
        // deactivateIsland will be called with, or tearing the island down
        // would never decrement the count.
        delete (root as any).__formaDispose;
        (activeRoot as any).__formaDispose = dispose;
        untrackIsland(root);
        trackIsland(activeRoot);
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
    // A failed island has no live root and no scheduled trigger left, so it must
    // stop forcing the row scan — otherwise one broken island on a page makes
    // every list pay the subtree walk forever.
    untrackIsland(root);
    root.setAttribute('data-forma-status', 'error');
  }
}
