# FormaJS Hardening Plan

**Version:** 0.4.0 → 0.5.0
**Date:** 2026-03-15
**Baseline:** 623 tests passing, 51 test files

## Architecture Context

FormaJS is the reactive runtime layer of a full-stack pipeline:

```
TypeScript → @getforma/compiler → FMIR binary → forma-ir (Rust walker) → HTML → FormaJS (hydration)
```

**Two audiences:**
1. **AI pipeline (Claude)** — generates HTML modules with `data-forma-*` directives, rendered inside `<forma-stage>` Shadow DOM. Modules swap constantly during generation.
2. **External developers** — consuming `@getforma/core` via npm.

**Hard constraints (binary protocol with Rust):**
- Marker comments: `<!--f:t{id}-->`, `<!--f:s{id}-->`, `<!--f:l{id}-->`, `<!--f:i{id}-->`
- Island attributes: `data-forma-island`, `data-forma-component`, `data-forma-props`, `data-forma-status`, `data-forma-hydrate`, `data-forma-key`
- Props script tag: `<script id="__forma_islands" type="application/json">`
- WASM exports: `render(ir_bytes, slots_json)`, `render_island(ir_bytes, slots_json, island_id)`

**Compiler output contracts (changing these breaks all compiled modules):**
- `template(htmlString)` — compiled h() calls
- `createEffect(callback)` — reactive bindings
- `$$serverFunction(endpoint)` — RPC stubs
- `registerServerFunction(path, fn)` — server routing
- `activateIslands(registry)` — island registration
- `h(tag, props, ...children)` — runtime fallback

None of the changes in this plan touch the binary protocol or compiler output contracts.

---

## Phase 1 — Security & Runtime Correctness

**Goal:** Eliminate all XSS vectors, data corruption bugs, and the memory leak that affects every module swap in the AI pipeline.

### H3 — Island disposal (memory leak on module swap)

**Priority:** CRITICAL for AI pipeline — every module swap in `<forma-stage>` leaks a `createRoot` scope with all its effects, listeners, and signal subscriptions.

**Files:**
- `src/dom/activate.ts` — add `deactivateIsland()` export, extend MutationObserver coverage

**Fix:**
```typescript
// New export: manual island disposal
export function deactivateIsland(el: HTMLElement): void {
  const dispose = (el as any).__formaDispose;
  if (typeof dispose === 'function') {
    dispose();
    delete (el as any).__formaDispose;
    el.setAttribute('data-forma-status', 'disposed');
  }
}

// New export: dispose ALL islands under a root (for module swap)
export function deactivateAllIslands(root: Element | Document = document): void {
  const islands = root.querySelectorAll<HTMLElement>('[data-forma-status="active"]');
  for (const island of islands) {
    deactivateIsland(island);
  }
}
```

The existing MutationObserver in `runtime.ts:2744` watches for `data-forma-state` removal but ignores `data-forma-island`. Extend `processMutation` to also clean up removed islands:

```typescript
// In processMutation(), after the data-forma-state cleanup:
if (el.hasAttribute('data-forma-island')) {
  deactivateIsland(el as HTMLElement);
}
const removedIslands = el.querySelectorAll('[data-forma-island]');
for (let j = 0; j < removedIslands.length; j++) {
  deactivateIsland(removedIslands[j] as HTMLElement);
}
```

**Complexity:** M
**Dependencies:** None
**Tests:**
- Island disposal via `deactivateIsland()` calls `createRoot` dispose
- `deactivateAllIslands()` cleans up all active islands under a root
- MutationObserver cleanup when island element is removed from DOM
- Effects stop running after island disposal
- Double-disposal is idempotent

---

### H1 — SSR streaming skips `dangerouslySetInnerHTML` validation

**Files:**
- `src/ssr/stream.ts:63-64, 253-254` — add validation matching `render.ts`

**Fix:** Port the validation from `render.ts` to both `renderSync` and `renderStreamNode`:

```typescript
// Replace the direct cast at line 63-64:
if (props?.['dangerouslySetInnerHTML']) {
  const raw = props['dangerouslySetInnerHTML'];
  if (typeof raw !== 'object' || raw == null || !('__html' in raw) || typeof (raw as any).__html !== 'string') {
    throw new TypeError('dangerouslySetInnerHTML must be { __html: string }');
  }
  parts.push((raw as { __html: string }).__html);
}
```

Same fix at line 253-254.

**Complexity:** S
**Dependencies:** None
**Tests:**
- `renderSync` throws TypeError for non-object `dangerouslySetInnerHTML`
- `renderSync` throws TypeError for missing `__html`
- `renderSync` throws TypeError for non-string `__html`
- `renderStreamNode` same three tests
- Valid `{ __html: string }` still renders correctly in both paths

---

### H5 — `parseState` regex corrupts URLs in state objects

**Files:**
- `src/runtime.ts:375, 2043-2054` — fix or remove the relaxed JSON parser

**Analysis:** The regex `RE_UNQUOTED_KEYS = /(\w+)\s*:/g` matches colons inside string values. `{url: "https://example.com"}` becomes `{"url": "https"://example.com"}` → invalid JSON → silent `{}` return. Every AI-generated module with an API endpoint in state hits this.

**Fix:** Remove the relaxed parser entirely. JSON is JSON — if it doesn't parse, warn and return `{}`. The AI pipeline always generates valid JSON. External developers using the HTML Runtime should write valid JSON in `data-forma-state` attributes. The unquoted-keys fallback creates a security/correctness surface for zero real benefit.

```typescript
function parseState(raw: string): Record<string, unknown> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (__DEV__) {
      console.warn('[forma] Invalid JSON in data-forma-state — use valid JSON with quoted keys. Got:', raw.slice(0, 200));
    }
    return {};
  }
  // Strip prototype-pollution keys
  for (const key of FORBIDDEN_STATE_KEYS) {
    if (key in parsed) delete parsed[key];
  }
  return parsed;
}
```

Also remove the `RE_UNQUOTED_KEYS` constant (dead code after this change).

**Complexity:** S
**Dependencies:** None
**Tests:**
- Valid JSON parses correctly
- Unquoted-key JSON returns `{}` with dev warning (not silently corrupted data)
- URLs in JSON values are preserved: `{"url": "https://example.com"}` → works
- Prototype pollution keys stripped
- Empty/malformed strings return `{}`

---

### H2 — `findBlockedMethod` bypass via computed bracket access

**Files:**
- `src/runtime.ts:445-485` — harden against dynamic bracket concatenation

**Analysis:** `x['constr' + 'uctor']('alert(1)')()` bypasses the regex-based blocklist. This only affects the **standard build** with `_allowUnsafeEval = true`. The hardened build (used by the AI pipeline inside `<forma-stage>`) is not affected because `new Function()` is never called. But CDN users of the standard build are exposed.

**Fix:** Two layers:

**Layer 1:** In `findBlockedMethod`, also scan for bracket access with concatenation operators on blocked names:
```typescript
// After existing dot/bracket checks, add fragment detection:
// If expression contains string fragments of blocked names inside brackets,
// block it. e.g. 'constr' + 'uctor' → contains 'constructor' fragments
for (const { name } of BLOCKED_METHOD_REGEXES) {
  // Check for string fragments that could concatenate to the blocked name
  // e.g., 'const' or 'ctor' appearing near bracket access + concatenation
  if (cleaned.includes('[') && containsBlockedFragments(cleaned, name)) {
    return name;
  }
}
```

**Layer 2:** In the `new Function()` wrapper's `with(proxy)` handler, add a `get` trap that blocks property access to dangerous names on returned objects:

```typescript
// In the Proxy get trap (around line 2009), when resolving a property:
if (UNSAFE_METHOD_NAMES_SET.has(String(prop))) {
  return undefined;
}
```

This is defense-in-depth: even if fragment detection misses a bypass, the proxy blocks the access at runtime.

**Complexity:** M
**Dependencies:** None
**Tests:**
- `x['constr' + 'uctor']` is blocked
- `x['__proto__']` is blocked (literal — already works, regression test)
- `x.constructor` is blocked (dot access — already works, regression test)
- Template literal bypass: `` x[`constructor`] `` is blocked (already works)
- Proxy layer blocks `constructor` access on resolved values
- Legitimate bracket access still works: `items[0]`, `obj['valid-key']`

---

### Definition of Done — Phase 1
- All 4 security/correctness fixes implemented
- Existing 623 tests still pass
- New tests for each fix (est. 20+ new tests)
- `npm run typecheck` clean
- No changes to binary protocol or compiler output contracts

---

## Phase 2 — Developer API & Error Reporting

**Goal:** Make the public API safe and unsurprising for external developers, and surface errors for the AI pipeline's error taxonomy.

### C6 — Silent error swallowing in component lifecycle

**Files:**
- `src/component/define.ts:127-130, 136-139, 158-161`

**Fix:** Replace empty `catch {}` blocks with `reportError` calls. The `reportError` function from `src/reactive/dev.ts` already handles dev-mode logging and custom error handlers via `onError()`:

```typescript
// Line 127-130: unmount callbacks
} catch (e) {
  reportError(e, 'onUnmount');
}

// Line 136-139: disposers
} catch (e) {
  reportError(e, 'component disposer');
}

// Line 158-161: mount callbacks
} catch (e) {
  reportError(e, 'onMount');
}
```

Import `reportError` from `forma/reactive`. This surfaces lifecycle errors through the existing `onError()` handler, which the AI pipeline can hook into.

**Complexity:** S
**Dependencies:** None
**Tests:**
- `onMount` error is reported via `reportError` (not swallowed)
- `onUnmount` error is reported via `reportError` (not swallowed)
- Errors don't prevent other callbacks from running (still iterate all)
- `onError` handler receives lifecycle errors with correct `source` field

---

### S1 — `createComputed` semantics: document, don't rename

**Files:**
- `src/reactive/computed.ts:1-9` — update JSDoc
- `src/reactive/memo.ts:1-8` — update JSDoc

**Decision:** Document the difference. Don't rename or deprecate. FormaJS's `createComputed` is a lazy cached derivation — the correct semantics for this library. SolidJS's `createComputed` (eager synchronous side effect) is the odd one out and Solid's own community has questioned it.

**Fix:** Add a clear note to the JSDoc:

```typescript
/**
 * Create a lazy, cached computed value.
 *
 * Note: Unlike SolidJS's createComputed (which is an eager synchronous
 * side effect), this is a lazy cached derivation — equivalent to
 * SolidJS's createMemo. Both createComputed and createMemo in FormaJS
 * are identical.
 */
```

**Complexity:** S
**Dependencies:** None
**Tests:** None needed (documentation-only)

---

### C4 — Remove `longestIncreasingSubsequence` from public API

**Files:**
- `src/index.ts:11` — remove from export
- `src/dom/index.ts` — keep internal export for `list.ts`

**Fix:** Remove `longestIncreasingSubsequence` from the barrel export in `src/index.ts`. It remains in `src/dom/index.ts` for internal use by `list.ts` and test access.

**Complexity:** S
**Dependencies:** None
**Tests:** Update `src/__tests__/index-surface.test.ts` to verify it's NOT exported

---

### C5 — Migrate deprecated `createValueSignal` to `createSignal`

**Files (4 total, not 3 — the report missed `runtime.ts`):**
- `src/reactive/resource.ts:71-72`
- `src/state/history.ts:66-68`
- `src/server/action.ts:86-87`
- `src/runtime.ts:2078`

**Fix:** Replace `createValueSignal` with `createSignal` in all 4 files. Then remove the deprecated alias from `src/reactive/signal.ts` and `src/reactive/index.ts`.

**Complexity:** S
**Dependencies:** None
**Tests:** Existing tests should pass (same behavior). Add a test to `index-surface.test.ts` verifying `createValueSignal` is no longer exported.

---

### H4 — Cap `compiledTemplateCache` size

**Files:**
- `src/runtime.ts:434` — add LRU-style eviction

**Fix:** Apply the same FIFO eviction pattern used by `expressionCache` (line 408, capped at 2048):

```typescript
const TEMPLATE_CACHE_LIMIT = 2048;
// In the cache setter:
if (compiledTemplateCache.size >= TEMPLATE_CACHE_LIMIT) {
  const firstKey = compiledTemplateCache.keys().next().value;
  compiledTemplateCache.delete(firstKey);
}
```

**Complexity:** S
**Dependencies:** None
**Tests:**
- Cache evicts oldest entry when limit reached
- Cached templates still return correct results after eviction of unrelated entries

---

### S4 — Add `$el` and `$dispatch` magics to HTML Runtime

**Files:**
- `src/runtime.ts` — add to scope initialization and proxy resolution

**Analysis:** These are the two highest-value Alpine.js magics for both the AI pipeline (cross-scope communication via `$dispatch`) and external developers (DOM access via `$el`).

**Fix — `$el`:** In the scope's proxy `get` handler, when the expression context is an element, expose the current element:

```typescript
// In evalExpr or the expression evaluation context, add $el
// pointing to the element the directive is on
scopeGetters['$el'] = () => currentElement;
```

**Fix — `$dispatch`:** Add a helper that dispatches a CustomEvent from the current element:

```typescript
// In scope initialization:
scopeGetters['$dispatch'] = () => (name: string, detail?: unknown) => {
  currentElement.dispatchEvent(new CustomEvent(name, {
    bubbles: true,
    composed: true, // crosses Shadow DOM boundaries (important for <forma-stage>)
    detail,
  }));
};
```

`composed: true` is critical — AI-generated modules render inside Shadow DOM, and `$dispatch` events need to bubble out to the host.

**Complexity:** M
**Dependencies:** None
**Tests:**
- `$el` resolves to the element with the directive
- `$el` is different per element in the same scope
- `$dispatch` fires a CustomEvent on the element
- `$dispatch` event bubbles
- `$dispatch` event has `composed: true`
- `$dispatch` event carries `detail` payload
- `$dispatch` works in `data-on:click` handler

---

### Definition of Done — Phase 2
- All 6 items implemented
- Existing 623+ tests still pass (Phase 1 tests too)
- New tests for C6, C4, C5, H4, S4
- `npm run typecheck` clean

---

## Phase 3 — Performance & Capabilities

**Goal:** Deliver on promised performance features and close the highest-value capability gaps.

### S6 — Implement `interaction` and `idle` hydration triggers

**Files:**
- `src/dom/activate.ts:68-70` — replace stubs with real implementations

**Context:** The Rust IR walker already emits `data-forma-hydrate="interaction"` and `data-forma-hydrate="idle"` via the `IslandTrigger` enum. FormaJS currently logs a dev warning and falls back to `load`. This is the only place where the Rust/JS contract is already defined but JS doesn't fulfill it.

**Fix — `idle`:**
```typescript
if (trigger === 'idle') {
  const hydrate = () => hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(hydrate);
  } else {
    setTimeout(hydrate, 200); // fallback for Safari
  }
}
```

**Fix — `interaction`:**
```typescript
if (trigger === 'interaction') {
  const hydrate = () => {
    root.removeEventListener('pointerdown', hydrate, { capture: true });
    root.removeEventListener('focusin', hydrate, { capture: true });
    hydrateIslandRoot(root, id, componentName, hydrateFn, sharedProps);
  };
  root.addEventListener('pointerdown', hydrate, { capture: true, once: true });
  root.addEventListener('focusin', hydrate, { capture: true, once: true });
}
```

**Complexity:** M
**Dependencies:** None
**Tests:**
- `idle` trigger defers hydration via `requestIdleCallback`
- `idle` trigger falls back to `setTimeout` when `requestIdleCallback` unavailable
- `interaction` trigger hydrates on first `pointerdown`
- `interaction` trigger hydrates on first `focusin`
- `interaction` listeners are removed after hydration (no double-hydrate)
- Status transitions: `pending` → (trigger) → `hydrating` → `active`

---

### C3 — `applyDynamicProps` in hydrate.ts doesn't use AbortController

**Files:**
- `src/dom/hydrate.ts:200-229`

**Fix:** Use the same AbortController pattern from `element.ts:257-263` so hydrated event listeners can be cleaned up via `cleanup(el)`:

```typescript
// In applyDynamicProps, for event handlers:
if (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && key.length > 2) {
  // Get or create AbortController for cleanup support
  let ac = (el as any)[ABORT_SYM] as AbortController | undefined;
  if (!ac) {
    ac = new AbortController();
    (el as any)[ABORT_SYM] = ac;
  }
  el.addEventListener(key.slice(2).toLowerCase(), value as EventListener, { signal: ac.signal });
  continue;
}
```

Import `ABORT_SYM` from `element.ts` (or use the same symbol).

**Complexity:** S
**Dependencies:** Need to verify `ABORT_SYM` is accessible from `hydrate.ts` (same module scope via `dom/`)
**Tests:**
- Hydrated event listeners can be removed via `cleanup(el)`
- Hydrated event listeners still fire before cleanup
- Multiple hydrated listeners on same element share one AbortController

---

### S3 — Support component functions in `h()`

**Files:**
- `src/dom/element.ts:606-612` — add function overload

**Analysis:** This is the riskiest item. Currently `h()` only accepts `string | typeof Fragment`. Supporting `h(Counter, {count: 5})` requires:
1. New type overload: `h(tag: (props: P) => Node, props: P): Node`
2. When `tag` is a function, call it with `props` merged with `children`
3. Hydration mode: need to handle function components in descriptor generation
4. SSR: `renderToBuffer` and `renderStreamNode` need to handle function components

**Risk:** This touches the compiler contract — the compiler uses `h()` as a fallback for uncompilable calls. If the return type changes or function components interact poorly with hydration descriptors, compiled output breaks.

**Fix — minimal, safe approach:** Only handle the CSR (client-side rendering) path. When hydrating, bail to the existing behavior. This avoids touching the Rust/JS protocol:

```typescript
// New overload:
export function h(tag: (props: Record<string, unknown>) => unknown, props?: Record<string, unknown> | null, ...children: unknown[]): Node;

// In implementation, before the Fragment guard:
if (typeof tag === 'function' && tag !== Fragment) {
  const mergedProps = { ...(props ?? {}), children };
  return tag(mergedProps) as Node;
}
```

**What this does NOT do:**
- No hydration support for function components (descriptors are element-only)
- No SSR support for function components via the Rust walker (IR is tag-based)
- No integration with `defineComponent` lifecycle

This is intentionally minimal — it enables `h(Counter, {count: 5})` for client-only composition without touching the binary protocol.

**Complexity:** L
**Dependencies:** Must not break hydration descriptors or compiled template output
**Tests:**
- `h(fn, props)` calls the function with merged props
- `h(fn, null, child1, child2)` passes children in props
- `h(fn, props)` returns whatever the function returns
- Function components work inside `mount()`
- Function components work inside `createList` render callbacks
- Does NOT generate hydration descriptors (returns actual DOM in hydration mode too)

---

### C8 — Inconsistent import paths in HTTP modules

**Files:**
- `src/http/fetch.ts:8`
- `src/http/sse.ts:8`
- `src/http/ws.ts:8`

**Fix:** Change `forma/reactive/index.js` → `forma/reactive` to match all other modules.

**Complexity:** S
**Dependencies:** None
**Tests:** Existing tests pass (same resolution)

---

### S7 — Turbo Streams evaluation (design only, no implementation)

**Scope:** Evaluate whether targeted server-pushed DOM mutations can be built on `createSSE` + `reconcile()`. Produce a design doc, not code.

**Output:** A short design document answering:
1. What message format would server-pushed mutations use?
2. Can `reconcile()` with `ReconcileScope.REPLACE` handle individual element targeting?
3. Does this require a new module or extend existing SSE/WebSocket primitives?
4. What's the API surface for external developers?

**Complexity:** M (research/design only)
**Dependencies:** Understanding of `src/dom/reconcile.ts` and `src/http/sse.ts`
**Tests:** None (design deliverable)

---

### Definition of Done — Phase 3
- S6 triggers fully implemented (no more stubs)
- C3 hydration event cleanup works
- S3 function components work in client-side `h()` calls
- C8 import paths standardized
- S7 design doc produced
- All existing + Phase 1-2 tests still pass

---

## Phase 4 — Test Coverage (Parallel)

**Goal:** Cover all untested security-sensitive and concurrency-sensitive code paths. Runs in parallel with Phases 1-3.

### C1 — Tests for `src/reactive/suspense-context.ts`

**What to test:**
- `pushSuspense` / `popSuspense` stack operations
- `getCurrentSuspense` returns the top of stack
- `getCurrentSuspense` returns `undefined` when stack empty
- Nested push/pop restores previous boundary
- Pop with empty stack doesn't crash

**Complexity:** S
**Dependencies:** None

---

### C2 — Tests for `src/server/rpc-client.ts` and `src/server/rpc-handler.ts`

**What to test:**

**rpc-client.ts (`$$serverFunction`):**
- Returns a callable function
- Function makes POST to the correct endpoint
- Function serializes args as JSON body
- Function returns parsed response
- Revalidation event dispatched on success

**rpc-handler.ts (`handleRPC`, `createRPCMiddleware`):**
- Routes to registered functions by endpoint path
- Returns 404 for unknown endpoints
- `FORBIDDEN_KEYS` (`__proto__`, `constructor`, `prototype`, `toString`, `valueOf`, `hasOwnProperty`) are blocked
- Error messages sanitized in production (generic "Internal server error")
- Error messages include details in development
- Malformed JSON body returns 400

**Complexity:** M
**Dependencies:** None

---

### C7 — Tests for `src/reactive/reducer.ts`

**What to test:**
- Returns `[state, dispatch]` tuple
- `dispatch(action)` updates state via reducer function
- Effects react to state changes from dispatch
- Multiple dispatches in sequence work correctly
- Reducer receives current state and action

**Complexity:** S
**Dependencies:** None

---

### H3 Tests — Island disposal (Phase 1 companion)

**What to test:**
- `deactivateIsland` calls the root's dispose function
- `deactivateIsland` sets status to `disposed`
- `deactivateAllIslands` cleans up all active islands
- MutationObserver triggers disposal on island removal
- Disposed island effects stop running
- Double disposal is safe (idempotent)

**Complexity:** S
**Dependencies:** H3 implementation (Phase 1)

---

### Definition of Done — Phase 4
- All 4 test suites written
- Zero untested security-sensitive modules
- Coverage for suspense concurrency, RPC security, reducer, island disposal

---

## Closed / Won't Fix

### S5 — No shorthand syntax (`@click`, `:class`)

**Status:** CLOSED — intentional design decision.

**Rationale:** `data-on:click` and `data-bind:class` are HTML5-valid `data-*` attributes, unambiguous for AI generation, and parseable by automated pipelines. Alpine's `@click` and `:class` shorthands are non-standard attributes that:
- Fail HTML validation
- Can conflict with other frameworks
- Are ambiguous for AI code generation (is `@click` an Angular directive or Alpine?)
- Require special parsing in build tools

The longer syntax is a feature, not a gap. Document it as such in the README.

### S8 — No Turbo Drive equivalent (full-page navigation)

**Status:** DEFERRED — not on roadmap.

**Rationale:** FormaJS is an islands-focused library, not a navigation framework. Link interception and full-page replacement are concerns for a meta-framework layer (like Astro, SolidStart, or a future Forma framework). Adding this to the core library would bloat the bundle and conflate responsibilities.

---

## Summary Table

| ID | Phase | Description | Complexity | Status |
|----|-------|-------------|------------|--------|
| H3 | 1 | Island disposal (memory leak on module swap) | M | DONE |
| H1 | 1 | SSR stream `dangerouslySetInnerHTML` validation | S | DONE |
| H5 | 1 | Remove `parseState` relaxed JSON parser | S | DONE |
| H2 | 1 | `findBlockedMethod` computed bracket bypass | M | DONE |
| C6 | 2 | Report lifecycle errors via `reportError` | S | TODO |
| S1 | 2 | Document `createComputed` semantics (not rename) | S | TODO |
| C4 | 2 | Remove `longestIncreasingSubsequence` from API | S | TODO |
| C5 | 2 | Migrate `createValueSignal` → `createSignal` (4 files) | S | TODO |
| H4 | 2 | Cap `compiledTemplateCache` at 2048 | S | TODO |
| S4 | 2 | Add `$el` and `$dispatch` magics | M | TODO |
| S6 | 3 | Implement `interaction` and `idle` triggers | M | TODO |
| C3 | 3 | AbortController for hydrated event listeners | S | TODO |
| S3 | 3 | Support function components in `h()` | L | TODO |
| C8 | 3 | Standardize HTTP module import paths | S | TODO |
| S7 | 3 | Turbo Streams evaluation (design doc only) | M | TODO |
| C1 | 4 | Tests for `suspense-context.ts` | S | TODO |
| C2 | 4 | Tests for `rpc-client.ts` / `rpc-handler.ts` | M | TODO |
| C7 | 4 | Tests for `reducer.ts` | S | TODO |

**Total estimated effort:** ~2-3 days for Phase 1, ~1-2 days for Phase 2, ~2-3 days for Phase 3, Phase 4 runs in parallel.

---

## Notes

- **`runtime.ts` split (report item 19):** Not in scope. Natural split points: expression parser (~lines 1-500), directive handlers (~500-2000), state/scope management (~2000-2800), observer/init (~2800-3077). Future work.
- **Version bump:** Phase 1 completion → 0.5.0 (contains breaking removal of relaxed JSON parser). Phase 2 → 0.5.x. Phase 3 → 0.6.0 (function components in `h()` is a public API addition).
- **create-forma-app templates** specify `@getforma/core ^0.3.0` — update to `^0.5.0` after Phase 1 ships.
