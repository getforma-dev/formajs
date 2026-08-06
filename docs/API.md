# Core API

Everything on this page is exported from `@getforma/core` unless a subpath is
named. For the network, storage, server and SSR entry points see
[`CDN-AND-EXPORTS.md`](CDN-AND-EXPORTS.md); for island hydration see
[`ISLANDS.md`](ISLANDS.md).

---

## The `h()` function

`h()` is the core of FormaJS rendering. Every component — whether written in
JSX, hyperscript, or compiled from the HTML runtime — resolves to `h()` calls
that create real DOM elements.

```ts
h(tag, props?, ...children)
```

| Parameter | Type | Description |
|---|---|---|
| `tag` | `string \| Function` | An HTML tag name (`'div'`, `'button'`) or a component function (`Counter`) |
| `props` | `object \| null` | Attributes, event handlers, and component props. Pass `null` or `{}` to skip. |
| `children` | `string \| number \| () => string \| Node \| Array` | Zero or more children — static text, reactive functions, elements, or arrays of any of these. |

### The key rule

**If a child is a function, it is reactive.** FormaJS wraps it in an effect so
the DOM text node or subtree updates when signals inside it change. A plain
string or number is static — rendered once, never touched again.

The same rule holds for props: `class={() => …}` re-runs on signal change;
`class={…}` is evaluated once.

### Patterns

```ts
// Static text child
h("footer", { class: "text-sm" }, "Built with Forma")

// Reactive text child — updates when count() changes
h("button", { onClick: fn }, () => `Count: ${count()}`)

// Multiple children
h("div", { class: "card" },
  h("h2", null, "Title"),
  h("p", null, "Body text"),
  h("button", { onClick: fn }, "Click"),
)

// Children as an array (useful for dynamic lists)
h("ul", null, items.map(item => h("li", null, item.name)))

// Component function with props
h(Counter, { initial: 5 })

// Nested reactive children
h("div", null,
  () => showHeader() ? h("h1", null, "Welcome") : null,
  h("p", null, () => `You have ${count()} items`),
)
```

### JSX equivalence

JSX is syntactic sugar that compiles to `h()` calls. These are identical:

```tsx
// JSX
<button class="btn" onClick={() => setCount((c) => c + 1)}>
  {() => `Count: ${count()}`}
</button>

// h()
h("button", { class: "btn", onClick: () => setCount((c) => c + 1) },
  () => `Count: ${count()}`
)
```

Configure the JSX transform with `jsx: "react"`, `jsxFactory: "h"`,
`jsxFragmentFactory: "Fragment"`. There is no JSX-specific runtime.

---

## Signals

```ts
import { createSignal, createEffect, createComputed, batch } from "@getforma/core";

const [count, setCount] = createSignal(0);
const doubled = createComputed(() => count() * 2);

createEffect(() => console.log("count:", count()));

batch(() => {
  setCount(1);
  setCount(2); // effect fires once with value 2
});
```

**Custom equality** — skip updates when the value has not meaningfully changed:

```ts
const [pos, setPos] = createSignal(
  { x: 0, y: 0 },
  { equals: (a, b) => a.x === b.x && a.y === b.y },
);

setPos({ x: 0, y: 0 }); // skipped — equal
setPos({ x: 1, y: 0 }); // applied — different
```

**Computed with previous value** — the getter receives the previous result:

```ts
const changes = createComputed((prev) => {
  const current = items();
  if (prev) console.log(`${prev.length} → ${current.length} items`);
  return current;
});
```

**Reactive introspection** — type guards and utilities from alien-signals 3.x:

```ts
import { isSignal, isComputed, getBatchDepth, trigger } from "@getforma/core";

isSignal(count);       // true
isComputed(doubled);   // true
getBatchDepth();       // 0 outside batch, 1+ inside
trigger(doubled);      // force recomputation
```

The cost model behind these — what an equal-value write costs, what `batch()`
actually collapses, and where it does nothing — is measured in
[`PERFORMANCE.md`](PERFORMANCE.md), with a noise floor next to every number.

---

## Conditional rendering

```ts
import { createSignal, createShow, createSwitch, h } from "@getforma/core";

const [loggedIn, setLoggedIn] = createSignal(false);

// Two branches
createShow(
  loggedIn,
  () => h("p", null, "Welcome back"),
  () => h("p", null, "Please sign in"),
);

// Multi-branch with caching
const [view, setView] = createSignal("home");

createSwitch(
  view,
  [
    { match: "home", render: () => h("div", null, "Home") },
    { match: "settings", render: () => h("div", null, "Settings") },
  ],
  () => h("div", null, "404 Not Found"),
);
```

---

## List rendering

```ts
import { createSignal, createList, h } from "@getforma/core";

const [items, setItems] = createSignal([
  { id: 1, name: "Alice", art: "/covers/alice.jpg" },
  { id: 2, name: "Bob", art: "/covers/bob.jpg" },
]);

createList(
  items,
  (item) => item.id,
  (item) => h("li", null,
    h("img", { src: item.art, alt: item.name }),
    item.name,
  ),
);
```

Static item fields (`src: item.art`) bake into the element when the row renders
— the row is re-created when its key changes. Function props
(`src: () => coverUrl()`) are reactive and update the attribute in place.

---

## Store — deep reactivity

```ts
import { createStore } from "@getforma/core";

const [state, setState] = createStore({
  user: { name: "Alice", prefs: { theme: "dark" } },
  items: [1, 2, 3],
});

// Read reactively — tracked at the exact property path
state.user.name;   // "Alice"
state.items[0];    // 1

// Setter API — partial merge
setState({ user: { ...state.user, name: "Bob" } });
setState((prev) => ({ items: [...prev.items, 4] }));

// Or mutate directly — only affected subscribers update
state.user.name = "Bob";
state.items.push(4);
```

> `Object.keys(state)`, `for...in`, and spread (`{...state}`) are **not**
> reactive. Use signals or explicit arrays for collections whose membership
> must react.

A store setter is a sink for untrusted data if you hand it a parsed JSON body:
forbidden keys are stripped, but see the note on prop sanitization in
[`ISLANDS.md`](ISLANDS.md) for where the shallow/deep line falls.

---

## Components and lifecycle

```ts
import { createSignal, defineComponent, onMount, onUnmount, h } from "@getforma/core";

const Timer = defineComponent(() => {
  const [seconds, setSeconds] = createSignal(0);

  onMount(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id); // cleanup on unmount
  });

  return h("span", null, () => `${seconds()}s`);
});

document.body.appendChild(Timer());
```

`onMount(fn)` runs after DOM creation. If `fn` returns a function, it registers
as an unmount callback. `onUnmount(fn)` registers cleanup explicitly. Both feed
the same cleanup queue, so these are equivalent:

```ts
onMount(() => { const id = setInterval(tick, 1000); return () => clearInterval(id); });
onMount(() => { const id = setInterval(tick, 1000); onUnmount(() => clearInterval(id)); });
```

---

## Context — dependency injection

```ts
import { createContext, provide, inject } from "@getforma/core";

const ThemeCtx = createContext("light");

provide(ThemeCtx, "dark");
const theme = inject(ThemeCtx); // "dark"
```

---

## Reducer

```ts
import { createReducer } from "@getforma/core";

const [state, dispatch] = createReducer(
  (state, action) => {
    switch (action.type) {
      case "INCREMENT": return { count: state.count + 1 };
      case "DECREMENT": return { count: state.count - 1 };
      default: return state;
    }
  },
  { count: 0 },
);

dispatch({ type: "INCREMENT" }); // state() === { count: 1 }
```

---

## History — undo / redo

`createHistory` wraps a signal you already have. It takes the `[get, set]`
tuple as its single source argument and returns a **controls object** — it is
not a tuple and must not be destructured as one.

```ts
import { createSignal, createHistory } from "@getforma/core";

const [text, setText] = createSignal("");
const { undo, redo, canUndo, canRedo } = createHistory([text, setText]);

setText("hello");
setText("hello world");

canUndo();  // true
undo();     // text() === "hello"
canRedo();  // true
redo();     // text() === "hello world"
```

`createHistory(source, { maxLength })` caps the stack (default 100, minimum 1).
The full controls object is
`{ undo, redo, canUndo, canRedo, history, cursor, clear, destroy }`;
`canUndo` / `canRedo` / `history` / `cursor` are reactive getters. Call
`destroy()` to stop tracking the source and release the stack.

> **Limitation:** the source getter must return a stable value — a primitive or
> a stable object reference. A `createStore` slice that returns a *fresh proxy
> on every read* is not supported: the undo/redo echo guard compares by
> identity, so every undo would look like an external change and clear the redo
> stack.

Verified by `src/__tests__/readme-examples.test.ts` > "runs exactly as documented"

---

## Error handling

`mount()` fails fast — if the selector does not match, it throws:

```ts
mount(() => h("p", null, "hello"), "#nonexistent");
// Error: mount: container not found — "#nonexistent"
```

**Global error handler** for effects and lifecycle callbacks:

```ts
import { onError } from "@getforma/core";

onError((error, info) => {
  console.error(`[${info?.source}]`, error);
});
```

**Error boundaries** — catch rendering errors with fallback UI:

```ts
import { createErrorBoundary, h } from "@getforma/core";

createErrorBoundary(
  () => h(UnstableComponent),
  (error, retry) =>
    h("div", null,
      h("p", null, `Something went wrong: ${error.message}`),
      h("button", { onClick: retry }, "Retry"),
    ),
);
```

---

## Async — `createResource` and `createSuspense`

`createResource(source, fetcher, options?)` re-runs the fetcher whenever the
source signal changes, aborting the previous request. The returned resource is
callable for the data and carries `loading`, `error`, `refetch` and `mutate`.

```ts
import { createSignal, createResource, createSuspense, h } from "@getforma/core";

const [userId, setUserId] = createSignal(1);

const user = createResource(
  userId,
  (id, { signal }) => fetch(`/api/users/${id}`, { signal }).then((r) => r.json()),
);

user();          // data, or undefined while loading
user.loading();  // reactive boolean
user.error();    // reactive; undefined when fine
user.refetch();  // re-run with the current source

setUserId(2);    // aborts the in-flight request and refetches
```

`createSuspense(fallback, children)` shows `fallback` while any
`createResource` created *inside* `children` is loading. The boundary is
captured when the resource is created, so the resource must be constructed
during the `children()` call.

```ts
createSuspense(
  () => h("p", null, "Loading…"),
  () => h(UserCard),
);
```

---

## SVG

`h()` creates HTML elements. Wrap a tree in `svg()` to create it in the SVG
namespace instead — nested elements inherit the namespace for the duration of
the callback.

```ts
import { svg, h } from "@getforma/core";

const icon = svg(() =>
  h("svg", { viewBox: "0 0 24 24", width: 24 },
    h("circle", { cx: 12, cy: 12, r: 10, fill: "currentColor" }),
  ),
);
```

---

## Portals

`createPortal(children, target?)` renders `children` into another element
(default `document.body`) and returns a placeholder comment to keep in the
tree. Disposal removes the portalled node.

```ts
import { createPortal, h } from "@getforma/core";

createPortal(() => h("div", { class: "modal" }, "Hi"), "#modal-root");
```

---

## The rest of the export surface

Everything the root entry exports, grouped. These are stable and typed; the
sections above cover the ones with non-obvious semantics.

| Group | Exports |
|---|---|
| Signals | `createSignal`, `createEffect`, `createComputed`, `createMemo` (alias of `createComputed`), `createResource`, `createRef`, `createReducer`, `batch`, `untrack`, `on`, `value` (wraps a constant as a getter) |
| Ownership | `createRoot`, `createUnownedRoot`, `getOwner`, `runWithOwner`, `onCleanup`, `onError`, `trackDisposer` |
| Introspection | `isSignal`, `isComputed`, `isEffect`, `isEffectScope`, `getBatchDepth`, `trigger`, `getSignalName` |
| Rendering | `h`, `svg`, `Fragment`, `fragment`, `createText`, `mount`, `template`, `templateMany` |
| Control flow | `createShow`, `createSwitch`, `createList`, `reconcileList`, `createPortal`, `createSuspense`, `createErrorBoundary`, `cleanup` |
| Components | `defineComponent`, `disposeComponent`, `onMount`, `onUnmount`, `createContext`, `provide`, `inject`, `unprovide` |
| State | `createStore`, `createHistory`, `persist(source, key, options?)` — mirrors a `[get, set]` pair into `localStorage` |
| Islands | `activateIslands`, `hydrateIsland`, `deactivateIsland`, `deactivateAllIslands`, `sanitizePropsDeep` |
| Events | `createBus`, `delegate(container, selector, event, handler)`, `onKey(combo, handler, options?)` |
| DOM utils | `$`, `$$`, `addClass`, `removeClass`, `toggleClass`, `setStyle`, `setAttr`, `setText`, `setHTMLUnsafe`, `closest`, `children`, `siblings`, `parent`, `nextSibling`, `prevSibling`, `onResize`, `onIntersect`, `onMutation` |

Verified by `src/__tests__/docs-truth.test.ts` > "documents every symbol the root entry exports"

---

## Escape hatches — the trust boundary

FormaJS never builds markup from strings. `h()` creates elements with
`document.createElement` and writes text with `textContent`, which is why
`innerHTML` is not used for library-generated markup. Four APIs deliberately
break that rule; **none of them sanitizes**, and all four are
first-party-content-only sinks:

| Sink | Where | What it does |
|---|---|---|
| `dangerouslySetInnerHTML={{ __html }}` | prop on `h()` / JSX | assigns `innerHTML` on the element |
| `setHTMLUnsafe(el, html)` | `@getforma/core` | assigns `innerHTML` on the element |
| `reconcile(container, html)` | `@getforma/core/runtime` | parses an HTML string into a `<template>` and diffs it into the live page |
| `srcdoc` attribute | `h()` and SSR | the browser parses the *attribute value* as a document, so escaping does not neutralize it — emitted with a dev-mode warning |

Everything else is guarded: URL-bearing attributes (`href`, `src`, `action`,
`formaction`, `xlink:href`, `poster`, `background`, `data`) drop `javascript:`,
`vbscript:` and `data:text/html` values, and `on*` attribute names are dropped
in any casing, on both the client and SSR paths.

Verified by `src/dom/__tests__/element-url-safety.test.ts` > "drops exactly what the SSR renderer drops, so hydration cannot re-add it"
Verified by `src/dom/__tests__/element-url-safety.test.ts` > "drops ONCLICK-cased string props instead of writing an inline handler"
Verified by `src/dom/__tests__/element-url-safety.test.ts` > "emits srcdoc but warns that escaping does not neutralize it"

The full threat model is in [`../SECURITY.md`](../SECURITY.md).
