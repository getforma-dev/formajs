// Event delegation — single listener on parent, matches children by selector

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
