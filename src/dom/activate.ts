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
 * Discover and activate all SSR-rendered islands on the page.
 *
 * Each island is activated inside its own createRoot scope with try/catch
 * isolation — a broken island never takes down its siblings.
 *
 * @param registry  Map of component names to hydration functions.
 */
export function activateIslands(registry: Record<string, IslandHydrateFn>): void {
  // Parse shared props once before the loop
  const scriptBlock = document.getElementById('__forma_islands');
  const sharedProps: Record<string, unknown> | null =
    scriptBlock ? JSON.parse(scriptBlock.textContent!) : null;

  const islands = document.querySelectorAll<HTMLElement>('[data-forma-island]');

  for (const root of islands) {
    // Skip islands already processed or with a deferred trigger already
    // scheduled, so a second activateIslands() (HMR / SPA re-mount) does not
    // double-hydrate, double-bind handlers, or double-register observers. A
    // freshly re-rendered island (status reset to 'pending', no scheduled
    // marker) re-activates.
    const status = root.getAttribute('data-forma-status');
    if (status === 'active' || status === 'hydrating' || status === 'disposed' || status === 'error') continue;
    if ((root as any).__formaScheduled) continue;

    const id = parseInt(root.getAttribute('data-forma-island')!, 10);
    const componentName = root.getAttribute('data-forma-component')!;
    const hydrateFn = registry[componentName];

    if (!hydrateFn) {
      if (__DEV__) console.warn(`[forma] No hydrate function for island "${componentName}" (id=${id})`);
      root.setAttribute('data-forma-status', 'error');
      continue;
    }

    const trigger = root.getAttribute('data-forma-hydrate') || 'load';

    if (trigger === 'visible') {
      // Defer hydration until island enters the viewport
      (root as any).__formaScheduled = true;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.disconnect();
            delete (root as any).__formaObserver;
            hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
          }
        },
        { rootMargin: '200px' },
      );
      // Track the observer so deactivateIsland can disconnect it if the island
      // is torn down before it ever intersects (otherwise it leaks).
      (root as any).__formaObserver = observer;
      observer.observe(root);
    } else if (trigger === 'idle') {
      (root as any).__formaScheduled = true;
      const hydrate = () => hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(hydrate);
      } else {
        setTimeout(hydrate, 200);
      }
    } else if (trigger === 'interaction') {
      (root as any).__formaScheduled = true;
      const hydrate = () => {
        root.removeEventListener('pointerdown', hydrate, true);
        root.removeEventListener('focusin', hydrate, true);
        hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
      };
      root.addEventListener('pointerdown', hydrate, { capture: true, once: true });
      root.addEventListener('focusin', hydrate, { capture: true, once: true });
    } else {
      // load (default) — hydrate immediately
      hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
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
  // Disconnect a still-pending visible-trigger observer so it does not leak when
  // the island is torn down before it ever intersected. Do this regardless of
  // hydration state, but do not force a status change for a never-hydrated island.
  const observer = (el as any).__formaObserver as { disconnect: () => void } | undefined;
  if (observer) {
    observer.disconnect();
    delete (el as any).__formaObserver;
  }
  delete (el as any).__formaScheduled;

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
 */
export function deactivateAllIslands(root: Element | Document = document): void {
  const islands = root.querySelectorAll<HTMLElement>('[data-forma-status="active"]');
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
      activeRoot = hydrateIsland(() => hydrateFn(root, props), root);
      (activeRoot as any).__formaDispose = dispose;
    });

    activeRoot.setAttribute('data-forma-status', 'active');
  } catch (err) {
    if (__DEV__) console.error(`[forma] Island "${componentName}" (id=${id}) failed:`, err);
    root.setAttribute('data-forma-status', 'error');
  }
}
