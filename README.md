# FormaJS

[![CI](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getforma/core)](https://www.npmjs.com/package/@getforma/core)
[![Socket Badge](https://socket.dev/api/badge/npm/package/@getforma/core)](https://socket.dev/npm/package/@getforma/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals. No virtual DOM — signals update only the DOM nodes that changed. Components run once. ~15 KB gzipped.

```tsx
import { createSignal, h, mount } from "@getforma/core";

const [count, setCount] = createSignal(0);

function Counter() {
  return (
    <button onClick={() => setCount((c) => c + 1)}>
      {() => `Clicked ${count()} times`}
    </button>
  );
}

mount(() => <Counter />, "#app");
```

No re-renders. No dependency arrays. No `useMemo`. The button text updates because it reads `count()` inside a reactive function — nothing else in the tree is touched.

---

## Install

```bash
npm install @getforma/core
```

Or use a CDN — no build step, no bundler:

```html
<!-- jsDelivr (recommended) -->
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@latest/dist/formajs-runtime.global.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/@getforma/core/dist/formajs-runtime.global.js"></script>
```

> **Production:** Pin the version (e.g., `@getforma/core@1.0.1`) instead of `@latest`.

---

## Getting Started with a Bundler

After `npm install`, you need a bundler to resolve ES module imports. Here's a minimal Vite setup:

```bash
npm install @getforma/core
npm install -D vite
```

```html
<!-- index.html -->
<div id="app"></div>
<script type="module" src="./main.ts"></script>
```

```ts
// main.ts
import { createSignal, h, mount } from "@getforma/core";

const [count, setCount] = createSignal(0);

mount(
  () =>
    h(
      "button",
      { onClick: () => setCount((c) => c + 1) },
      () => `Clicked ${count()} times`,
    ),
  "#app",
);
```

```bash
npx vite
```

**Any bundler works.** Vite, esbuild, tsup, webpack, Rollup — FormaJS ships standard ESM and CJS via `package.json` exports. No plugins, no special config.

---

## Coming from React?

If you know React, you already know ~80% of FormaJS. Components are functions. Props flow down. You import, export, and compose the same way. The difference is *how reactivity works* — and it's simpler.

React re-runs your entire component function on every state change, diffs a virtual DOM, and patches the real one. FormaJS runs each component **once**. Signals update only the specific DOM nodes that read them. No reconciliation, no stale closures, no `useCallback`.

| React | FormaJS | What changes |
|---|---|---|
| `useState` | `createSignal` | Same `[value, setter]` tuple |
| `useMemo` | `createComputed` | No dependency array — auto-tracks |
| `useEffect` | `createEffect` | No dependency array — auto-tracks |
| `useReducer` | `createReducer` | Same dispatch pattern |
| `useContext` | `createContext` / `inject` | Same provider pattern |
| `React.memo` | *Not needed* | Components already run once |
| Component functions | Same | `function Counter(props) { ... }` |
| Props | Same | `<Counter count={count} />` |
| Children | Same | Rest params or `props.children` |
| Import / export | Same | Standard ES modules |

**The mental model:** "I write components the same way, pass props the same way, compose the same way — but I never think about re-renders, dependency arrays, or memoization. Signals just work."

---

## Three Ways to Use FormaJS

All three share the same signal graph and reactive engine. Pick the one that fits your project — or mix them.

### 1. JSX

The most familiar path for React and Solid developers. JSX compiles to `h()` calls — it's syntactic sugar, not a different system.

Configure your bundler (TypeScript or Babel):

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  }
}
```

```tsx
import { createSignal, h, Fragment, mount } from "@getforma/core";

const [count, setCount] = createSignal(0);

function Counter() {
  return (
    <>
      <p>{() => `Count: ${count()}`}</p>
      <button onClick={() => setCount((c) => c + 1)}>+1</button>
    </>
  );
}

mount(() => <Counter />, "#app");
```

Under the hood, the JSX above compiles to the exact `h()` calls shown in the next section. There's no JSX-specific runtime — it's the same function.

### 2. Hyperscript — `h()`

No JSX transform needed. Same reactive behavior, explicit function calls.

```ts
import { createSignal, h, mount } from "@getforma/core";

const [count, setCount] = createSignal(0);

mount(
  () =>
    h(
      "button",
      { onClick: () => setCount((c) => c + 1) },
      () => `Clicked ${count()} times`,
    ),
  "#app",
);
```

See [The `h()` function](#the-h-function) below for the full signature and all call patterns.

### 3. HTML Runtime (no build step)

Drop a script tag, write `data-*` attributes. Zero config, zero tooling — works from a CDN.

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@latest/dist/formajs-runtime.global.js"></script>

<div data-forma-state='{ "count": 0 }'>
  <p data-text="{count}"></p>
  <button data-on:click="{count++}">+1</button>
  <button data-on:click="{count = 0}">Reset</button>
</div>
```

The expression parser is hand-written — no `eval()`, no `new Function()` by default. For strict CSP environments, use the hardened build:

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@latest/dist/formajs-runtime-hardened.global.js"></script>
```

<details>
<summary><strong>Full directive reference</strong></summary>

| Directive | Description | Example |
|---|---|---|
| `data-forma-state` | Declare reactive state (JSON) | `data-forma-state='{"count": 0}'` |
| `data-text` | Bind text content | `data-text="{count}"` |
| `data-show` | Toggle visibility (display) | `data-show="{isOpen}"` |
| `data-if` | Conditional render (add/remove DOM) | `data-if="{loggedIn}"` |
| `data-model` | Two-way binding (inputs) | `data-model="{email}"` |
| `data-on:event` | Event handler | `data-on:click="{count++}"` |
| `data-class:name` | Conditional CSS class | `data-class:active="{isActive}"` |
| `data-bind:attr` | Dynamic attribute | `data-bind:href="{url}"` |
| `data-list` | List rendering (keyed reconciliation) | `data-list="{items}"` |
| `data-computed` | Computed value | `data-computed="doubled = count * 2"` |
| `data-persist` | Persist state to localStorage | `data-persist="{count}"` |
| `data-fetch` | Fetch data from URL | `data-fetch="GET /api/items → items"` |
| `data-transition:*` | Enter/leave CSS transitions | `data-transition:enter="fade-in"` |
| `data-ref` | Register element for `$refs` access | `data-ref="myInput"` |
| `$el` | Current DOM element | `data-on:click="{$el.classList.toggle('active')}"` |
| `$dispatch` | Fire CustomEvent (bubbles, crosses Shadow DOM) | `data-on:click="{$dispatch('selected', {id})}"` |
| `$refs` | Named element references | `data-on:click="{$refs.myInput.focus()}"` |

</details>

---

## The `h()` Function

`h()` is the core of FormaJS rendering. Every component — whether written in JSX, hyperscript, or compiled from the HTML Runtime — resolves to `h()` calls that create real DOM elements.

### Signature

```ts
h(tag, props?, ...children)
```

| Parameter | Type | Description |
|---|---|---|
| `tag` | `string \| Function` | An HTML tag name (`'div'`, `'button'`) or a component function (`Counter`) |
| `props` | `object \| null` | Attributes, event handlers, and component props. Pass `null` or `{}` to skip. |
| `children` | `string \| number \| () => string \| Node \| Array` | Zero or more children — static text, reactive functions, elements, or arrays of any of these. |

### The key rule

**If a child is a function, it's reactive.** FormaJS wraps it in an effect so the DOM text node or subtree updates automatically when signals inside it change. If a child is a plain string or number, it's static — rendered once, never touched again.

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

// No props, just children
h("p", null, "Hello world")

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

---

## Why FormaJS?

Most UI libraries force a choice: simple but limited (Alpine, htmx), or powerful but heavy (React, Vue, Svelte). FormaJS gives you a single reactive core that scales from a CDN script tag to a compiled Rust SSR pipeline.

**Components run once.** No virtual DOM, no diffing, no reconciliation overhead. `h('div')` returns an actual `HTMLDivElement`. When a signal changes, only the specific text node or attribute that reads it updates — not the component, not the tree.

**Fine-grained reactivity.** Powered by [alien-signals](https://github.com/nicolo-ribaudo/alien-signals) 3.x. The signal graph tracks dependencies automatically. No dependency arrays, no stale closures, no `useCallback` / `useMemo` ceremony.

**Three entry points, one engine.** HTML Runtime (like Alpine — zero build step), `h()` hyperscript (like Preact), or JSX (like React/Solid). All share the same signal graph. Start with a CDN script tag, graduate to a full build pipeline without rewriting.

**Islands over SPAs.** `activateIslands()` hydrates independent regions of server-rendered HTML. Each island is self-contained with error isolation, deferred hydration triggers (`visible`, `idle`, `interaction`), and disposal for module swaps.

**CSP-safe.** The HTML Runtime includes a hand-written expression parser — no `eval()`, no `new Function()`. The hardened build locks it off entirely, with zero `new Function` in the dist (verified by dead code elimination).

**What FormaJS is not:** It's not a framework with opinions about routing, data fetching, or state management. It's a reactive DOM library. You bring the architecture.

---

## The Rust Compiler (Optional)

Everything above works without the Rust compiler. You can build a complete application with just `npm install @getforma/core` and a bundler. The compiler is an **optimization layer** — you add it when performance and deployment constraints demand it.

### What the compiler does

| Without compiler | With compiler |
|---|---|
| `h()` calls create DOM elements at runtime | `h()` calls are pre-compiled to `template()` + `cloneNode()` for faster initial render |
| SSR requires Node.js (`renderToString`) | SSR runs natively in Rust via the FMIR binary walker — no JS runtime on the server |
| Standard JS bundle shipped to the client | Components compile to FMIR (Forma Module IR), a compact binary format sent over the wire |
| Islands hydrate from HTML + JS | Islands hydrate from FMIR binary — smaller payload, faster parse |

### When to add it

You don't need the compiler to get started, prototype, or even ship to production. Add it when:

- **SSR without Node.js** — your backend is Rust/Axum and you don't want a Node.js sidecar just for rendering.
- **Faster initial render** — pre-compiled templates skip the `h()` → `createElement` path and go straight to `cloneNode()`.
- **Smaller payloads** — FMIR binary is more compact than the equivalent JavaScript for complex component trees.
- **The full Forma stack** — `@getforma/compiler` → FMIR → `forma-ir` (Rust parser) → `forma-server` (Axum SSR) gives you a complete pipeline at ~$18/month deployment cost.

### Architecture

```
TypeScript/JSX components
        ↓
  @getforma/compiler        (TS → FMIR binary)
        ↓
  forma-ir                  (Rust: parse + walk FMIR)
        ↓
  forma-server              (Rust/Axum: SSR + asset serving + CSP)
        ↓
  HTML response             (server-rendered, islands hydrate on client)
```

All entry points — JSX, `h()`, and the HTML Runtime — work both with and without the compiler:

|  | Without Compiler | With Compiler |
|---|---|---|
| HTML Runtime | `data-*` directives | + SSR from IR walker |
| `h()` hyperscript | `createSignal` + `h()` | + compiled templates |
| JSX | `createSignal` + JSX | + compiled templates + SSR |
| Islands | `activateIslands()` | + FMIR hydration |

---

## Core API

### Signals

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

**Custom equality** — skip updates when the value hasn't meaningfully changed:

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

### Conditional Rendering

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

### List Rendering

```ts
import { createSignal, createList, h } from "@getforma/core";

const [items, setItems] = createSignal([
  { id: 1, name: "Alice" },
  { id: 2, name: "Bob" },
]);

createList(
  items,
  (item) => item.id,
  (item) => h("li", null, item.name),
);
```

### Store (Deep Reactivity)

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

> **Note:** `Object.keys(state)`, `for...in`, and spread (`{...state}`) are NOT reactive. Use signals or explicit arrays for collections that need to react to membership changes.

### Components & Lifecycle

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

`onMount(fn)` runs after DOM creation. If `fn` returns a function, it registers as an unmount callback. `onUnmount(fn)` explicitly registers cleanup. Both feed the same cleanup queue:

```ts
// These are equivalent:
onMount(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});

onMount(() => {
  const id = setInterval(tick, 1000);
  onUnmount(() => clearInterval(id));
});
```

### Context (Dependency Injection)

```ts
import { createContext, provide, inject } from "@getforma/core";

const ThemeCtx = createContext("light");

provide(ThemeCtx, "dark");
const theme = inject(ThemeCtx); // "dark"
```

### Reducer

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

### History (Undo / Redo)

```ts
import { createHistory } from "@getforma/core";

const [state, setState, { undo, redo, canUndo, canRedo }] = createHistory({ text: "" });

setState({ text: "hello" });
setState({ text: "hello world" });

undo();     // state.text === "hello"
canUndo();  // true
redo();     // state.text === "hello world"
```

### Error Handling

`mount()` fails fast — if the selector doesn't match, it throws:

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

## Islands Architecture

Hydrate independent interactive regions of server-rendered HTML. Each island callback receives the root element and parsed props, then returns a component tree. The hydration system walks the tree against existing SSR DOM, attaching handlers and reactive bindings without recreating elements.

```ts
import { activateIslands, createSignal, h } from "@getforma/core";

activateIslands({
  Counter: (el, props) => {
    const [count, setCount] = createSignal(props?.initial ?? 0);

    el.classList.add("is-hydrated");

    return h("div", null,
      h("span", null, () => String(count())),
      h("button", { onClick: () => setCount((c) => c + 1) }, "+1"),
    );
  },
});
```

```html
<!-- Server-rendered HTML -->
<div data-forma-island="0" data-forma-component="Counter" data-forma-props='{"initial": 5}'>
  <span>5</span>
  <button>+1</button>
</div>
```

Each island runs in its own `createRoot` scope with error isolation — a broken island never takes down its siblings.

### Hydration Triggers

Control when an island hydrates via `data-forma-hydrate`:

| Trigger | When it hydrates | Use case |
|---|---|---|
| `load` (default) | Immediately on page load | Above-the-fold content |
| `visible` | When island enters viewport | Below-the-fold components |
| `idle` | During browser idle time | Non-critical functionality |
| `interaction` | On first `pointerdown` or `focusin` | Skeleton + skin pattern |

```html
<div data-forma-island="1" data-forma-component="Comments" data-forma-hydrate="visible">
  <!-- JS loads only when scrolled into view -->
</div>
```

### Island Disposal

When swapping content (e.g., inside `<forma-stage>` Shadow DOM), dispose islands to prevent leaked effects:

```ts
import { deactivateIsland, deactivateAllIslands } from "@getforma/core";

deactivateAllIslands(shadowRoot);
deactivateIsland(islandElement);
```

---

## CDN Builds

### Script tag (IIFE — auto-initializes)

```html
<!-- jsDelivr (recommended) -->
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@1.0.1/dist/formajs-runtime.global.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/@getforma/core@1.0.1/dist/formajs-runtime.global.js"></script>
```

### ESM import (modern browsers, no bundler)

```html
<script type="module">
  import { createSignal, h, mount } from "https://cdn.jsdelivr.net/npm/@getforma/core@1.0.1/dist/index.js";

  const [count, setCount] = createSignal(0);
  mount(() => h("button", { onClick: () => setCount((c) => c + 1) }, () => `${count()}`), "#app");
</script>
```

### All builds

| Build | Filename |
|---|---|
| Standard (recommended) | `formajs-runtime.global.js` |
| CSP-safe (no `new Function`) | `formajs-runtime-hardened.global.js` |
| Standard (short alias) | `forma-runtime.js` |
| CSP-safe (short alias) | `forma-runtime-csp.js` |

Available from `unpkg.com/@getforma/core@VERSION/dist/` and `cdn.jsdelivr.net/npm/@getforma/core@VERSION/dist/`.

---

## Subpath Exports

The main entry point (`@getforma/core`) has **zero network code** — no fetch, no WebSocket, no `process.env`. Network-capable modules are separate imports:

| Import | Description |
|---|---|
| `@getforma/core` | Signals, `h()`, mount, lists, stores, components, islands, events, DOM utils |
| `@getforma/core/http` | `createFetch`, `fetchJSON`, `createSSE`, `createWebSocket` |
| `@getforma/core/storage` | `createLocalStorage`, `createSessionStorage`, `createIndexedDB` |
| `@getforma/core/server` | `createAction`, `$$serverFunction`, `handleRPC`, `createRPCMiddleware` |
| `@getforma/core/runtime` | HTML Runtime — `initRuntime()`, `mount()`, `unmount()` |
| `@getforma/core/runtime-hardened` | Runtime with `new Function()` locked off (strict CSP) |
| `@getforma/core/ssr` | Server-side rendering — `renderToString()`, `renderToStream()` |
| `@getforma/core/tc39` | TC39-compatible `Signal.State` and `Signal.Computed` classes |

```ts
// Core — zero network code
import { createSignal, h, mount, createStore } from "@getforma/core";

// HTTP — only when needed
import { createFetch, createSSE } from "@getforma/core/http";

// Storage — only when needed
import { createLocalStorage } from "@getforma/core/storage";

// Server — only when needed
import { createAction, $$serverFunction } from "@getforma/core/server";
```

---

## How Is This Different from Solid?

FormaJS shares Solid's core insight — fine-grained signals updating the real DOM without a virtual DOM. If you know Solid, you'll feel at home.

The differences are in scope and delivery: FormaJS adds built-in islands hydration without a meta-framework, CSP compliance without a build step, three entry points (CDN, hyperscript, JSX) sharing one signal graph, and a Rust SSR path that eliminates Node.js from the server. Solid gives you a mature JavaScript ecosystem with routing, a meta-framework (SolidStart), devtools, and community component libraries.

**Choose FormaJS** when you want islands baked in, CSP safety out of the box, a Rust backend without a Node.js sidecar, or a CDN-first starting point that scales to a full compiled pipeline.

**Choose Solid** when you want a mature JS ecosystem, SolidStart for full-stack JS, community devtools, and your backend is already Node.js.

> FormaJS is the reactive layer of the [Forma stack](https://getforma.dev). The full pipeline compiles components to FMIR binary, renders them in Rust via `forma-ir`, and serves pages through `forma-server` — SSR without Node.js, binary IR over the wire, deployed for ~$18/month.

---

## Examples

See the [`examples/`](./examples) directory:

| Example | Description |
|---|---|
| **counter** | Minimal `h()` counter |
| **counter-jsx** | Same counter with JSX syntax |
| **csp** | CSP-safe runtime with strict `Content-Security-Policy` |
| **todo** | Todo list with `createList` and keyed reconciliation |
| **data-table** | Sortable table with `createList` |

---

## Stability

| Feature | Status | Notes |
|---|---|---|
| Signals (`createSignal`, `createEffect`, `createComputed`, `batch`) | **Stable** | Core primitive. Custom `equals` supported. |
| Reactive introspection (`isSignal`, `isComputed`, `trigger`, `getBatchDepth`) | **Stable** | alien-signals 3.x type guards |
| `h()` / JSX rendering | **Stable** | Function components supported |
| `mount()`, `createShow`, `createSwitch`, `createList` | **Stable** | |
| HTML Runtime (`data-*` directives) | **Stable** | CSP-safe expression parser |
| CSP-hardened runtime | **Stable** | Zero `new Function()` in dist |
| `createStore` (deep reactivity) | **Stable** | |
| Components (`defineComponent`, lifecycle) | **Stable** | |
| Context (`createContext`, `provide`, `inject`) | **Stable** | |
| Islands (`activateIslands`, disposal, triggers) | **Stable** | 10 activation + 88 hydration + 10 trigger tests |
| `createHistory` (undo/redo) | **Stable** | |
| `createReducer` | **Stable** | |
| `data-fetch`, `data-transition:*`, `data-ref` | **Stable** | |
| SSR (`renderToString`, `renderToStream`) | **Beta** | Functional, API may evolve |
| TC39 Signals compat (`Signal.State`, `Signal.Computed`) | **Beta** | Tracks an evolving TC39 proposal |

---

## Ecosystem

FormaJS is the reactive frontend layer of a full-stack Rust + TypeScript framework.

| Package | Language | Description |
|---|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | TypeScript | This library — reactive DOM, signals, islands, SSR hydration |
| [@getforma/compiler](https://github.com/getforma-dev/forma-tools) | TypeScript | TypeScript-to-FMIR compiler, Vite plugin, esbuild SSR plugin |
| [@getforma/build](https://github.com/getforma-dev/forma-tools) | TypeScript | esbuild pipeline with content hashing, compression, manifest |
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | TypeScript | `npx @getforma/create-app` — scaffold a new Forma project |
| [forma-ir](https://crates.io/crates/forma-ir) | Rust | FMIR binary format: parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Rust | Axum middleware for SSR, asset serving, CSP |

---

## License

MIT
