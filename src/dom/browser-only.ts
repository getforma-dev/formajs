/**
 * Forma DOM - browserOnly(): the browser-only marker (DR-1, L-1)
 *
 * Wraps a component that renders in the browser alone. `@getforma/compiler`
 * (0.3.7 and later) recognises `const X = browserOnly(Impl)` by name and emits
 * X as a registered island whose server output is its empty host element with
 * its declared props; the browser activates it like any island and renders the
 * component there. One name, so a search finds every use.
 */

/**
 * A browser-only component. Called with props, it renders `Impl`, as in a
 * client-rendered tree; registered in `activateIslands`, it is called with the
 * island's element and props and renders `Impl` from those props.
 */
export interface BrowserOnlyComponent<P> {
  (props: P): unknown;
  (el: HTMLElement, props: Record<string, unknown> | null): unknown;
}

/**
 * Mark a component as rendering in the browser alone.
 *
 * ```ts
 * import { activateIslands, browserOnly } from '@getforma/core';
 *
 * // chart.tsx: declared once, at the top level of a module.
 * export const Chart = browserOnly((props: { title: string }) => <canvas aria-label={props.title} />);
 *
 * // The page renders <Chart title="Sales" /> where the chart goes; the server
 * // sends <div data-forma-component="Chart" data-forma-props='{"title":"Sales"}'></div>.
 * // The entry registers it under the name it is rendered with:
 * activateIslands({ Chart });
 * ```
 *
 * `activateIslands` finds the host empty and renders the component in its
 * place, with the props the server wrote (or `{}`). Called as a component, in
 * a client-rendered page, it renders `component(props)`. Where there is no
 * document (Node rendering), it renders nothing: the subtree is the browser's.
 *
 * Verified by: src/dom/__tests__/browser-only.test.ts
 */
export function browserOnly<P extends object>(
  component: (props: P) => unknown,
): BrowserOnlyComponent<P> {
  function rendered(this: unknown, first?: unknown, second?: unknown): unknown {
    if (typeof document === 'undefined') return null;
    // activateIslands calls a registry entry with (element, props).
    if (arguments.length >= 2 && typeof Element !== 'undefined' && first instanceof Element) {
      return component((second ?? {}) as P);
    }
    return component(first as P);
  }
  return rendered as BrowserOnlyComponent<P>;
}
