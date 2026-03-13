# FormaJS

Signals-based reactive framework for the real DOM. Fine-grained reactivity, zero VDOM.

FormaJS has two APIs:

1. **HTML Runtime** — Declarative `data-*` attributes for interactive HTML pages. Drop in a `<script>` tag and add reactivity with zero build step. Similar to Alpine.js but backed by true signals (alien-signals).
2. **Programmatic API** — TypeScript modules for building web apps with `createSignal`, `h()`, components, stores, SSR, and more.

## Documentation Hub

- [What Is FormaJS?](./docs/WHAT_IS_FORMAJS.md)
- [Production Guide](./docs/PRODUCTION.md)
- [Build and Release Guide](./docs/BUILD_AND_RELEASE.md)
- [Patterns Cookbook](./docs/PATTERNS.md)

---

## Quick Start — HTML Runtime

Include the runtime script and use `data-*` attributes. No build step required.

```html
<script src="https://unpkg.com/formajs/dist/formajs-runtime.global.js"></script>

<div data-forma-state='{"count": 0}'>
  <p>Count: <span data-text="{count}"></span></p>
  <button data-on:click="{count++}">Increment</button>
  <button data-on:click="{count = 0}">Reset</button>
</div>
```

The runtime auto-initializes on `DOMContentLoaded` and scans for `data-forma-state` elements. A `MutationObserver` watches for dynamically added scopes — no manual re-initialization needed.

---

## HTML Runtime — Complete Reference

### State Declaration

```html
<div data-forma-state='{"name": "World", "count": 0, "visible": true, "items": ["a","b","c"]}'>
  <!-- All children can reference name, count, visible, items -->
</div>
```

State values can be strings, numbers, booleans, arrays, or objects. Each property becomes a reactive signal. Relaxed JSON (unquoted keys) is supported:

```html
<div data-forma-state='{count: 0, name: "World"}'>
```

### Text Binding — `data-text`

Sets the element's `textContent` reactively.

```html
<span data-text="{name}"></span>
<span data-text="{count * 2}"></span>
<span data-text="{count > 0 ? 'positive' : 'zero'}"></span>
<span data-text="{`Hello, ${name}!`}"></span>
<span data-text="{price.toFixed(2)}"></span>
```

### Show/Hide — `data-show`

Toggles `display: none` based on a truthy expression. Element stays in DOM.

```html
<div data-show="{visible}">This is visible when visible is true</div>
<div data-show="{count > 5}">Shows when count exceeds 5</div>
<div data-show="{!editing}">Read-only view</div>
```

### Conditional Render — `data-if`

Removes the element from the DOM entirely when falsy, restores it when truthy. Uses a comment node as an anchor.

```html
<div data-if="{loggedIn}">Welcome back!</div>
```

Use `data-if` when the element must be gone from the DOM (screen readers, form submission, DOM queries). Use `data-show` when you just need visual toggle.

### Two-Way Binding — `data-model`

Binds an input's value to a state property. Works with `<input>`, `<textarea>`, and `<select>`. Auto-converts `type="number"` and `type="range"` to `Number`. Checkbox inputs bind as boolean.

```html
<input type="text" data-model="{username}" placeholder="Enter name">
<input type="number" data-model="{quantity}">
<input type="range" data-model="{volume}" min="0" max="100">
<input type="checkbox" data-model="{agreed}">
<textarea data-model="{bio}"></textarea>
```

### Event Handlers — `data-on:event`

Handles any DOM event. The expression runs in the scope of the declared state.

```html
<button data-on:click="{count++}">+1</button>
<button data-on:click="{count--}">-1</button>
<button data-on:click="{count = 0}">Reset</button>
<button data-on:click="{active = !active}">Toggle</button>
<button data-on:click="{active = true}">Enable</button>
<input data-on:input="{name = $event.target.value}">
<div data-on:mouseenter="{hovering = true}" data-on:mouseleave="{hovering = false}">
  Hover me
</div>
```

`$event` is available inside event expressions and refers to the native DOM event.

**Multi-statement handlers** — chain expressions with semicolons:

```html
<button data-on:click="{count++; active = true}">Do both</button>
<button data-on:click="{prev = count; count = 0}">Reset with undo</button>
```

**Compound assignments:**

```html
<button data-on:click="{total += price}">Add to cart</button>
<button data-on:click="{health -= damage}">Take hit</button>
```

### Conditional CSS Classes — `data-class:name`

Adds/removes a CSS class based on a truthy expression. Stack multiple on the same element.

```html
<div data-class:active="{isActive}"
     data-class:highlight="{count > 10}"
     data-class:opacity-50="{disabled}">
  Conditionally styled
</div>
```

### Dynamic Attributes — `data-bind:attr`

Sets any HTML attribute reactively. Removes the attribute when value is `null` or `false`.

```html
<a data-bind:href="{url}">Link</a>
<img data-bind:src="{imageUrl}" data-bind:alt="{imageAlt}">
<button data-bind:disabled="{loading}">Submit</button>
<input data-bind:placeholder="{isSearch ? 'Search...' : 'Type here...'}">
```

### Computed Values — `data-computed`

Declares derived reactive values that recalculate when dependencies change. Lazy-evaluated.

```html
<div data-forma-state='{"price": 10, "quantity": 2}'>
  <div data-computed="total = price * quantity"></div>
  <div data-computed="tax = total * 0.08"></div>
  <span data-text="{total}"></span> + <span data-text="{tax}"></span> tax
</div>
```

### Persistence — `data-persist`

Auto-syncs a state property to `localStorage` under the key `forma:propName`. Value is restored on page load.

```html
<div data-forma-state='{"theme": "light", "cookieOk": false}'>
  <div data-persist="{theme}"></div>
  <div data-persist="{cookieOk}"></div>
  <!-- theme and cookieOk survive page reload -->
</div>
```

### List Rendering — `data-list`

Renders a list reactively. The first child element is used as the template (removed from DOM, cloned per item). Use `{item}` for the current item and `{item.property}` for object properties.

```html
<div data-forma-state='{"todos": ["Buy milk", "Walk dog", "Code"]}'>
  <ul data-list="{todos}">
    <li>{item}</li>
  </ul>
</div>
```

With objects and **keyed reconciliation** (`data-key` uses LIS algorithm for minimal DOM moves):

```html
<div data-forma-state='{"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}'>
  <div data-list="{users}">
    <div data-key="{item.id}" class="card">
      <h3>{item.name}</h3>
    </div>
  </div>
</div>
```

### Fetch — `data-fetch`

Declarative HTTP fetching with loading state, error state, and polling.

```html
<div data-forma-state='{"users": [], "isLoading": false, "err": null}'>
  <div data-fetch="GET /api/users -> users |loading:isLoading |error:err |poll:30000"></div>
  <div data-show="{isLoading}">Loading...</div>
  <div data-show="{err}" data-text="{err}"></div>
  <ul data-list="{users}">
    <li>{item.name}</li>
  </ul>
</div>
```

Syntax: `[METHOD] url -> targetProperty [|loading:prop] [|error:prop] [|poll:ms]`

Supported methods: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (defaults to `GET`).

### Expression Language

The runtime evaluates expressions inside `{...}` using a CSP-safe parser. Supported operators:

| Category | Operators |
|----------|-----------|
| Arithmetic | `+` `-` `*` `/` `%` |
| Comparison | `===` `!==` `==` `!=` `>` `<` `>=` `<=` |
| Logical | `&&` `\|\|` `!` |
| Nullish | `??` |
| Ternary | `? :` |
| Template literals | `` `Hello ${name}` `` |
| Assignment | `=` `+=` `-=` `*=` `/=` |
| Increment | `++` `--` (prefix and postfix) |
| Property access | `obj.prop` `arr[0]` `obj['key']` (up to 4 levels deep) |
| Method calls | `num.toLocaleString()` `Math.floor(x)` `Math.round(a * b)` |

If the CSP-safe parser can't handle an expression, unsafe fallback eval is **disabled by default**. You can opt-in explicitly:

```javascript
import { setUnsafeEval } from 'formajs/runtime';
setUnsafeEval(true); // allow new Function fallback for complex expressions
```

### Debugging

Enable debug logging to trace the reactive chain:

```javascript
// In browser console (inside the iframe if using an editor)
window.__FORMA_DEBUG = true;

// Or programmatically
FormaRuntime.setDebug(true);
```

Traces include: scope initialization, element binding, handler firing, setter values (before/after), `data-show` effect re-evaluation, and MutationObserver activity.

### Auto-Discovery

The runtime uses a `MutationObserver` to watch for dynamically added `data-forma-state` elements. Cost is O(addedNodes) per mutation batch — it never re-scans the whole document. Scopes are automatically mounted when added and unmounted (effects disposed) when removed.

---

## HTML Runtime — Full Example

A complete interactive page with no build step:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FormaJS Todo App</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/formajs/dist/formajs-runtime.global.js"></script>
</head>
<body class="bg-gray-950 text-white min-h-screen flex items-center justify-center">
  <div class="w-full max-w-md px-4"
       data-forma-state='{"todos": [], "input": "", "filter": "all"}'>

    <h1 class="text-3xl font-bold mb-6">Todo List</h1>

    <!-- Input -->
    <div class="flex gap-2 mb-4">
      <input data-model="{input}"
             data-on:keydown="{if ($event.key === 'Enter' && input.trim()) { todos = [...todos, {text: input.trim(), done: false}]; input = ''; }}"
             class="flex-1 bg-white/10 border border-white/20 rounded px-3 py-2 text-white"
             placeholder="Add a todo...">
      <button data-on:click="{if (input.trim()) { todos = [...todos, {text: input.trim(), done: false}]; input = ''; }}"
              class="bg-blue-600 px-4 py-2 rounded font-semibold hover:bg-blue-500">
        Add
      </button>
    </div>

    <!-- Computed count -->
    <div data-computed="remaining = todos.filter(t => !t.done).length"></div>
    <p class="text-sm text-white/50 mb-4">
      <span data-text="{remaining}"></span> items remaining
    </p>

    <!-- List -->
    <ul data-list="{todos}" class="space-y-2">
      <li class="flex items-center gap-2 bg-white/5 rounded px-3 py-2">
        <span>{item.text}</span>
      </li>
    </ul>
  </div>
</body>
</html>
```

---

## Programmatic API — Quick Start

Install:

```bash
npm install formajs
```

```typescript
import { createSignal, createEffect, createComputed, batch, h, mount, createList } from 'formajs';

const [count, setCount] = createSignal(0);

mount(() =>
  h('div', null,
    h('p', null, () => `Count: ${count()}`),
    h('button', { onClick: () => setCount(c => c + 1) }, '+1'),
  ),
  '#app'
);
```

### Subpath Imports

```typescript
import { ... } from 'formajs';           // Full programmatic API
import { ... } from 'formajs/runtime';    // HTML Runtime (initRuntime, mount, unmount, setDebug, setUnsafeEval)
import { ... } from 'formajs/tc39';       // TC39 Signals compat (State, Computed classes)
import { ... } from 'formajs/ssr';        // Server-side rendering
```

---

## Programmatic API — Complete Reference

### Reactive Core

#### `createSignal<T>(initial: T): [get: () => T, set: (v: T | (prev: T) => T) => void]`

Creates a reactive signal. The getter tracks dependencies in effects.

```typescript
const [count, setCount] = createSignal(0);
count();              // 0
setCount(5);          // set directly
setCount(c => c + 1); // updater function
```

#### `createEffect(fn: () => void | (() => void)): () => void`

Runs a side effect that auto-tracks signal dependencies. Re-runs when dependencies change. Returns a dispose function.

```typescript
const dispose = createEffect(() => {
  document.title = `Count: ${count()}`;
  return () => console.log('cleanup');  // optional cleanup
});
dispose(); // stop the effect
```

#### `createComputed<T>(fn: () => T): () => T`

Creates a lazy, cached derived value.

```typescript
const doubled = createComputed(() => count() * 2);
doubled(); // auto-tracks and caches
```

#### `createMemo<T>(fn: () => T): () => T`

Alias for `createComputed`. Use whichever name you prefer.

#### `batch(fn: () => void): void`

Groups multiple signal updates. Effects run once after the batch completes.

```typescript
batch(() => {
  setA(1);
  setB(2);
  setC(3);
  // effects don't run yet
});
// effects run here, once
```

#### `untrack<T>(fn: () => T): T`

Reads signals inside `fn` without tracking them as dependencies.

```typescript
createEffect(() => {
  const a = count();           // tracked
  const b = untrack(() => other()); // NOT tracked — won't re-run when other changes
});
```

#### `createRoot<T>(fn: (dispose: () => void) => T): T`

Creates a reactive root scope. All effects created inside are collected and can be disposed together.

```typescript
createRoot(dispose => {
  createEffect(() => console.log(count()));
  // call dispose() later to clean up all effects in this root
});
```

#### `onCleanup(fn: () => void): void`

Registers a cleanup function that runs when the current effect re-runs or is disposed.

```typescript
createEffect(() => {
  const id = setInterval(tick, 1000);
  onCleanup(() => clearInterval(id));
});
```

#### `on<T, U>(deps: () => T, fn: (value: T, prev: T) => U, options?: { defer?: boolean }): () => U`

Explicit dependency tracking. Only re-runs when `deps` changes, not when signals inside `fn` change.

```typescript
createEffect(on(() => count(), (value, prev) => {
  console.log(`count changed from ${prev} to ${value}`);
}));
```

#### `onError(handler: (error: unknown, source?: string) => void): void`

Registers a global error handler for reactive effects.

#### `createRef<T>(initial: T): Ref<T>`

Creates a mutable ref object with `.current` property. It is non-reactive.

```typescript
const ref = createRef(0);
ref.current = 5; // set
ref.current;     // 5 (does not trigger effects)
```

#### `createReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [() => S, Dispatch<A>]`

Redux-style reducer backed by a signal.

```typescript
const [state, dispatch] = createReducer(
  (state, action) => {
    switch (action.type) {
      case 'increment': return { count: state.count + 1 };
      case 'reset': return { count: 0 };
      default: return state;
    }
  },
  { count: 0 }
);

dispatch({ type: 'increment' });
```

#### `createResource<T, S>(fetcher: (source: S) => Promise<T>, options?): Resource<T>`

Async data fetching with signal integration and Suspense support. See SSR section for streaming support.

### DOM

#### `h(tag: string, props?: object | null, ...children: unknown[]): HTMLElement`

Creates a real DOM element. Supports reactive props (pass signal getter as prop value), event handlers (`onClick`, `onInput`, etc.), styles, classes, boolean attributes, refs, and `dangerouslySetInnerHTML`.

```typescript
h('div', { class: 'container', style: { color: 'red' } },
  h('input', {
    value: () => name(),             // reactive attribute
    onInput: (e) => setName(e.target.value),
    class: () => active() ? 'on' : 'off',  // reactive class
    disabled: () => loading(),        // reactive boolean
    ref: (el) => console.log(el),     // ref callback
  }),
  h('p', null, () => `Hello ${name()}`),  // reactive text child
)
```

#### `mount(component: () => Element, container: string | HTMLElement): () => void`

Mounts a component into a container. Returns an unmount function that removes DOM and disposes effects.

```typescript
const unmount = mount(App, '#app');
unmount(); // cleanup everything
```

#### `createList<T>(items: () => T[], keyFn: (item: T) => string | number, renderFn: (item: T, index: () => number) => HTMLElement, options?: { updateOnItemChange?: 'none' | 'rerender' }): HTMLElement`

Keyed list with efficient reconciliation (LIS algorithm).
- Default (`updateOnItemChange: 'none'`): maximum throughput, reuses same-key rows without re-rendering row content.
- Optional (`updateOnItemChange: 'rerender'`): re-renders same-key rows when item identity changes for static row templates.

```typescript
createList(
  () => todos(),
  todo => todo.id,
  (todo, index) => h('li', null, () => `${index() + 1}. ${todo.text}`),
  { updateOnItemChange: 'rerender' },
)
```

#### `createShow(when: () => boolean, children: () => Element, fallback?: () => Element): Element`

Conditional rendering. Mounts/unmounts children based on `when`.

```typescript
createShow(
  () => loggedIn(),
  () => h('div', null, 'Welcome!'),
  () => h('div', null, 'Please sign in')
)
```

#### `createSwitch<T>(value: () => T, cases: Record<string, () => Element>): Element`

Multi-way conditional rendering based on a value.

#### `createPortal(children: () => Element, target: string | HTMLElement): Element`

Renders children into a different DOM node (e.g., modals into `document.body`).

#### `createErrorBoundary(children: () => Element, fallback: (error: unknown) => Element): Element`

Catches errors in child rendering and displays a fallback.

#### `createSuspense(children: () => Element, fallback: () => Element): Element`

Suspense boundary for async resources. Shows fallback while resources are loading.

#### `createText(value: string | (() => string)): Text`

Creates a text node. If a function is passed, it reactively updates.

#### `fragment(...children: unknown[]): DocumentFragment`

Creates a DocumentFragment from children.

#### `template(html: string): Node`

Parses an HTML string into a DOM node using `<template>` for efficient cloning.

#### `cleanup(el: Element): void`

Disposes all reactive effects attached to an element and its descendants.

#### `hydrate(root: Element, componentFn: () => Node): void`

Client-side hydration — attaches reactive bindings to server-rendered HTML without re-creating DOM nodes. See SSR section.

### Components

#### `defineComponent(setup: () => Element): () => Element`

Defines a reusable component. The setup function runs once per instance. Reactivity is driven by signals, not re-rendering.

```typescript
const Counter = defineComponent(() => {
  const [count, setCount] = createSignal(0);

  onMount(() => {
    console.log('mounted');
    return () => console.log('unmounted');
  });

  return h('div', null,
    h('span', null, () => String(count())),
    h('button', { onClick: () => setCount(c => c + 1) }, '+'),
  );
});

mount(Counter, '#app');
```

#### `onMount(fn: () => void | (() => void)): void`

Lifecycle hook — runs after setup. Return a cleanup function for unmount. Must be called inside `defineComponent`.

#### `onUnmount(fn: () => void): void`

Lifecycle hook — runs when component is disposed. Must be called inside `defineComponent`.

#### `createContext<T>(defaultValue: T): Context<T>`

Creates a context for dependency injection.

#### `provide<T>(ctx: Context<T>, value: T): void`

Provides a context value for child components.

#### `inject<T>(ctx: Context<T>): T`

Reads the current context value.

### State Management

#### `createStore<T extends object>(initial: T): [get: T, set: (partial: Partial<T> | (prev: T) => Partial<T>) => void]`

Deep reactive store where each property gets its own signal. Only notifies affected subscribers.

```typescript
const [state, setState] = createStore({ count: 0, name: 'hello' });
state.count;                     // 0 (tracked)
setState({ count: 1 });          // only count subscribers fire
setState(prev => ({ count: prev.count + 1 }));
```

#### `createHistory<T>(source: [get, set], options?: { maxLength?: number }): HistoryControls<T>`

Undo/redo tracking for a signal.

```typescript
const hist = createHistory([count, setCount], { maxLength: 50 });
hist.undo();        // go back
hist.redo();        // go forward
hist.canUndo();     // reactive boolean
hist.canRedo();     // reactive boolean
hist.clear();       // reset history
```

#### `persist<T>(source: [get, set], key: string, options?: { storage?: Storage }): void`

Auto-syncs a signal to localStorage. Restores on load, writes on every change.

```typescript
persist([theme, setTheme], 'app:theme');
```

### Events

#### `createBus<T extends Record<string, any>>(): EventBus<T>`

Typed pub/sub event bus.

```typescript
const bus = createBus<{ save: string; reset: void }>();
const unsub = bus.on('save', (data) => console.log(data));
bus.emit('save', 'hello');
unsub();
```

#### `delegate(container, selector, event, handler): () => void`

Event delegation — single listener on a parent, matches children by CSS selector.

```typescript
delegate(document.body, '.btn', 'click', (e, matched) => {
  console.log('clicked button:', matched.textContent);
});
```

#### `onKey(combo: string, handler: (e: KeyboardEvent) => void): () => void`

Keyboard shortcut handler. Supports `ctrl`, `shift`, `alt`, `meta` modifiers.

```typescript
onKey('ctrl+s', () => save());
onKey('escape', () => close());
onKey('ctrl+shift+z', () => redo());
```

### DOM Utilities

```typescript
import { $, $$, addClass, removeClass, toggleClass, setStyle, setAttr, setText, setHTML,
         closest, children, siblings, parent, nextSibling, prevSibling,
         onResize, onIntersect, onMutation } from 'formajs';

// Query
const el = $<HTMLDivElement>('.container');
const items = $$<HTMLLIElement>('li.item');

// Mutate
addClass(el, 'active', 'visible');
removeClass(el, 'hidden');
toggleClass(el, 'dark');
setStyle(el, { color: 'red', fontSize: '14px' });
setAttr(el, { 'aria-label': 'Close', disabled: false });
setText(el, 'Hello');
setHTML(el, '<strong>Bold</strong>');

// Traverse
closest(el, '.parent');
children(el, '.child');
siblings(el);
parent(el);
nextSibling(el);
prevSibling(el);

// Observe
const stop = onResize(el, (entry) => console.log(entry.contentRect));
const stopIntersect = onIntersect(el, (entry) => {
  if (entry.isIntersecting) console.log('visible');
});
const stopMutation = onMutation(el, (mutations) => console.log(mutations));
```

### Storage

```typescript
import { createLocalStorage, createSessionStorage, createIndexedDB } from 'formajs';

const local = createLocalStorage<User>('user');
local.set({ name: 'Alice' });
local.get();    // { name: 'Alice' }
local.remove();

const session = createSessionStorage<string>('token');
session.set('abc123');

const db = createIndexedDB<Product>('shop', 'products');
await db.set('p1', { name: 'Widget', price: 9.99 });
await db.get('p1');
await db.getAll();
```

### HTTP

#### `createFetch<T>(url, options?): { data, loading, error, refetch, abort }`

Reactive fetch with signal integration. If url is a function, auto-refetches when dependencies change.

```typescript
const { data, loading, error, refetch } = createFetch<User[]>('/api/users');

createEffect(() => {
  if (loading()) showSpinner();
  if (data()) renderUsers(data()!);
  if (error()) showError(error()!.message);
});
```

#### `fetchJSON<T>(url, options?): Promise<T>`

Simple one-shot fetch that returns parsed JSON.

#### `createSSE<T>(url, options?): { data, error, connected, close, on }`

Reactive Server-Sent Events connection.

```typescript
const sse = createSSE<Message>('/api/events');
createEffect(() => {
  if (sse.data()) console.log(sse.data());
});
sse.on('custom-event', (data) => handle(data));
```

#### `createWebSocket<TSend, TReceive>(url, options?): { data, status, send, close, on }`

Reactive WebSocket with auto-reconnect.

```typescript
const ws = createWebSocket<string, ChatMessage>('wss://chat.example.com');
ws.send('hello');
createEffect(() => {
  if (ws.data()) appendMessage(ws.data()!);
});
```

### Server (`formajs`)

#### `createAction(fn, options?): Action`

Optimistic UI actions. Runs an async function while immediately applying an optimistic update. Reverts on failure.

```typescript
import { createAction } from 'formajs';

const saveItem = createAction(
  async (item) => {
    const res = await fetch('/api/items', { method: 'POST', body: JSON.stringify(item) });
    return res.json();
  },
  { optimistic: (item) => addToList(item) }
);

await saveItem({ name: 'New Item' });
```

---

## SSR — Server-Side Rendering

Import from `formajs/ssr`:

```typescript
import { renderToString, sh, renderToStream, ssrSignal, ssrComputed } from 'formajs/ssr';
```

#### `renderToString(component: () => VNode): string`

Renders a component tree to an HTML string. Uses `sh()` (the SSR hyperscript) instead of `h()`.

```typescript
const html = renderToString(() =>
  sh('div', { class: 'app' },
    sh('h1', null, 'Hello SSR'),
    sh('p', null, () => `Count: ${count.get()}`)
  )
);
```

#### `renderToStringWithHydration(component: () => VNode): string`

Same as `renderToString` but adds hydration markers (`data-forma-h`) so the client can attach reactivity without re-creating DOM.

#### `renderToStream(component: () => SuspenseVNode, options?: StreamOptions): ReadableStream`

Streaming SSR with Suspense support. Sends the shell immediately, then streams in async content as it resolves.

#### `ssrSignal<T>(initial: T)` / `ssrComputed<T>(fn: () => T)`

Server-safe signal primitives for SSR context.

#### Client Hydration

```typescript
import { hydrate } from 'formajs';

// On the client — attaches reactivity to server-rendered HTML
hydrate(document.getElementById('app')!, () => App());
```

---

## TC39 Signals Compatibility

Import from `formajs/tc39`:

```typescript
import { State, Computed } from 'formajs/tc39';
```

Class-based API matching the [TC39 Signals proposal](https://github.com/tc39/proposal-signals) (Stage 1). When the proposal advances, these can be swapped for native implementations.

```typescript
const count = new State(0);
count.get();   // 0
count.set(5);

const doubled = new Computed(() => count.get() * 2);
doubled.get(); // 10
```

---

## Architecture

- **Signals** — All reactivity is built on [alien-signals](https://github.com/nicolo-ribaudo/alien-signals). Follows the TC39 Signals proposal semantics.
- **No VDOM** — DOM mutations happen directly via fine-grained effects. Only the exact text node, attribute, or class that changed gets updated.
- **CSP-Safe First** — The HTML Runtime uses a hand-written expression parser that avoids `new Function()` for common patterns. Falls back to `Function` constructor only for complex expressions.
- **Keyed Reconciliation** — Lists use the Longest Increasing Subsequence algorithm for minimal DOM moves.
- **MutationObserver** — Auto-discovers dynamically added `data-forma-state` scopes. O(addedNodes) cost per mutation batch.
- **Automatic Cleanup** — Effects return dispose functions. Components track all child effects and clean them up on unmount.
- **Two APIs** — The HTML Runtime uses the same reactive core as the programmatic API. The runtime scans the DOM for `data-forma-state` attributes and wires everything up automatically.

---

## Build Outputs

| File | Size | Use |
|------|------|-----|
| `dist/index.js` | 47KB | ESM import for bundlers |
| `dist/index.cjs` | 51KB | CommonJS require |
| `dist/formajs.global.js` | 31KB | `<script>` tag, exposes `window.Forma` |
| `dist/formajs-runtime.global.js` | 20KB | `<script>` tag, HTML Runtime auto-init |
| `dist/runtime.js` | 28KB | ESM import for runtime module |
| `dist/tc39-compat.js` | 1KB | TC39 Signals compat layer |
| `dist/ssr/index.js` | 10KB | Server-side rendering module |
| `dist/index.d.ts` | 40KB | TypeScript declarations |

---

## License

MIT
