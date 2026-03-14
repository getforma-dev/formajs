/**
 * Forma DOM - Island Activation
 *
 * Discovers SSR-rendered islands via [data-forma-island] attributes,
 * loads props (inline or script_tag), and hydrates each island inside
 * an independent createRoot scope with try/catch error isolation.
 */

import { createRoot, __DEV__ } from 'forma/reactive';
import { hydrateIsland } from './hydrate.js';

/** Function that creates a component's DOM tree (same for CSR and hydration). */
export type IslandHydrateFn = (props: Record<string, unknown> | null) => unknown;

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
    return JSON.parse(inline);
  }

  // Mode 2: Script tag (1KB–50KB, pre-parsed)
  if (sharedProps && String(id) in sharedProps) {
    return (sharedProps as any)[String(id)] as Record<string, unknown>;
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
    const id = parseInt(root.getAttribute('data-forma-island')!, 10);
    const componentName = root.getAttribute('data-forma-component')!;
    const hydrateFn = registry[componentName];

    if (!hydrateFn) {
      if (__DEV__) console.warn(`[forma] No hydrate function for island "${componentName}" (id=${id})`);
      root.setAttribute('data-forma-status', 'error');
      continue;
    }

    const trigger = root.getAttribute('data-forma-hydrate') || 'load';

    // Stub triggers: warn and fall back to load
    if (trigger === 'interaction' || trigger === 'idle') {
      if (__DEV__) console.warn(`[forma] Trigger "${trigger}" not yet implemented for island "${componentName}" (id=${id}), falling back to load`);
    }

    if (trigger === 'visible') {
      // Defer hydration until island enters the viewport
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.disconnect();
            hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
          }
        },
        { rootMargin: '200px' },
      );
      observer.observe(root);
    } else {
      // load (default), interaction (stub), idle (stub) — hydrate immediately
      hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
    }
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
    const props = loadIslandProps(root, id, sharedProps);
    root.setAttribute('data-forma-status', 'hydrating');

    // hydrateIsland may replace the shell element with the component's own
    // root element (CSR fallback for empty islands). Track the active root.
    let activeRoot: Element = root;
    createRoot((dispose) => {
      activeRoot = hydrateIsland(() => hydrateFn(props), root);
      (activeRoot as any).__formaDispose = dispose;
    });

    activeRoot.setAttribute('data-forma-status', 'active');
  } catch (err) {
    if (__DEV__) console.error(`[forma] Island "${componentName}" (id=${id}) failed:`, err);
    root.setAttribute('data-forma-status', 'error');
  }
}
