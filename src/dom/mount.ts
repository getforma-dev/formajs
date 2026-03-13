/**
 * Forma DOM - Mount
 *
 * Mounts a component function into a DOM container, returning an unmount handle.
 * Uses createRoot() for automatic effect disposal — no global state.
 *
 * When the container has `data-forma-ssr`, uses hydrateIsland() for zero-flash
 * descriptor-based hydration instead of tearing down and rebuilding the DOM.
 */

import { createRoot } from 'forma/reactive';
import { hydrateIsland } from './hydrate.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount a component into a DOM container.
 *
 * All effects created during the component's render are tracked via
 * `createRoot()` and automatically disposed when unmount is called.
 *
 * When `data-forma-ssr` is present on the container, the component runs
 * inside `createRoot` in hydration mode — h() returns descriptors that are
 * walked against SSR DOM to attach handlers and reactive bindings.
 *
 * @param component  A function returning an HTMLElement or DocumentFragment.
 * @param container  An HTMLElement or a CSS selector string.
 * @returns An unmount function that removes the DOM and disposes all effects.
 *
 * ```ts
 * const unmount = mount(() => h('h1', null, 'Hello'), '#app');
 * // later…
 * unmount();
 * ```
 */
export function mount(
  component: () => HTMLElement | DocumentFragment,
  container: HTMLElement | string,
): () => void {
  const target =
    typeof container === 'string'
      ? document.querySelector<HTMLElement>(container)
      : container;

  if (!target) {
    throw new Error(`mount: container not found — "${container}"`);
  }

  let disposeRoot!: () => void;

  if (target.hasAttribute('data-forma-ssr')) {
    // SSR content present — hydrate in-place using descriptor-based adoption.
    // The component MUST run inside createRoot so effects are tracked.
    createRoot((dispose) => {
      disposeRoot = dispose;
      hydrateIsland(component, target);
    });
  } else {
    // Normal mount — clear and append
    const dom = createRoot((dispose) => {
      disposeRoot = dispose;
      return component();
    });
    target.innerHTML = '';
    target.appendChild(dom);
  }

  // Return unmount function
  let unmounted = false;
  return () => {
    if (unmounted) return;
    unmounted = true;
    disposeRoot();
    target.innerHTML = '';
  };
}
