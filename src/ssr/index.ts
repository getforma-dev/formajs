import { sourceIsDev, warnDeprecated } from '../deprecated.js';

export { renderToString, sh } from './render.js';
export type { VNode } from './render.js';
export { ssrSignal, ssrComputed } from './ssr-reactive.js';
export { renderToStream, shSuspense, type StreamOptions, type SuspenseVNode } from './stream.js';
export { getSwapScript, getSwapTag } from './client-script.js';

declare const __FORMA_DEV_BUILD__: boolean | undefined;

// Deprecated, removed in 3.0.0 (DR-24). The first load of this entry in a
// development build logs FORMA_W_DEPRECATED_SSR once. The condition is
// `__DEV__`'s (src/reactive/dev.ts, with `sourceIsDev()` for its fallback),
// written out so the build folds it in this file: every published artifact is
// built with the flag `false`, so the build drops the call and its import, and
// no published file carries the warning.
// Verified by: src/__tests__/deprecated-entries.test.ts > "a production build of each deprecated entry carries no warning"
if ((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
  || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && sourceIsDev())) {
  warnDeprecated('FORMA_W_DEPRECATED_SSR');
}
