# FormaJS

[![CI](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getforma/core)](https://www.npmjs.com/package/@getforma/core)
[![Socket Badge](https://socket.dev/api/badge/npm/package/@getforma/core)](https://socket.dev/npm/package/@getforma/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals. No virtual DOM — signals update only the DOM nodes that changed. Components run once.

Gzipped sizes, measured by `npm run check:size` on the 1.5.0 build (that script walks the real ESM import graph, so shared chunks are weighed, and CI fails the build if any entry exceeds its limit):

| Artifact | Gzipped | CI limit |
|---|---|---|
| `@getforma/core` entry + every chunk it imports | 24.7 KB (25,262 B) | 30,000 B |
| CDN HTML runtime (`formajs-runtime.global.js`) | 25.6 KB (26,257 B) | 31,000 B |
| CDN browser ESM (`forma.esm.js`, inlines alien-signals) | 23.5 KB (24,030 B) | 29,000 B |

The core figure is **untree-shaken** — it is everything `dist/index.js` pulls in. A bundler that drops what your app does not import ships less.

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

> **Production:** Pin the version (e.g., `@getforma/core@1.5.0`) instead of `@latest`.

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

One `<script>` tag. One HTML file. No npm, no bundler, no `node_modules`, no config files. Just open it in a browser.

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@latest/dist/formajs-runtime.global.js"></script>

<div data-forma-state='{ "count": 0 }'>
  <p data-text="{count}"></p>
  <button data-on:click="{count++}">+1</button>
  <button data-on:click="{count = 0}">Reset</button>
</div>
```

That's a working reactive counter. No JavaScript file. No build step. Just HTML.

**Here's what you get from a single HTML file with one script tag:**

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@1.5.0/dist/formajs-runtime.global.js"></script>

<div data-forma-state='{
  "name": "",
  "qty": 1,
  "price": 12.5,
  "toppings": ["Mushroom", "Olive", "Basil"],
  "darkMode": false
}'>

  <!-- Two-way binding: type in the input, every binding below updates -->
  <input data-model="{name}" placeholder="Your name">
  <p data-text="`Order for ${name}`"></p>

  <!-- Computed value: derived from state, recomputed automatically -->
  <p data-computed="total = qty * price"
     data-text="`Total: $${total}`"></p>

  <!-- Event handling: increment, decrement, toggle -->
  <button data-on:click="{qty--}">-</button>
  <button data-on:click="{qty++}">+</button>

  <!-- Conditional rendering: show/hide based on state -->
  <p data-show="{qty >= 10}">Bulk discount applied.</p>

  <!-- List rendering: keyed reconciliation, only changed items re-render -->
  <ul data-list="{toppings}">
    <li>{item}</li>
  </ul>

  <!-- Dynamic classes and attributes -->
  <div data-class:dark="{darkMode}" data-bind:data-theme="{darkMode ? 'dark' : 'light'}">
    <button data-on:click="{darkMode = !darkMode}">Toggle theme</button>
    Theme is: <span data-text="{darkMode ? 'Dark' : 'Light'}"></span>
  </div>

  <!-- Persist to localStorage: survives page refresh -->
  <div data-persist="{darkMode}"></div>
</div>
```

That single HTML file gives you: reactive state, two-way data binding, computed values, conditional rendering, list rendering, event handling, dynamic CSS classes, dynamic attributes, and localStorage persistence. **No JavaScript written. No build tools installed.**

That block is not illustrative — the test below mounts this exact markup against the *hardened* build (the one with no `eval` fallback compiled in at all), asserts every binding renders and reacts, and fails if a single expression falls outside the CSP-safe grammar.

Verified by `src/__tests__/readme-examples.test.ts` > "runs on the hardened build with no unsupported expression or handler"
Verified by `src/__tests__/readme-examples.test.ts` > "renders every documented binding and updates them reactively"

### The expression grammar is a real constraint

The expression parser is hand-written: **no `eval()` and no `new Function()` in any build**, unless you opt in with `setUnsafeEval(true)` or `data-forma-unsafe-eval="true"` on the script tag. That is the whole point, and it has a price — the grammar is a subset of JavaScript.

**Value expressions** (`data-text`, `data-show`, `data-if`, `data-list`, `data-bind:*`, `data-class:*`, the right-hand side of `data-computed`) support: identifiers, `obj.a.b`, `obj?.a`, `obj['key']`, `arr[0]`, method calls **rooted at an identifier** whose arguments are themselves parseable (`name.trim()`, `tags.join(', ')`, `Math.round(x)`), `!x`, `? :`, `??`, `&&`, `||`, comparisons, `+ - * / %`, bare array literals, and template literals with `${…}` interpolation.

**Handler statements** (`data-on:*`) support: `x++`, `++x`, `x--`, `x = expr`, `x = !x`, `x += expr` (and `-=`, `*=`, `/=`), `if (cond) { … }` with optional `else`, `$refetch('id')`, and `;`-separated sequences of those. `$event` and `event` resolve inside them, so `q = $event.target.value` and `if (event.key === 'Enter') { … }` compile with no eval.

Verified by `src/__tests__/readme-examples.test.ts` > "accepts every value-expression form the grammar section lists"
Verified by `src/__tests__/readme-examples.test.ts` > "accepts every handler-statement form the grammar section lists"

**Not supported:** arrow functions and any other function literal — so `items.filter(i => i.includes(query))` has no CSP-safe translation. Have the server (or the endpoint behind `data-fetch`) return the already-filtered array. Also unsupported: object literals, and a handler that is *only* a method call — which is the shape of the `$el`, `$refs` and `$dispatch` examples in the directive table below (`$el.classList.toggle('active')`, `$refs.myInput.focus()`, `$dispatch('selected', id)`, `$event.preventDefault()`). Those need the opt-in fallback.

An expression outside the grammar is **not evaluated**. It logs a console warning, emits a `formajs:diagnostic` event, appears in `getDiagnostics()`, and marks its element `data-forma-expr-error="unsupported"` (handlers get `data-forma-handler-error="unsupported"`). It never silently renders a wrong value.

Verified by `src/__tests__/readme-examples.test.ts` > "the arrow-function showcase this replaced does NOT run — why it was changed"
Verified by `src/__tests__/readme-examples.test.ts` > "$event resolves in a handler on every build"
Verified by `src/__tests__/readme-examples.test.ts` > "a bare method-call statement is NOT in the CSP-safe grammar — the opt-in note is real"
Verified by `src/__tests__/runtime-csp-default.test.ts` > "never reaches new Function for an unparseable expression by default"

For a guarantee that comes from the artifact rather than from configuration, use the hardened build — it has the fallback removed at compile time, so no configuration can turn it on:

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@1.5.0/dist/formajs-runtime-hardened.global.js"></script>
```

Verified by `src/__tests__/runtime-csp-default.test.ts` > "a locked-off build cannot be talked into eval by any configuration"

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
| `data-fetch` | Fetch data from URL into a new state key | `data-fetch="GET /api/items → items"` |
| `data-fetch-id` | Name a `data-fetch` so `$refetch` can re-run it | `data-fetch-id="items"` |
| `data-transition:*` | Enter/leave CSS transitions | `data-transition:enter="fade-in"` |
| `data-ref` | Register element for `$refs` access | `data-ref="myInput"` |
| `$event` | The dispatched Event (also spelled `event`) | `data-on:input="{q = $event.target.value}"` |
| `$refetch` | Re-run a `data-fetch` by its `data-fetch-id` | `data-on:click="{$refetch('items')}"` |
| `$el` † | Current DOM element | `data-on:click="{$el.classList.toggle('active')}"` |
| `$dispatch` † | Fire CustomEvent (bubbles, crosses Shadow DOM) | `data-on:click="{$dispatch('selected', id)}"` |
| `$refs` † | Named element references | `data-on:click="{$refs.myInput.focus()}"` |

† These three examples are handlers whose whole body is a method call — a shape the CSP-safe parser does not accept (see the grammar section above). On the default build they are dropped with a `data-forma-handler-error="unsupported"` marker; they run only after `setUnsafeEval(true)` / `data-forma-unsafe-eval="true"`.

Verified by `src/__tests__/readme-examples.test.ts` > "a bare method-call statement is NOT in the CSP-safe grammar — the opt-in note is real"
Verified by `src/__tests__/readme-examples.test.ts` > "the same three examples do run once the fallback is opted in"
Verified by `src/__tests__/readme-examples.test.ts` > "data-fetch loads into a state key and $refetch re-runs it, both without eval"

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

**Fine-grained reactivity.** Powered by [alien-signals](https://github.com/johnsoncodehk/signals) 3.x. The signal graph tracks dependencies automatically. No dependency arrays, no stale closures, no `useCallback` / `useMemo` ceremony.

**Three entry points, one engine.** HTML Runtime (like Alpine — zero build step), `h()` hyperscript (like Preact), or JSX (like React/Solid). All share the same signal graph. Start with a CDN script tag, graduate to a full build pipeline without rewriting.

**Islands over SPAs.** `activateIslands()` hydrates independent regions of server-rendered HTML. Each island is self-contained with error isolation, deferred hydration triggers (`visible`, `idle`, `interaction`), and disposal for module swaps.

**CSP-safe.** The HTML Runtime includes a hand-written expression parser — no `eval()`, no `new Function()` by default, in any build, with an opt-in fallback for apps that want it. The hardened build removes the fallback at compile time so no configuration can enable it, and ships with zero `new Function` in the artifact — asserted by `scripts/verify-dist.mjs`, which greps the built files as the last step of `npm run build`.

Verified by `src/__tests__/runtime-csp-default.test.ts` > "every build ships with the new Function fallback disabled"
Verified by `src/__tests__/build-artifacts.test.ts` > "hardened builds emit no new Function at all"

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

> **Supported pattern — per-item dynamic attributes.** Inside a `createList` item body, an attribute value that is a bare member read of the item parameter (`src: item.art`, or `String(item.art)`) compiles to a *named* per-item dyn-attr slot: SSR emits the attribute from the injected data, and the client re-derives it per item. Any other computed expression (e.g. `item.art + "?w=300"`) compiles to an `attr:<key>` slot with **no SSR value**: the attribute renders empty on the server, and because adoption skips non-function props, adopted rows keep that empty attribute — it only resolves on client-rendered rows. If you need a per-item attribute visible in SSR output, use a bare member read or precompute the derived field server-side (e.g. inject `item.artUrl`).

> **Slot naming for server-side injection.** Slots are named after the binding that feeds them: a list bound to a signal `padTiles` becomes `list:padTiles:array`; a show bound to a condition `visible()` becomes `show:visible`. When the same binding feeds multiple slots, repeats get `#2`, `#3`, … suffixes in document order. Literal or computed sources with no single named binding fall back to derived or positional names. This is the `@getforma/compiler` naming contract — the authoritative reference lives in the `forma-tools` repo.

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

Static item fields (`src: item.art`) bake into the element when the row renders — the row is re-created when its key changes. Function props (`src: () => coverUrl()`) are reactive and update the attribute in place.

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

`createHistory` wraps a signal you already have. It takes the `[get, set]` tuple as its single source argument and returns a **controls object** — it is not a tuple and must not be destructured as one.

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

`createHistory(source, { maxLength })` caps the stack (default 100, minimum 1). The full controls object is `{ undo, redo, canUndo, canRedo, history, cursor, clear, destroy }`; `canUndo`/`canRedo`/`history`/`cursor` are reactive getters. Call `destroy()` to stop tracking the source and release the stack.

> **Limitation:** the source getter must return a stable value — a primitive or a stable object reference. A `createStore` slice that returns a *fresh proxy on every read* is not supported: the undo/redo echo guard compares by identity, so every undo would look like an external change and clear the redo stack.

Verified by `src/__tests__/readme-examples.test.ts` > "runs exactly as documented"

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

### Async — `createResource` and `createSuspense`

`createResource(source, fetcher, options?)` re-runs the fetcher whenever the source signal changes, aborting the previous request. The returned resource is callable for the data and carries `loading`, `error`, `refetch` and `mutate`.

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

`createSuspense(fallback, children)` shows `fallback` while any `createResource` created *inside* `children` is loading. The boundary is captured when the resource is created, so the resource must be constructed during the `children()` call.

```ts
createSuspense(
  () => h("p", null, "Loading…"),
  () => h(UserCard),
);
```

### SVG

`h()` creates HTML elements. Wrap a tree in `svg()` to create it in the SVG namespace instead — nested elements inherit the namespace for the duration of the callback.

```ts
import { svg, h } from "@getforma/core";

const icon = svg(() =>
  h("svg", { viewBox: "0 0 24 24", width: 24 },
    h("circle", { cx: 12, cy: 12, r: 10, fill: "currentColor" }),
  ),
);
```

### Portals

`createPortal(children, target?)` renders `children` into another element (default `document.body`) and returns a placeholder comment to keep in the tree. Disposal removes the portalled node.

```ts
import { createPortal, h } from "@getforma/core";

createPortal(() => h("div", { class: "modal" }, "Hi"), "#modal-root");
```

### Rest of the export surface

Everything the root entry exports, grouped. These are stable and typed; the sections above cover the ones with non-obvious semantics.

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

### Escape hatches — the trust boundary

FormaJS never builds markup from strings. `h()` creates elements with `document.createElement` and writes text with `textContent`, which is why the CSP tables below say `innerHTML` is not used for library-generated markup. Four APIs deliberately break that rule; **none of them sanitizes**, and all four are first-party-content-only sinks:

| Sink | Where | What it does |
|---|---|---|
| `dangerouslySetInnerHTML={{ __html }}` | prop on `h()` / JSX | assigns `innerHTML` on the element |
| `setHTMLUnsafe(el, html)` | `@getforma/core` | assigns `innerHTML` on the element |
| `reconcile(container, html)` | `@getforma/core/runtime` | parses an HTML string into a `<template>` and diffs it into the live page |
| `srcdoc` attribute | `h()` and SSR | the browser parses the *attribute value* as a document, so escaping does not neutralize it — emitted with a dev-mode warning |

Everything else is guarded: URL-bearing attributes (`href`, `src`, `action`, `formaction`, `xlink:href`, `poster`, `background`, `data`) drop `javascript:`, `vbscript:` and `data:text/html` values, and `on*` attribute names are dropped in any casing, on both the client and SSR paths.

Verified by `src/dom/__tests__/element-url-safety.test.ts` > "drops exactly what the SSR renderer drops, so hydration cannot re-add it"
Verified by `src/dom/__tests__/element-url-safety.test.ts` > "drops ONCLICK-cased string props instead of writing an inline handler"
Verified by `src/dom/__tests__/element-url-safety.test.ts` > "emits srcdoc but warns that escaping does not neutralize it"

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

Each island runs in its own `createRoot` scope with error isolation — a broken island never takes down its siblings, and a component that throws part-way through disposes whatever it had already created rather than leaving live effects behind.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "disposes effects created before a failing island threw"
Verified by `src/dom/__tests__/hydrate.test.ts` > "a binding that throws on a shared-signal update does not freeze the other island"

### SSR with Server Data

When the server renders an island with real data, the island's signals **must initialize from the `props` argument** — `createSignal(props?.x ?? fallback)` — never from a bare client-side default. That is why the Counter above seeds `createSignal(props?.initial ?? 0)` instead of `createSignal(0)`.

The reason is mechanical: adoption binds server-rendered text to your signals through effects, and an effect's first run **writes the current client signal value over the server-rendered text**. List adoption goes further — SSR rows whose keys are missing from the client array are **removed**. Seed a signal with an empty client default and the hydrated page silently erases the server's data on load.

In dev builds this mismatch is loud. Grep your console for these warnings:

```
[FormaJS] Hydration: list item key "…" not found in SSR — rendering fresh
[FormaJS] Hydration: removing extra SSR list item with key "…"
```

#### Getting props to the island

**Mode 1 — inline attribute** (small props, < 1KB). JSON in `data-forma-props` on the island root:

```html
<div data-forma-island="0" data-forma-component="Counter" data-forma-props='{"initial": 5}'>
  <span>5</span>
  <button>+1</button>
</div>
```

**Mode 2 — shared script block** (larger props, or many islands on one page). A single JSON block for the whole page, keyed by each island's id (the `data-forma-island` value) as a decimal string:

```html
<div data-forma-island="0" data-forma-component="TrackList">
  <!-- server-rendered rows -->
</div>

<script id="__forma_islands" type="application/json">
{"0": {"items": [{"id": 1, "name": "Track 1"}, {"id": 2, "name": "Track 2"}]}}
</script>
```

Because the block is `type="application/json"`, the browser treats it as inert data and never executes it — no `unsafe-inline` script needed, CSP-friendly. An island with an inline `data-forma-props` attribute ignores the script block. A malformed or truncated block degrades to "no shared props" instead of aborting hydration for the whole page.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "a malformed __forma_islands block does not stop islands from hydrating"

**Prop sanitization is shallow by default.** Both channels delete top-level `__proto__` / `constructor` / `prototype` keys before your island sees the props. Keys nested inside child objects **pass through** — that is a deliberate trade (a deep walk of every payload on every hydration is a cost no island should pay by default). If you hand props to anything that merges them into another object — `createStore`, a deep-merge helper, an `Object.assign` chain — sanitize them yourself:

```ts
import { activateIslands, sanitizePropsDeep } from "@getforma/core";

activateIslands({
  Cart: (el, props) => renderCart(el, sanitizePropsDeep(props)),
});
```

`sanitizePropsDeep` walks iteratively with a `WeakSet`, so neither deeply nested nor cyclic props can overflow the stack or loop. RPC arguments (`@getforma/core/server`) are stripped recursively **without** an opt-in — the two paths are not equivalent, and this is the difference.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "is opt-in: island activation still sanitizes only the top level"
Verified by `src/dom/__tests__/activate-isolation.test.ts` > "sanitizePropsDeep strips forbidden keys at every depth"
Verified by `src/server/__tests__/rpc-deep-strip.test.ts` > "strips forbidden keys at a depth that overflows a recursive walk"

#### Server-rendered lists

Server rows carry `data-forma-key` matching the `keyFn` output, wrapped in a `<!--f:l0-->` / `<!--/f:l0-->` marker pair that delimits the list region:

```html
<div data-forma-island="0" data-forma-component="TrackList">
  <ul>
    <!--f:l0-->
    <li data-forma-key="1">Track 1</li>
    <li data-forma-key="2">Track 2</li>
    <!--/f:l0-->
  </ul>
</div>

<script id="__forma_islands" type="application/json">
{"0": {"items": [{"id": 1, "name": "Track 1"}, {"id": 2, "name": "Track 2"}]}}
</script>
```

The client island seeds a signal from `props.items` and passes it to `createList`:

```ts
import { activateIslands, createSignal, createList, h } from "@getforma/core";

activateIslands({
  TrackList: (el, props) => {
    // Seed from server data — NOT createSignal([])
    const [items, setItems] = createSignal(props?.items ?? []);

    // Root must match the island root (<div data-forma-island="0">) —
    // a tag mismatch makes adoption bail and re-render fresh.
    return h("div", null,
      h("ul", null,
        createList(
          items,
          (item) => item.id,
          (item) => h("li", null, item.name),
        ),
      ),
    );
  },
});
```

Keys are compared as strings — `data-forma-key="1"` matches `(item) => item.id` for `id: 1`. Matched rows are adopted in place without re-rendering; unmatched client items render fresh, and unmatched SSR rows are removed (the two warnings above). If **no** row carries `data-forma-key`, adoption falls back to index-based matching — fine for lists that never reorder, but keyed rows survive reorders.

#### Server data flow

The server renders the HTML and emits the matching props (inline or script block) from the same data. On the client, `activateIslands` parses the props *before* your island callback runs; the callback seeds signals from them, and adoption then binds that already-correct state onto the existing DOM — when the first effects run, they write the same values the server rendered, so nothing visibly changes. Live updates after hydration (polling, websockets, user input) flow through the same signals — `setItems(fresh)` reconciles rows in place — zero clobber.

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

### Scoping to a subtree, and disposal

`activateIslands(registry, root?)` takes an optional root — pass a `ShadowRoot` or a container element to hydrate only the islands inside it. It defaults to `document`. When swapping content (e.g. inside a `<forma-stage>` Shadow DOM), dispose the old islands first or their effects leak:

```ts
import { activateIslands, deactivateIsland, deactivateAllIslands } from "@getforma/core";

activateIslands(registry, shadowRoot);   // hydrate one subtree
deactivateAllIslands(shadowRoot);        // tear the whole subtree down
deactivateIsland(islandElement);         // or one island
```

Both `root` parameters accept any `ParentNode`. A shared `__forma_islands` block in the main document is still found when activating a shadow subtree that has none of its own. An island removed as part of a `createList` row is deactivated automatically.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "activates islands inside a shadow root when one is passed as root"
Verified by `src/dom/__tests__/activate-isolation.test.ts` > "falls back to the document props block for a shadow subtree"
Verified by `src/dom/__tests__/list-disposal.test.ts` > "deactivates an island inside a removed row"

---

## CDN Builds

### Script tag (IIFE — auto-initializes)

```html
<!-- jsDelivr (recommended) -->
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@1.5.0/dist/formajs-runtime.global.js"></script>

<!-- unpkg -->
<script src="https://unpkg.com/@getforma/core@1.5.0/dist/formajs-runtime.global.js"></script>
```

### ESM import (modern browsers, no bundler)

Use `dist/forma.esm.js`. It is the only ESM artifact a browser can load directly: it is built as a single file with `alien-signals` inlined, so there are no bare specifiers and no code-split chunks for the browser to resolve. (`dist/index.js` is the npm entry — it code-splits and imports `"alien-signals"`, which a browser cannot resolve.)

```html
<script type="module">
  import { createSignal, h, mount } from "https://cdn.jsdelivr.net/npm/@getforma/core@1.5.0/dist/forma.esm.js";

  const [count, setCount] = createSignal(0);
  mount(() => h("button", { onClick: () => setCount((c) => c + 1) }, () => `${count()}`), "#app");
</script>
```

unpkg equivalent: `https://unpkg.com/@getforma/core@1.5.0/dist/forma.esm.js`

> **Do not mix `forma.esm.js` with the npm entry in one app.** It carries its own private copy of the reactive core, so signals, the owner tree and the island registry would be duplicated. The library detects this and warns: *"Duplicate @getforma/core instance detected"*.

### All builds

| Build | Filename |
|---|---|
| HTML Runtime, standard (recommended) | `formajs-runtime.global.js` |
| HTML Runtime, hardened — no `new Function` compiled in | `formajs-runtime-hardened.global.js` |
| HTML Runtime, standard (short alias) | `forma-runtime.js` |
| HTML Runtime, hardened (short alias) | `forma-runtime-csp.js` |
| Browser ESM — `h()` / signals / islands, no bundler | `forma.esm.js` |

Available from `unpkg.com/@getforma/core@VERSION/dist/` and `cdn.jsdelivr.net/npm/@getforma/core@VERSION/dist/`. These five are reached by URL only — none of them is behind an `exports` subpath, because the IIFE bundles are classic scripts that must not go through a module resolver.

Verified by `src/__tests__/docs-truth.test.ts` > "the All builds table lists exactly the CDN artifacts the build emits"
Verified by `src/__tests__/build-config.test.ts` > "builds a self-contained browser ESM bundle for the CDN recipe"

---

## Subpath Exports

The main entry point (`@getforma/core`) has **zero network code** — no fetch, no WebSocket, no `process.env`. Network-capable modules are separate imports:

| Import | Description |
|---|---|
| `@getforma/core` | Signals, `h()`, mount, lists, stores, components, islands, events, DOM utils |
| `@getforma/core/http` | `createFetch`, `fetchJSON`, `createSSE`, `createWebSocket` |
| `@getforma/core/storage` | `createLocalStorage`, `createSessionStorage`, `createIndexedDB` |
| `@getforma/core/server` | `createAction`, `$$serverFunction`, `handleRPC`, `createRPCMiddleware`, `setRPCGuard` |
| `@getforma/core/runtime` | HTML Runtime — `initRuntime()`, `mount()`, `unmount()`, `reconcile()`, `setUnsafeEval()`, `getDiagnostics()` |
| `@getforma/core/runtime-hardened` | Same API, with the `new Function` fallback removed at compile time (alias: `@getforma/core/runtime-csp`) |
| `@getforma/core/ssr` | Server-side rendering — `renderToString()`, `renderToStream()`, `sh()`, `shSuspense()`, `ssrSignal()`, `getSwapScript()` |
| `@getforma/core/wasm` | `renderLocal()`, `renderIsland()` — render via the Rust FMIR walker compiled to WASM |
| `@getforma/core/tc39` | TC39-shaped `State` and `Computed` classes |

`@getforma/core/tc39` exports the two classes **directly**. There is no `Signal` namespace object, so import them by name:

```ts
import { State, Computed } from "@getforma/core/tc39";

const count = new State(0);
const doubled = new Computed(() => count.get() * 2);
count.set(5);
doubled.get(); // 10
```

Verified by `src/__tests__/docs-truth.test.ts` > "the tc39 subpath exports State and Computed, not a Signal namespace"

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
| HTML Runtime (`data-*` directives) | **Stable** | CSP-safe expression parser; grammar is a documented subset |
| CSP-hardened runtime | **Stable** | No `new Function` in the artifact — asserted by `scripts/verify-dist.mjs` |
| `createStore` (deep reactivity) | **Stable** | |
| Components (`defineComponent`, lifecycle) | **Stable** | |
| Context (`createContext`, `provide`, `inject`) | **Stable** | |
| Islands (`activateIslands`, disposal, triggers) | **Stable** | 197 tests across 12 dedicated files |
| `createHistory` (undo/redo) | **Stable** | Takes a `[get, set]` tuple; returns a controls object |
| `createReducer` | **Stable** | |
| `createResource` / `createSuspense` | **Stable** | Abortable; Suspense boundary captured at resource creation |
| `createPortal`, `svg()`, `template()` | **Stable** | |
| `data-fetch`, `data-transition:*`, `data-ref` | **Stable** | |
| SSR (`renderToString`, `renderToStream`) | **Beta** | Functional, API may evolve |
| Streaming SSR under strict CSP | **Known gap** | Suspense swap scripts carry no `nonce` — see [CSP.md](./CSP.md) |
| TC39 Signals compat (`State`, `Computed`) | **Beta** | Tracks an evolving TC39 proposal |
| WASM render (`@getforma/core/wasm`) | **Experimental** | Needs `window.__FORMA_WASM__`; unreachable before 1.6.0 |

The island figure is the number of test cases in `activate`, `activate-isolation`, `activate-reactivate`, `activate-triggers`, `activate-visible`, `activate-visible-leak`, `deactivate`, `hydrate`, `hydrate-cleanup`, `list-hydration`, `multi-island-integration` and `shared-signals-across-islands` under `src/dom/__tests__/`.

Verified by `src/__tests__/docs-truth.test.ts` > "the island coverage figure matches the island test files"

---

## Part of the Forma Stack

### Frontend (TypeScript)

| Package | Description |
|---|---|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | **This library** — reactive DOM, signals, islands, SSR hydration |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | Vite plugin — h() optimization, server function transforms, FMIR emission |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | Production pipeline — esbuild bundling, content hashing, compression, manifest |

### Backend (Rust)

| Package | Description |
|---|---|
| [forma-ir](https://crates.io/crates/forma-ir) | FMIR binary format — parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Axum middleware — SSR page rendering, asset serving, CSP headers |

### Full Framework

| Package | Description |
|---|---|
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | `npx @getforma/create-app` — scaffolds a Rust server + TypeScript frontend project |

---

## License

MIT
