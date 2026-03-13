// Observer wrappers — clean API for ResizeObserver, IntersectionObserver, MutationObserver

export function onResize(
  el: HTMLElement,
  handler: (entry: ResizeObserverEntry) => void,
): () => void {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      handler(entry);
    }
  });
  observer.observe(el);
  return () => {
    observer.disconnect();
  };
}

export function onIntersect(
  el: HTMLElement,
  handler: (entry: IntersectionObserverEntry) => void,
  options?: IntersectionObserverInit,
): () => void {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      handler(entry);
    }
  }, options);
  observer.observe(el);
  return () => {
    observer.disconnect();
  };
}

export function onMutation(
  el: HTMLElement,
  handler: (mutations: MutationRecord[]) => void,
  options?: MutationObserverInit,
): () => void {
  const observer = new MutationObserver((mutations) => {
    handler(mutations);
  });
  observer.observe(el, options ?? { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}
