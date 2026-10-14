# Islands — hydrating server-rendered HTML

Hydrate independent interactive regions of server-rendered HTML. Each island
callback receives the root element and parsed props, then returns a component
tree. The hydration system walks that tree against the existing SSR DOM,
attaching handlers and reactive bindings without recreating elements.

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

Each island runs in its own `createRoot` scope with error isolation — a broken
island never takes down its siblings, and a component that throws part-way
through disposes whatever it had already created rather than leaving live
effects behind.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "disposes effects created before a failing island threw"
Verified by `src/dom/__tests__/hydrate.test.ts` > "a binding that throws on a shared-signal update does not freeze the other island"

---

## SSR with server data

When the server renders an island with real data, the island's signals **must
initialize from the `props` argument** — `createSignal(props?.x ?? fallback)` —
never from a bare client-side default. That is why the Counter above seeds
`createSignal(props?.initial ?? 0)` instead of `createSignal(0)`.

The reason is mechanical: adoption binds server-rendered text to your signals
through effects, and an effect's first run **writes the current client signal
value over the server-rendered text**. List adoption goes further — SSR rows
whose keys are missing from the client array are **removed**. Seed a signal
with an empty client default and the hydrated page silently erases the server's
data on load.

In dev builds this mismatch is loud. Grep your console for:

```
[FormaJS] Hydration: list item key "…" not found in SSR — rendering fresh
[FormaJS] Hydration: removing extra SSR list item with key "…"
```

### Getting props to the island

**Mode 1 — inline attribute** (small props, under about 1 KB). JSON in
`data-forma-props` on the island root:

```html
<div data-forma-island="0" data-forma-component="Counter" data-forma-props='{"initial": 5}'>
  <span>5</span>
  <button>+1</button>
</div>
```

**Mode 2 — shared script block** (larger props, or many islands on one page). A
single JSON block for the whole page, keyed by each island's id (the
`data-forma-island` value) as a decimal string:

```html
<div data-forma-island="0" data-forma-component="TrackList">
  <!-- server-rendered rows -->
</div>

<script id="__forma_islands" type="application/json">
{"0": {"items": [{"id": 1, "name": "Track 1"}, {"id": 2, "name": "Track 2"}]}}
</script>
```

Because the block is `type="application/json"`, the browser treats it as inert
data and never executes it — no `unsafe-inline` script needed, CSP-friendly. An
island with an inline `data-forma-props` attribute ignores the script block. A
malformed or truncated block degrades to "no shared props" instead of aborting
hydration for the whole page.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "a malformed __forma_islands block does not stop islands from hydrating"

**Prop sanitization is shallow by default.** Both channels delete top-level
`__proto__` / `constructor` / `prototype` keys before your island sees the
props. Keys nested inside child objects **pass through** — a deliberate trade,
because a deep walk of every payload on every hydration is a cost no island
should pay by default. If you hand props to anything that merges them into
another object — `createStore`, a deep-merge helper, an `Object.assign` chain —
sanitize them yourself:

```ts
import { activateIslands, sanitizePropsDeep } from "@getforma/core";

activateIslands({
  Cart: (el, props) => renderCart(el, sanitizePropsDeep(props)),
});
```

`sanitizePropsDeep` walks iteratively with a `WeakSet`, so neither deeply
nested nor cyclic props can overflow the stack or loop. RPC arguments
(`@getforma/core/server`) are stripped recursively **without** an opt-in — the
two paths are not equivalent, and this is the difference.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "is opt-in: island activation still sanitizes only the top level"
Verified by `src/dom/__tests__/activate-isolation.test.ts` > "sanitizePropsDeep strips forbidden keys at every depth"
Verified by `src/server/__tests__/rpc-deep-strip.test.ts` > "strips forbidden keys at a depth that overflows a recursive walk"

### Server-rendered lists

Server rows carry `data-forma-key` matching the `keyFn` output, wrapped in a
`<!--f:l0-->` / `<!--/f:l0-->` marker pair that delimits the list region:

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

The client island seeds a signal from `props.items` and passes it to
`createList`:

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

Keys are compared as strings — `data-forma-key="1"` matches `(item) => item.id`
for `id: 1`. Matched rows are adopted in place without re-rendering; unmatched
client items render fresh, and unmatched SSR rows are removed (the two warnings
above). If **no** row carries `data-forma-key`, adoption falls back to
index-based matching — fine for lists that never reorder, but keyed rows
survive reorders.

### Server data flow

The server renders the HTML and emits the matching props (inline or script
block) from the same data. On the client, `activateIslands` parses the props
*before* your island callback runs; the callback seeds signals from them, and
adoption then binds that already-correct state onto the existing DOM — when the
first effects run, they write the same values the server rendered, so nothing
visibly changes. Live updates after hydration (polling, websockets, user input)
flow through the same signals: `setItems(fresh)` reconciles rows in place, zero
clobber.

---

## What adoption does with Fragments, form controls, `textarea` and `title`

**Fragments.** A component may return a Fragment (`<>…</>`, `h(Fragment, …)`
or `fragment(…)`) at a `mount()` root, at an island root, inside an element or
as a `createShow` branch. The server renders a Fragment's children in place, so
adoption walks them in place: their handlers and bindings attach to the
server's nodes. A root `createShow` or `createList` with no wrapping element is
adopted the same way.

**A component that returns a DOM node.** Returning the island's own element (or
a node inside it) means the component wired the server's DOM itself: the island
activates as usual. A node built while hydrating that is not part of the
server's HTML cannot be adopted. The server's DOM stays as served, and the
error `FORMA_E_HYDRATE_NODE` is logged in every build. `activateIslands` marks
that island `error` and carries on with the others. `mount()` and
`hydrateIsland()` keep `data-forma-ssr` on the container and do not throw;
`mount()` also disposes the effects the component created. A component that
returns nothing (an island that sets up its own effects) still activates.

Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a root Fragment binds its click handler and reactive text after mount() adoption"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a Fragment at an island root is adopted, each island on its own"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a root createShow or createList is adopted against the container's children"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an island that returns its own element stays active and keeps updating"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an island that returns a detached DOM node is marked error with its code, its sibling unaffected"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "mount() of a detached DOM node keeps the server DOM, logs the code, disposes its effects and does not throw"

**Form controls.** What a user enters between first paint and activation is
kept. For a bound `value`, `checked` or `selected`, adoption first compares the
control's live state with the default its markup gives it (`value` with
`defaultValue`, `checked` with the `checked` attribute, a select's selection
with its `selected` options). If they differ, the user changed the control, and
adoption writes nothing to it. If the control already holds the client's value,
adoption writes nothing either, attributes included. Only an untouched control
the server rendered differently gets the client's value. A control the user
changed and then set back to its default counts as untouched. Every update
after activation is written to the live property, so a controlled input follows
its signal again from then on.

Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "keeps text typed into an input before activation, then follows later updates"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "adoption writes nothing when the server and the client agree"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "repairs an untouched control the server rendered with another value"

**`textarea` and `title`.** The HTML parser reads these elements' content as
text, so a hydration marker inside one is not a comment: it shows in the text
and, in a textarea, in the value a form submits. forma-ir 0.2.1 writes no
markers there, and the runtime binds their reactive text by the element. A
textarea's reactive text is its default value, as it is when client-rendered:
the value follows it until the user types, and after that an update changes
what a form reset restores, not the user's text. Bind the `value` prop for a
controlled textarea. For one release the runtime also accepts the marker text
older servers write: adoption removes it when it accounts for the whole
difference from the client's text, and leaves text that only looks like a
marker alone.

Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "binds a marker-free textarea by the element and writes nothing when it agrees"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "keeps text typed into a marker-carrying textarea before activation"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "keeps server text that only looks like marker text, edited or not, without a write"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "after the user types, a textarea's reactive text changes only its default, client-rendered and adopted alike"
Verified by `src/dom/__tests__/form-control-adoption.test.ts` > "binds a title's reactive text by the element, with or without marker text"

---

## Hydration triggers

Control when an island hydrates via `data-forma-hydrate`:

| Trigger | When it hydrates | Use case |
|---|---|---|
| `load` (default) | Immediately on page load | Above-the-fold content |
| `visible` | When the island enters the viewport | Below-the-fold components |
| `idle` | During browser idle time | Non-critical functionality |
| `interaction` | On first `pointerdown` or `focusin` | Skeleton + skin pattern |

```html
<div data-forma-island="1" data-forma-component="Comments" data-forma-hydrate="visible">
  <!-- JS loads only when scrolled into view -->
</div>
```

---

## Scoping to a subtree, and disposal

`activateIslands(registry, root?)` takes an optional root — pass a `ShadowRoot`
or a container element to hydrate only the islands inside it. It defaults to
`document`. When swapping content (for example inside a Shadow DOM stage),
dispose the old islands first or their effects leak:

```ts
import { activateIslands, deactivateIsland, deactivateAllIslands } from "@getforma/core";

activateIslands(registry, shadowRoot);   // hydrate one subtree
deactivateAllIslands(shadowRoot);        // tear the whole subtree down
deactivateIsland(islandElement);         // or one island
```

Both `root` parameters accept any `ParentNode`. A shared `__forma_islands`
block in the main document is still found when activating a shadow subtree that
has none of its own. An island removed as part of a `createList` row is
deactivated automatically.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "activates islands inside a shadow root when one is passed as root"
Verified by `src/dom/__tests__/activate-isolation.test.ts` > "falls back to the document props block for a shadow subtree"
Verified by `src/dom/__tests__/list-disposal.test.ts` > "deactivates an island inside a removed row"

---

## Where the wire format is specified

The marker grammar (`<!--f:t0-->`, `<!--f:s0-->`, `<!--f:l0-->`, `<!--f:i0-->`),
the `data-forma-*` attributes and the `__forma_islands` props protocol are
**shared contracts**, not implementation details of this library: the Rust
walker emits them and this runtime consumes them.

- [Stack architecture §3](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md)
  — the contracts, and where each one is enforced
- [FMIR format](https://github.com/getforma-dev/forma/blob/main/docs/FMIR-FORMAT.md)
  — the binary the server renders from
