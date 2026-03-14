# FormaJS

[![CI](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getforma/core)](https://www.npmjs.com/package/@getforma/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals. No virtual DOM — `h()` creates real elements, signals update only what changed. ~15KB gzipped.

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

Supports: `data-text`, `data-show`, `data-if`, `data-model`, `data-on:event`, `data-class:name`, `data-bind:attr`, `data-list`, `data-computed`, `data-persist`, `data-fetch`. CSP-safe expression parser — no `eval()` by default.

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

If you use `@getforma/build`, JSX is preconfigured — just write `.tsx` files.

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
createSwitch(view, {
  home: () => h('div', null, 'Home'),
  settings: () => h('div', null, 'Settings'),
});
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

## Islands Architecture

For server-rendered HTML, activate independent interactive regions:

```typescript
import { activateIslands, createSignal, h } from '@getforma/core';

activateIslands({
  Counter: (el, props) => {
    const [count, setCount] = createSignal(props.initial ?? 0);
    // Hydrate: attach reactivity to existing server-rendered DOM
  },
});
```

```html
<!-- Server-rendered HTML -->
<div data-forma-island="Counter" data-forma-props='{"initial": 5}'>
  <span>5</span>
  <button>+1</button>
</div>
```

## Subpath Exports

| Import | Description |
|--------|-------------|
| `@getforma/core` | Signals, `h()`, `mount()`, lists, stores, components |
| `@getforma/core/runtime` | HTML Runtime — `initRuntime()`, `mount()`, `unmount()` |
| `@getforma/core/runtime-hardened` | Runtime with `new Function()` locked off (strict CSP) |
| `@getforma/core/ssr` | Server-side rendering — `renderToString()`, `renderToStream()` |
| `@getforma/core/tc39` | TC39-compatible `Signal.State` and `Signal.Computed` classes |

## Examples

See the [`examples/`](./examples) directory:

- **counter** — minimal `h()` counter
- **counter-jsx** — same counter with JSX syntax
- **todo** — todo list with `createList` and keyed reconciliation
- **data-table** — sortable table with `createList`

## Ecosystem

| Package | Description |
|---------|-------------|
| [@getforma/core](https://www.npmjs.com/package/@getforma/core) | This library |
| [@getforma/compiler](https://www.npmjs.com/package/@getforma/compiler) | SSR compiler — `.tsx` to FMIR binary |
| [@getforma/build](https://www.npmjs.com/package/@getforma/build) | esbuild wrapper with JSX + SSR preconfigured |
| [create-forma-app](https://www.npmjs.com/package/@getforma/create-app) | `npx @getforma/create-app` project scaffolder |
| [forma](https://github.com/getforma-dev/forma) | Rust server framework (forma-ir + forma-server) |

## License

MIT
