/**
 * SSR-only signal: just a value holder, no reactivity needed on server.
 *
 * @deprecated `@getforma/core/ssr` is removed in 3.0.0 (FORMA_W_DEPRECATED_SSR): render on the server with the Rust walker (forma-server).
 */
export function ssrSignal<T>(initial: T): [get: () => T, set: (v: T) => void] {
  let value = initial;
  return [() => value, (v) => { value = v; }];
}

/**
 * @deprecated `@getforma/core/ssr` is removed in 3.0.0 (FORMA_W_DEPRECATED_SSR): render on the server with the Rust walker (forma-server).
 */
export function ssrComputed<T>(fn: () => T): () => T {
  return fn; // On server, just call the function directly
}
