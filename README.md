# FormaJS

[![CI](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getforma/core)](https://www.npmjs.com/package/@getforma/core)
[![Socket Badge](https://socket.dev/api/badge/npm/package/@getforma/core)](https://socket.dev/npm/package/@getforma/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals. No virtual DOM — signals update only the DOM nodes that changed. Components run once.

Gzipped sizes, measured by `npm run check:size` on the 1.5.0 build (that script walks the real ESM import graph, so shared chunks are weighed, and CI fails the build if any entry exceeds its limit):

| Artifact | Gzipped | CI limit |
|---|---|---|
| `@getforma/core` entry + every chunk it imports | 24.8 KB (25,394 B) | 30,000 B |
| CDN HTML runtime (`formajs-runtime.global.js`) | 31.0 KB (31,763 B) | 34,000 B |
| CDN HTML runtime, hardened (`formajs-runtime-hardened.global.js`) | 30.0 KB (30,764 B) | 33,000 B |
| CDN browser ESM (`forma.esm.js`, inlines alien-signals) | 23.6 KB (24,171 B) | 29,000 B |

The core figure is **untree-shaken** — it is everything `dist/index.js` pulls in. A bundler that drops what your app does not import ships less.

The two HTML-runtime figures grew by 5.6 and 6.2 KB when the regex expression parser and the `new Function` fallback were replaced with the allowlist AST interpreter described below. That is the price of the CSP guarantee, stated rather than smoothed: the engine that makes it true is ~12 KB gzipped, and what it replaced was ~6 KB. The core entry and the browser ESM bundle carry no HTML runtime and did not move (+81 B and +82 B).

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
  "query": "",
  "items": ["Apples", "Bananas", "Cherries", "Dates", "Elderberries"],
  "darkMode": false
}'>

  <!-- Two-way binding: type in the input, the list filters instantly -->
  <input data-model="{query}" placeholder="Search fruits...">

  <!-- Computed value: derived from query, updates automatically -->
  <p data-computed="matchCount = items.filter(i => i.toLowerCase().includes(query.toLowerCase())).length"
     data-text="{'Found ' + matchCount + ' results'}"></p>

  <!-- Conditional rendering: show/hide based on state -->
  <p data-show="{query.length > 0 && matchCount === 0}">No matches found.</p>

  <!-- List rendering: keyed reconciliation, only changed items re-render -->
  <ul data-list="{items.filter(i => i.toLowerCase().includes(query.toLowerCase()))}">
    <li>{item}</li>
  </ul>

  <!-- Event handling: mutate state directly from the markup -->
  <button data-on:click="{darkMode = !darkMode}">
    Toggle Dark Mode
  </button>

  <!-- Dynamic classes and attributes -->
  <div data-class:dark="{darkMode}" data-bind:data-theme="{darkMode ? 'dark' : 'light'}">
    Theme is: <span data-text="{darkMode ? 'Dark' : 'Light'}"></span>
  </div>

  <!-- Persist to localStorage: survives page refresh -->
  <div data-persist="{darkMode}"></div>
</div>
```

That single HTML file gives you: reactive state, two-way data binding, computed values, conditional rendering, list rendering with filtering, event handling, dynamic CSS classes, dynamic attributes, and localStorage persistence. **No JavaScript written. No build tools installed.**

That block is not illustrative. The test below **extracts it from this file at test time**, mounts it, and asserts the documented behaviour — the count text, the five rendered rows, that typing filters them, that `data-show` and `data-bind` react — and that `getDiagnostics()` is empty. Editing the block into something the grammar does not accept fails the suite; so does deleting it.

The same markup is served in Playwright under a real `Content-Security-Policy: script-src 'self'` response header, with the browser's own console watched for violations. No `unsafe-eval`, in any build.

Verified by `src/__tests__/readme-flagship.test.ts` > "the README block renders exactly what the README says it renders"
Verified by `src/__tests__/readme-flagship.test.ts` > "typing in the data-model input filters the list and the count"
Verified by `src/__tests__/readme-flagship.test.ts` > "binds every directive in the block with zero diagnostics"

### The expression grammar is an allowlist, not a blocklist

Expressions are evaluated by an **allowlist AST interpreter** — lexer, precedence-climbing parser, validator, tree-walking interpreter — in every build. There is no `eval()`, no `new Function()` and no switch that could reach one, in any shipped artifact. This is not "eval with dangerous names filtered out"; it is a different language:

- **Identifier resolution never consults `globalThis`.** `document`, `fetch`, `window`, `localStorage` and `process` are not blocked — there is no lookup that could find them. Only arrow parameters, list-row locals, element magics, your declared state, and one frozen table of captured intrinsics resolve.
- **A method is never obtained by reading a property of its receiver.** `items.filter(…)` invokes the `Array.prototype.filter` this library captured at module init, via `Reflect.apply`. A state object carrying its own `filter` never contributes it, and another script poisoning `Array.prototype.filter` later cannot change what runs.
- **`constructor`, `__proto__`, `prototype`, `call`, `apply` and `bind` are denied at runtime on the *evaluated* key**, so `items.constructor`, `items['constructor']`, `items[k]` where server JSON supplied `k = "constructor"`, `items['cons' + 'tructor']` and `items[String.fromCharCode(…)]` are all the same case, and all dead.
- **No loops, no recursion, no function values that escape their callback slot.** The language is *total*: every expression terminates by construction. Budgets bound cost, not hanging.

**Value expressions** (`data-text`, `data-show`, `data-if`, `data-list`, `data-bind:*`, `data-class:*`, the right-hand side of `data-computed`) support: identifiers, `obj.a.b`, `obj?.a`, `obj['key']`, `arr[i + 1]`, allowlisted method calls (`name.trim()`, `tags.join(', ')`, `Math.round(x)`, `JSON.stringify(o)`, `Object.keys(o)`), **arrow-function callbacks** in `map` / `filter` / `find` / `findIndex` / `some` / `every` / `flatMap` / `reduce` / `sort`, `typeof x`, `!x`, unary `-x`, `? :`, `??`, `&&`, `||`, comparisons, `+ - * / %`, array literals, object literals, and template literals with `${…}` interpolation.

**Handler statements** (`data-on:*`) support everything above plus: `x++`, `++x`, `x--`, `x = expr`, `x += expr` (and `-=`, `*=`, `/=`), the same on a property path (`item.done = !item.done`, `obj.n += 1`, `$el.style.color = 'red'`), bare method-call statements (`$el.classList.toggle('active')`, `$refs.myInput.focus()`, `$dispatch('selected', {id})`), `if (cond) { … }` with optional `else`, and `;`-separated sequences of those. `$event` and `event` resolve inside them, gated by an allowlist, so `q = $event.target.value` and `if (event.key === 'Enter') { … }` run with no eval.

One caveat on property-path writes, because it is a reactivity boundary rather than a grammar one: `item.done = !item.done` **mutates in place**. The signal still holds the same object, so bindings that read it do not re-run — exactly what `data-model` already does for a member path. Reassign the root key when you need the DOM to follow: `item = { done: !item.done }`.

Verified by `src/__tests__/readme-directive-table.test.ts` > "every Example cell in the directive table parses clean"
Verified by `src/__tests__/readme-examples.test.ts` > "accepts every handler-statement form the grammar section lists"
Verified by `src/expr/__tests__/handler-grammar.test.ts` > "a handler statement may be a bare method call"
Verified by `src/expr/__tests__/adversarial.test.ts` > "no global is reachable by name"
Verified by `src/expr/__tests__/adversarial.test.ts` > "every spelling of a constructor reach is denied"

**Permanently unsupported**, because these are the properties that make it safe: statements inside expressions; `while` / `for` / `do`; `async` / `await`; named functions or arrows used as values (an arrow is legal *only* as the callback argument of one of the nine methods above); bare calls `f(x)` where `f` is a value held in state; `.call` / `.apply` / `.bind`; dynamic method lookup; `new`; `delete`; `in`; `instanceof`; regex literals; `this`; `\u` / `\x` / octal string escapes; destructuring; spread; and any global that is not a key in the frozen table. A request to support X is answered by adding X to a table, never by widening dispatch — see [CONTRIBUTING.md](./CONTRIBUTING.md).

An expression outside the grammar is **not evaluated, and it says so**. It logs a `console.error` naming the offending token and column, emits a `formajs:diagnostic` event, appears in `getDiagnostics()` with a stable code (`FORMA_E_METHOD_DENIED`, `FORMA_E_UNRESOLVED`, …), and marks its element `data-forma-expr-error="unsupported"` (handlers get `data-forma-handler-error="unsupported"`). The binding leaves whatever the DOM already had — it never writes the string `undefined`, and it never leaves the rest of the page unbound.

Verified by `src/__tests__/failure-semantics.test.ts` > "a denied expression leaves the previous text in place and never renders undefined"
Verified by `src/__tests__/failure-semantics.test.ts` > "reports one diagnostic per distinct expression, however many elements share it"
Verified by `src/__tests__/failure-semantics.test.ts` > "a denied binding does not stop its siblings from binding"

Every build is equally eval-free, so the "hardened" URL is now only a second, tree-shaken bundling of the same runtime:

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@1.5.0/dist/formajs-runtime-hardened.global.js"></script>
```

Verified by `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"
Verified by `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"

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
| `$el` | Current DOM element (allowlisted properties only) | `data-on:click="{$el.classList.toggle('active')}"` |
| `$dispatch` | Fire CustomEvent (bubbles, crosses Shadow DOM) | `data-on:click="{$dispatch('selected', {id})}"` |
| `$refs` | Named element references | `data-on:click="{$refs.myInput.focus()}"` |

Every `Example` cell above is extracted from this table by the test suite and mounted. All 20 rows bind with no diagnostic — including the last three, which needed the eval fallback until the allowlist interpreter landed.

`$el`, `$event` and `$refs` hand expressions a **wrapped** element, not the real node: reads are restricted to a fixed property list, so `$el.ownerDocument`, `$el.parentNode`, `$el.innerHTML` and `$refs.myInput.ownerDocument.location.href` are denied with a diagnostic rather than answered.

Verified by `src/__tests__/readme-directive-table.test.ts` > "every Example cell in the directive table parses clean"
Verified by `src/__tests__/readme-directive-table.test.ts` > "the three magic-variable rows actually do what the table says"
Verified by `src/expr/__tests__/adversarial.test.ts` > "$refs.r.ownerDocument.location.href is denied"

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

**CSP-safe.** The HTML Runtime evaluates expressions with an allowlist AST interpreter. **Zero `eval()`, zero `new Function()`, zero `with()` in every shipped artifact** — there is no opt-in fallback to leave switched on by mistake, because the fallback was deleted. The flagship example above, arrow-function callback and all, runs under `Content-Security-Policy: script-src 'self'`. Asserted by `scripts/verify-dist.mjs`, which greps the built files as the last step of `npm run build`, and by a Playwright spec that serves the fixture under a real CSP header and watches the browser console for violations.

Verified by `src/__tests__/runtime-csp-default.test.ts` > "no build can reach new Function, with any configuration"
Verified by `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

**What FormaJS is not:** It's not a framework with opinions about routing, data fetching, or state management. It's a reactive DOM library. You bring the architecture.

### Measured, not asserted

`npm run bench` runs the hot-path benchmark suite in `bench/`; the numbers below and the full table live in [docs/PERFORMANCE.md](docs/PERFORMANCE.md), with the run-to-run noise floor next to every row so a later comparison can tell a regression from a bad afternoon. They are happy-dom figures — good for comparing FormaJS against FormaJS, not against a browser.

- **A write that changes nothing does nothing.** An equal-value write never reaches an effect and costs one to two orders of magnitude less than a write that does change (72 ns).
  Benchmarked by: bench/reactive.bench.ts > "write a CHANGING value, effect runs (×500)"
- **`batch()` collapses repeated writes to one flush** — 100 writes to one signal go from 237 µs to 19 µs, 12×. It does nothing for writes to 100 *different* signals, which is the correct result.
  Benchmarked by: bench/reactive.bench.ts > "one signal, 100 writes, batched (×30)"
- **A keyed list update that changes no keys and no order is 27× cheaper** than the same 1000 rows reordered (97 µs vs 2.6 ms).
  Benchmarked by: bench/list.bench.ts > "same keys, same order — reconciler fast path"
- **Hydration beats client rendering.** Adopting 1000 server-rendered keyed rows costs 2.4× less than building the same list client-side, with the HTML parse subtracted from both sides.
  Benchmarked by: bench/hydrate.bench.ts > "1000 rows: parse + adopt by data-forma-key"
- **The CSP-safe interpreter is faster than the `eval` path it replaced** — 53 ns per expression evaluation against 126 ns for `new Function` + `with` + a scope Proxy, and it needs no `unsafe-eval` in your CSP.
  Benchmarked by: bench/expression.bench.ts > "8 count-dependent expressions: write → evaluate → text (×20)"

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
| HTML Runtime, hardened — same runtime, tree-shaken, no code splitting | `formajs-runtime-hardened.global.js` |
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
| `@getforma/core/runtime` | HTML Runtime — `initRuntime()`, `mount()`, `unmount()`, `reconcile()`, `getDiagnostics()` |
| `@getforma/core/runtime-hardened` | The same runtime, bundled without code splitting (alias: `@getforma/core/runtime-csp`) |
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
| HTML Runtime (`data-*` directives) | **Stable** | Allowlist AST interpreter; grammar is a documented subset |
| CSP-hardened runtime | **Stable** | No `new Function` in *any* artifact — asserted by `scripts/verify-dist.mjs` |
| `createStore` (deep reactivity) | **Stable** | |
| Components (`defineComponent`, lifecycle) | **Stable** | |
| Context (`createContext`, `provide`, `inject`) | **Stable** | |
| Islands (`activateIslands`, disposal, triggers) | **Stable** | 198 tests across 12 dedicated files |
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
