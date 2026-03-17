// Event delegation — single listener on parent, matches children by selector

/**
 * Attach a single event listener on a parent that fires for children matching
 * a CSS selector. Efficient for large/dynamic lists — one listener instead of
 * one per child.
 *
 * ```ts
 * const unsub = delegate(ul, 'li', 'click', (e, li) => {
 *   console.log('Clicked:', li.textContent);
 * });
 * ```
 *
 * @param container  The parent element or document to listen on.
 * @param selector   CSS selector to match against delegated targets.
 * @param event      DOM event name (e.g. `'click'`, `'input'`).
 * @param handler    Called with the event and the matched child element.
 * @param options    Standard `addEventListener` options (capture, passive, etc.).
 * @returns An unsubscribe function that removes the listener.
 */
export function delegate<K extends keyof HTMLElementEventMap>(
  container: HTMLElement | Document,
  selector: string,
  event: K,
  handler: (e: HTMLElementEventMap[K], matchedEl: HTMLElement) => void,
  options?: AddEventListenerOptions,
): () => void {
  const listener = (e: Event) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const root =
      container instanceof Document ? container.documentElement : container;
    const matched = target.closest(selector);

    if (matched instanceof HTMLElement && root.contains(matched)) {
      handler(e as HTMLElementEventMap[K], matched);
    }
  };

  container.addEventListener(event, listener, options);

  return () => {
    container.removeEventListener(event, listener, options);
  };
}
