# FormaJS

[![CI](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getforma/core)](https://www.npmjs.com/package/@getforma/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals. No virtual DOM — `h()` creates real elements, signals update only what changed. ~15KB gzipped.

## Install

```bash
npm install @getforma/core
```

Or use the CDN (no build step required):

```html
<script src="https://unpkg.com/@getforma/core/dist/formajs-runtime.global.js"></script>
```

### Getting Started with a Bundler

After `npm install`, you need a bundler to resolve the ES module imports. Here's a minimal Vite setup:

```bash
npm install @getforma/core
npm install -D vite
```

```html
<!-- index.html -->
<div id="app"></div>
<script type="module" src="./main.ts"></script>
```

```typescript
// main.ts
import { createSignal, h, mount } from '@getforma/core';

const [count, setCount] = createSignal(0);

mount(() =>
  h('button', { onClick: () => setCount(count() + 1) },
    () => `Clicked ${count()} times`
  ),
  '#app'
);
```

```bash
npx vite
```

For **esbuild**, **tsup**, or other bundlers — no special config is needed. FormaJS ships standard ESM and CJS via `package.json` exports.

## Why FormaJS?

Most UI libraries make you choose: simple but limited (Alpine, htmx), or powerful but complex (React, Vue, Svelte). FormaJS gives you a single reactive core that scales from a CDN script tag to a full-stack Rust SSR pipeline.

**Design principles:**

- **Real DOM, not virtual DOM.** `h('div')` returns an actual `HTMLDivElement`. Signals mutate it directly. No diffing pass, no reconciliation overhead for simple updates. Inspired by [Solid](https://www.solidjs.com/).
- **Fine-grained reactivity.** Powered by [alien-signals](https://github.com/nicolo-ribaudo/alien-signals). When a signal changes, only the specific DOM text node or attribute that depends on it updates — not the whole component tree.
- **Three entry points, one engine.** HTML Runtime (like Alpine — zero build step), `h()` hyperscript (like Preact), or JSX. All share the same signal graph. Pick the right tool for the job, upgrade without rewriting.
- **CSP-safe capable.** The HTML Runtime includes a hand-written expression parser. The standard build enables `new Function()` as a fallback for complex expressions; the hardened build (`forma.hardened.js`) locks it off entirely for strict CSP environments.
- **Islands over SPAs.** `activateIslands()` hydrates independent regions of server-rendered HTML. Each island is self-contained. Ship less JavaScript, keep server-rendered content instant.

**What FormaJS is not:** It's not a framework with opinions about routing, data fetching, or state management patterns. It's a reactive DOM library. You bring the architecture.

## Three Ways to Use FormaJS

### 1. HTML Runtime (no build step)

Drop a script tag, write `data-*` attributes. Zero config, zero tooling.

```html
<script src="https://unpkg.com/@getforma/core/dist/formajs-runtime.global.js"></script>

<div data-forma-state='{"count": 0}'>
  <p data-text="{count}"></p>
  <button data-on:click="{count++}">+1</button>
  <button data-on:click="{count = 0}">Reset</button>
</div>
```

#### Supported Directives

| Directive | Description | Example |
|-----------|-------------|---------|
| `data-forma-state` | Declare reactive state (JSON) | `data-forma-state='{"count": 0}'` |
| `data-text` | Bind text content | `data-text="{count}"` |
| `data-show` | Toggle visibility (display) | `data-show="{isOpen}"` |
| `data-if` | Conditional render (add/remove from DOM) | `data-if="{loggedIn}"` |
| `data-model` | Two-way binding (inputs) | `data-model="{email}"` |
| `data-on:event` | Event handler | `data-on:click="{count++}"` |
| `data-class:name` | Conditional CSS class | `data-class:active="{isActive}"` |
| `data-bind:attr` | Dynamic attribute | `data-bind:href="{url}"` |
| `data-list` | List rendering with keyed reconciliation | `data-list="{items}"` |
| `data-computed` | Computed value | `data-computed="doubled = count * 2"` |
| `data-persist` | Persist state to localStorage | `data-persist="{count}"` |
| `data-fetch` | Fetch data from URL | `data-fetch="GET /api/items → items"` |
| `data-transition:*` | Enter/leave CSS transitions | `data-transition:enter="fade-in"` |

CSP-safe expression parser — no `eval()` or `new Function()` by default. For strict CSP environments, use the hardened build:

```html
<script src="https://unpkg.com/@getforma/core/dist/formajs-runtime-hardened.global.js"></script>
```

### 2. Hyperscript — `h()`

```bash
npm install @getforma/core
```

```typescript
import { createSignal, h, mount } from '@getforma/core';

const [count, setCount] = createSignal(0);

mount(() =>
  h('button', { onClick: () => setCount(count() + 1) },
    () => `Clicked ${count()} times`
  ),
  '#app'
);
```

### 3. JSX

Same `h()` function, JSX syntax. Configure your bundler:

```json
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
import { createSignal, h, Fragment, mount } from '@getforma/core';

const [count, setCount] = createSignal(0);

function Counter() {
  return (
    <>
      <p>{() => `Count: ${count()}`}</p>
      <button onClick={() => setCount(count() + 1)}>+1</button>
    </>
  );
}

mount(() => <Counter />, '#app');
```

## CDN Usage

Both long and short filenames are provided. They are identical files — use whichever you prefer:

| Build | URL |
|-------|-----|
| **Standard** (recommended) | `unpkg.com/@getforma/core/dist/formajs-runtime.global.js` |
| Standard (short alias) | `unpkg.com/@getforma/core/dist/forma-runtime.js` |
| **CSP-safe** (no `new Function`) | `unpkg.com/@getforma/core/dist/formajs-runtime-hardened.global.js` |
| CSP-safe (short alias) | `unpkg.com/@getforma/core/dist/forma-runtime-csp.js` |

> The CSP build uses a hand-written expression parser and never calls `new Function`.
> It supports most common patterns. See [examples/csp](./examples/csp) for a working demo.

## Core API

### Signals

```typescript
import { createSignal, createEffect, createComputed, batch } from '@getforma/core';

const [count, setCount] = createSignal(0);
const doubled = createComputed(() => count() * 2);

createEffect(() => console.log('count:', count()));

batch(() => {
  setCount(1);
  setCount(2); // effect fires once with value 2
});
```

### Conditional Rendering

```typescript
import { createSignal, createShow, createSwitch, h } from '@getforma/core';

const [loggedIn, setLoggedIn] = createSignal(false);

// createShow — toggle between two branches
createShow(loggedIn,
  () => h('p', null, 'Welcome back'),
  () => h('p', null, 'Please sign in'),
);

// createSwitch — multi-branch with caching
const [view, setView] = createSignal('home');
createSwitch(view, [
  { match: 'home', render: () => h('div', null, 'Home') },
  { match: 'settings', render: () => h('div', null, 'Settings') },
], () => h('div', null, '404 Not Found'));
```

### List Rendering

```typescript
import { createSignal, createList, h } from '@getforma/core';

const [items, setItems] = createSignal([
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
]);

createList(
  items,
  (item) => item.id,  // key function
  (item) => h('li', null, item.name),
);
```

### Store (deep reactivity)

```typescript
import { createStore } from '@getforma/core';

const [state, setState] = createStore({
  user: { name: 'Alice', prefs: { theme: 'dark' } },
  items: [1, 2, 3],
});

// Read reactively
state.user.name;        // 'Alice'

// Mutate — only affected subscribers update
setState('user', 'name', 'Bob');
setState('items', items => [...items, 4]);
```

### Components

```typescript
import { defineComponent, onMount, onUnmount, h } from '@getforma/core';

const Timer = defineComponent(() => {
  const [seconds, setSeconds] = createSignal(0);

  onMount(() => {
    const id = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(id); // cleanup on unmount
  });

  return h('span', null, () => `${seconds()}s`);
});

document.body.appendChild(Timer());
```

#### Lifecycle: `onMount` vs `onUnmount`

- **`onMount(fn)`** — runs after the component's DOM is created. If `fn` returns a function, that function is automatically registered as an unmount callback.
- **`onUnmount(fn)`** — explicitly registers a cleanup function that runs when the component is disposed.

Both mechanisms feed into the same cleanup queue — the `onMount` return shorthand is convenience for the common pattern of setting up and tearing down in one place:

```typescript
// These are equivalent:
onMount(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});

// vs.
onMount(() => {
  const id = setInterval(tick, 1000);
  onUnmount(() => clearInterval(id));
});
```

### Error Handling

**`mount()` fails fast.** If the container selector doesn't match any element, it throws:

```typescript
mount(() => h('p', null, 'hello'), '#nonexistent');
// Error: mount: container not found — "#nonexistent"
```

**Global error handler.** Register a handler for errors in effects and lifecycle callbacks:

```typescript
import { onError } from '@getforma/core';

onError((error, info) => {
  console.error(`[${info?.source}]`, error);
});
```

**Error boundaries.** Catch rendering errors and display fallback UI with a retry option:

```typescript
import { createErrorBoundary, h } from '@getforma/core';

createErrorBoundary(
  () => h(UnstableComponent),
  (error, retry) => h('div', null,
    h('p', null, `Something went wrong: ${error.message}`),
    h('button', { onClick: retry }, 'Retry'),
  ),
);
```

### Context (Dependency Injection)

```typescript
import { createContext, provide, inject } from '@getforma/core';

const ThemeCtx = createContext('light');

provide(ThemeCtx, 'dark');
const theme = inject(ThemeCtx); // 'dark'
```

## Islands Architecture

For server-rendered HTML, activate independent interactive regions. Each island callback receives the root DOM element and parsed props, then returns a component tree — the same `h()` calls you'd use for client-side rendering. The hydration system walks the descriptor tree against the existing SSR DOM, attaching event handlers and reactive bindings without recreating elements.

```typescript
import { activateIslands, createSignal, h } from '@getforma/core';

activateIslands({
  Counter: (el, props) => {
    const [count, setCount] = createSignal(props?.initial ?? 0);

    // el is the island's root HTMLElement — useful for layout measurement,
    // focus management, CSS classes, or reading extra data-* attributes.
    el.classList.add('is-hydrated');

    // Return the same tree shape as the SSR output.
    // Hydration matches this against existing DOM — no elements are created.
    return h('div', null,
      h('span', null, () => String(count())),
      h('button', { onClick: () => setCount(c => c + 1) }, '+1'),
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

Each island is activated inside its own `createRoot` scope with error isolation — a broken island never takes down its siblings.

## Subpath Exports

| Import | Description |
|--------|-------------|
| `@getforma/core` | Signals, `h()`, `mount()`, lists, stores, components |
| `@getforma/core/runtime` | HTML Runtime — `initRuntime()`, `mount()`, `unmount()` |
| `@getforma/core/runtime/global` | HTML Runtime global build (IIFE, for `<script>` tags) |
| `@getforma/core/runtime-hardened` | Runtime with `new Function()` locked off (strict CSP) |
| `@getforma/core/runtime-csp` | Alias for `runtime-hardened` (CSP-safe build) |
| `@getforma/core/runtime-csp/global` | CSP-safe global build (IIFE, for `<script>` tags) |
| `@getforma/core/ssr` | Server-side rendering — `renderToString()`, `renderToStream()` |
| `@getforma/core/tc39` | TC39-compatible `Signal.State` and `Signal.Computed` classes |

## Examples

See the [`examples/`](./examples) directory:

- **counter** — minimal `h()` counter
- **counter-jsx** — same counter with JSX syntax
- **csp** — CSP-safe runtime with strict Content-Security-Policy meta tag
- **todo** — todo list with `createList` and keyed reconciliation
- **data-table** — sortable table with `createList`

## How Is This Different from Solid?

FormaJS shares Solid's core insight — fine-grained signals updating the real DOM without a virtual DOM. If you know Solid, you'll feel at home. The differences are in scope and delivery:

| | Solid | FormaJS |
|-|-------|---------|
| **Build requirement** | Always needs a compiler (JSX transform) | CDN runtime works with zero build step; bundler is optional |
| **Entry points** | JSX-first | HTML Runtime (`data-*` attributes), `h()` hyperscript, or JSX |
| **CSP** | Relies on compiler output | Hand-written expression parser; hardened build has no `new Function()` |
| **Islands** | Via [solid-start](https://start.solidjs.com/) meta-framework | Built-in `activateIslands()` — no meta-framework needed |
| **Ecosystem** | Mature (router, meta-framework, devtools) | Minimal — reactive core only, you bring the architecture |
| **Size** | ~7KB | ~15KB (includes runtime parser, stores, SSR) |

**When to choose FormaJS:** You want to progressively enhance server-rendered HTML, need CSP compliance without a build step, or prefer a single library that scales from a `<script>` tag to a full SSR pipeline.

**When to choose Solid:** You want a mature ecosystem with routing, SSR meta-framework, and community-built component libraries.

## Stability

FormaJS is at **v0.3.x**. Some features are more battle-tested than others:

| Feature | Status | Notes |
|---------|--------|-------|
| Signals (`createSignal`, `createEffect`, `createComputed`, `batch`) | **Stable** | Core primitive, well-tested |
| `h()` / JSX rendering | **Stable** | |
| `mount()`, `createShow`, `createSwitch`, `createList` | **Stable** | |
| HTML Runtime (`data-*` directives) | **Stable** | Expression parser covers common patterns |
| CSP-hardened runtime | **Stable** | No `new Function()`, tested with strict CSP headers |
| `createStore` (deep reactivity) | **Stable** | |
| Components (`defineComponent`, lifecycle) | **Stable** | |
| Context (`createContext`, `provide`, `inject`) | **Stable** | |
| Islands (`activateIslands`) | **Stable** | 10 activation + 88 hydration tests |
| SSR (`renderToString`, `renderToStream`) | **Beta** | Functional, API may evolve |
| TC39 Signals compat (`Signal.State`, `Signal.Computed`) | **Beta** | 9 tests, but tracks an evolving TC39 proposal |

## Ecosystem

FormaJS is the reactive frontend layer of a full-stack Rust + TypeScript framework. The pipeline flows: TypeScript components → `@getforma/compiler` → FMIR binary → `forma-ir` (parse) → `forma-server` (render) → Axum HTTP response.

| Package | Language | Description |
|---------|----------|-------------|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | TypeScript | This library — reactive DOM, signals, islands, SSR hydration |
| [@getforma/compiler](https://github.com/getforma-dev/forma-tools) | TypeScript | TypeScript-to-FMIR compiler, Vite plugin, esbuild SSR plugin |
| [@getforma/build](https://github.com/getforma-dev/forma-tools) | TypeScript | esbuild pipeline with content hashing, compression, manifest |
| [@getforma/create-app](https://github.com/getforma-dev/create-forma-app) | TypeScript | `npx @getforma/create-app` — scaffold a new Forma project |
| [forma-ir](https://crates.io/crates/forma-ir) | Rust | FMIR binary format: parser, walker, WASM exports |
| [forma-server](https://crates.io/crates/forma-server) | Rust | Axum middleware for SSR page rendering, asset serving, CSP |

## License

MIT
