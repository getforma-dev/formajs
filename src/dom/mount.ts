/**
 * Forma DOM - Mount
 *
 * Mounts a component function into a DOM container, returning an unmount handle.
 * Uses createRoot() for automatic effect disposal — no global state.
 *
 * When the container has `data-forma-ssr`, uses hydrateIsland() for zero-flash
 * descriptor-based hydration instead of tearing down and rebuilding the DOM.
 */

import { createUnownedRoot } from 'forma/reactive';
import { hydrateIslandOrFail, isHydrateError, reportHydrateError } from './hydrate.js';
import { contentNs, withNamespace } from './namespace.js';

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

  // The element unmount has to clean up. Usually `target`, but hydrateIsland's
  // CSR fallback REPLACES an empty SSR shell with the component's own root
  // element, and clearing the detached original would leave that replacement —
  // and its whole subtree — in the document after unmount.
  //
  // Verified by: src/dom/__tests__/mount.test.ts > "unmount removes the replacement element after the CSR fallback"
  let active: Element = target;

  if (target.hasAttribute('data-forma-ssr')) {
    // SSR content present — hydrate in-place using descriptor-based adoption.
    // The component MUST run inside createRoot so effects are tracked.
    let failure: Error | undefined;
    createUnownedRoot((dispose) => {
      disposeRoot = dispose;
      try {
        active = hydrateIslandOrFail(component, target);
      } catch (err) {
        if (!isHydrateError(err)) throw err;
        failure = err;
      }
    });
    // A detached DOM node from the component, or a list whose unkeyed rows
    // differ in count from its array, cannot be adopted. In 2.x that is
    // reported, not thrown, so the statements after mount() still run: the
    // server's DOM stays as served, with its data-forma-ssr, and the effects the
    // component created are disposed.
    // Verified by: src/dom/__tests__/hydrate-fragment.test.ts > "mount() of a detached DOM node keeps the server DOM, logs the code, disposes its effects and does not throw"
    // Verified by: src/dom/__tests__/list-adoption-count.test.ts > "onError receives FORMA_E_HYDRATE_LIST_COUNT from activateIslands, mount() and hydrateIsland(), and each keeps the server rows"
    if (failure) {
      disposeRoot();
      reportHydrateError(failure);
    }
  } else {
    // Normal mount — clear and append. The component is built in the
    // container's content namespace: SVG into an svg element.
    // Verified by: src/dom/__tests__/namespace-resolution.test.ts > "a portal into an svg, and mount() into an svg, create SVG elements"
    const dom = createUnownedRoot((dispose) => {
      disposeRoot = dispose;
      return withNamespace(contentNs(target), component);
    });
    // replaceChildren(), not `innerHTML = ''`: a string written to an HTML
    // sink is what a page requiring Trusted Types reports or refuses, and
    // core writes none (DR-20).
    // Verified by: src/dom/__tests__/trusted-html.test.ts > "core's own writes raise no Trusted Types violation: mount, unmount, the null clear, and every sink given trustedHtml()"
    target.replaceChildren();
    target.appendChild(dom);
  }

  // Return unmount function
  let unmounted = false;
  return () => {
    if (unmounted) return;
    unmounted = true;
    disposeRoot();
    if (active === target) {
      target.replaceChildren();
    } else {
      // The container was replaced by the component's root: removing that
      // element is what "unmount" means here — there is no container left.
      active.remove();
    }
  };
}
