/**
 * The public export surface of every entry point, pinned exactly.
 *
 * This file used to hold nine `expect(typeof forma.x).toBe('function')` probes
 * plus six `does NOT export …` tests. The negative ones were true by
 * construction — they asserted `toBeUndefined()` on names the barrel never
 * exported, so they passed with any typo and could only fail if someone ADDED
 * the export — while silently dropping `createPortal` from `src/index.ts` was
 * caught by nothing at all.
 *
 * One `Object.keys(mod).sort()` per subpath catches both directions in one
 * assertion, and catches it for all 125 exported names rather than the 16 that
 * happened to be listed. A removal breaks the build for every consumer; an
 * addition is a public-API commitment. Both should require editing this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Every subpath in `package.json#exports`, mapped to its source entry module.
 * `package-exports.test.ts` pins the packaging metadata; this pins what the
 * modules behind it actually export.
 */
const SURFACES: Record<string, { load: () => Promise<object>; exports: string[] }> = {
  '.': {
    load: () => import('../index'),
    exports: [
      '$', '$$', 'Fragment', 'activateIslands', 'addClass', 'batch', 'children',
      'cleanup', 'closest', 'createBus', 'createComputed', 'createContext',
      'createEffect', 'createErrorBoundary', 'createHistory', 'createList',
      'createMemo', 'createPortal', 'createReducer', 'createRef',
      'createResource', 'createRoot', 'createShow', 'createSignal',
      'createStore', 'createSuspense', 'createSwitch', 'createText',
      'createUnownedRoot', 'deactivateAllIslands', 'deactivateIsland',
      'defineComponent', 'delegate', 'disposeComponent', 'fragment',
      'getBatchDepth', 'getOwner', 'getSignalName', 'h', 'hydrateIsland',
      'inject', 'isComputed', 'isEffect', 'isEffectScope', 'isSignal', 'mount',
      'nextSibling', 'on', 'onCleanup', 'onError', 'onIntersect', 'onKey',
      'onMount', 'onMutation', 'onResize', 'onUnmount', 'parent', 'persist',
      'prevSibling', 'provide', 'reconcileList', 'removeClass', 'runWithOwner',
      'sanitizePropsDeep', 'setAttr', 'setHTMLUnsafe', 'setStyle', 'setText',
      'siblings', 'svg', 'template', 'templateMany', 'toggleClass',
      'trackDisposer', 'trigger', 'unprovide', 'untrack', 'value',
    ],
  },
  './runtime': {
    load: () => import('../runtime'),
    exports: [
      'applyContainmentHints', 'clearDiagnostics', 'destroyRuntime',
      'getDiagnostics', 'getScopes', 'initRuntime', 'mount', 'reconcile',
      'resetScope', 'setDebug', 'setDiagnostics', 'setDirectiveMap',
      'setScopeValue', 'unmount', 'yieldToMain',
    ],
  },
  './ssr': {
    load: () => import('../ssr/index'),
    exports: [
      'getSwapScript', 'getSwapTag', 'renderToStream', 'renderToString', 'sh',
      'shSuspense', 'ssrComputed', 'ssrSignal',
    ],
  },
  './http': {
    load: () => import('../http/index'),
    exports: ['createFetch', 'createSSE', 'createWebSocket', 'fetchJSON'],
  },
  './storage': {
    load: () => import('../storage/index'),
    exports: ['createIndexedDB', 'createLocalStorage', 'createSessionStorage'],
  },
  './server': {
    load: () => import('../server/index'),
    exports: [
      '$$serverFunction', 'applyRevalidation', 'createAction',
      'createRPCMiddleware', 'enableAutoRevalidation', 'getRegisteredEndpoints',
      'getServerFunction', 'handleRPC', 'registerResource',
      'registerServerFunction', 'setRPCGuard', 'unregisterResource',
      'withRevalidation',
    ],
  },
  './wasm': {
    load: () => import('../wasm/forma-wasm'),
    exports: ['renderIsland', 'renderLocal'],
  },
  './tc39': {
    load: () => import('../reactive/tc39-compat'),
    exports: ['Computed', 'State'],
  },
};

describe('public api surface', () => {
  it.each(Object.keys(SURFACES))('%s exports exactly the documented names', async (subpath) => {
    const { load, exports } = SURFACES[subpath]!;
    const mod = await load();
    const actual = Object.keys(mod).filter((n) => n !== 'default').sort();
    expect(actual).toEqual([...exports].sort());
  });

  it.each(Object.keys(SURFACES))('%s exports only callable or usable values', async (subpath) => {
    // An entry that resolves to `undefined` is the shape a broken re-export
    // takes: the name is present on the namespace and the value is not.
    const mod = (await load(subpath)) as Record<string, unknown>;
    const dead = Object.keys(mod).filter((n) => n !== 'default' && mod[n] === undefined);
    expect(dead).toEqual([]);
  });

  it('the subpaths pinned here are exactly the ones package.json publishes', () => {
    // A new subpath in the exports map with no surface pinned here is how an
    // entry point ships unreviewed.
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
    };
    // ./runtime-hardened and ./runtime-csp are BUILD VARIANTS of src/runtime.ts
    // (same source, different `__FORMA_UNSAFE_EVAL_MODE__` define), so they have
    // no distinct source module to introspect. Their artifact-level differences
    // are pinned by build-artifacts.test.ts.
    const VARIANTS_OF_RUNTIME = ['./runtime-hardened', './runtime-csp'];
    for (const key of VARIANTS_OF_RUNTIME) {
      expect(pkg.exports[key], `${key} should still be published`).toBeDefined();
    }
    const published = Object.keys(pkg.exports)
      .filter((k) => k !== './package.json' && !VARIANTS_OF_RUNTIME.includes(k))
      .sort();
    expect(published).toEqual(Object.keys(SURFACES).sort());
  });
});

function load(subpath: string): Promise<object> {
  return SURFACES[subpath]!.load();
}
