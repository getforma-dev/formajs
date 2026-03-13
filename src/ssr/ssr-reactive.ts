/**
 * SSR-only signal: just a value holder, no reactivity needed on server.
 */
export function ssrSignal<T>(initial: T): [get: () => T, set: (v: T) => void] {
  let value = initial;
  return [() => value, (v) => { value = v; }];
}

export function ssrComputed<T>(fn: () => T): () => T {
  return fn; // On server, just call the function directly
}
