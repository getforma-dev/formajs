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
value over the server-rendered text**. List adoption goes further. SSR rows
that carry `data-forma-key` and whose keys are missing from the client array
are **removed**. Rows without keys are matched by index, and when their count
differs from the client array's length the island **fails** instead (see
[Server-rendered lists](#server-rendered-lists)). Seed a signal with an empty
client default and the hydrated page either erases the server's data on load
or leaves the island inert.

In dev builds a keyed mismatch is loud. Grep your console for:

```
[FormaJS] Hydration: list item key "…" not found in SSR — rendering fresh
[FormaJS] Hydration: removing extra SSR list item with key "…"
```

An unkeyed count mismatch is logged in every build as
`FORMA_E_HYDRATE_LIST_COUNT`.

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

**Props are stripped at every depth while they are parsed.** Both channels
delete `__proto__` / `constructor` / `prototype` keys at every depth, in
objects and in array elements, before your island sees the props, and there is
no opt-out (DR-21). Handing props to anything that merges them into another
object — `createStore`, a deep-merge helper, an `Object.assign` chain — cannot
carry a nested pollution key into a prototype. The pass is iterative with a
`WeakSet`, so neither deeply nested nor cyclic props can overflow the stack or
loop. A shared `__forma_islands` block is parsed and stripped once per
`activateIslands` call.
Props must be a JSON object or array: any other JSON value (`null`, a number, a
string, a boolean) marks the island `error`, and `FORMA_E_ISLAND_PROPS` is
logged in every build.

`sanitizePropsDeep` (the same pass) stays exported for props that reach an
island some other way, and calling it on activation props is a harmless no-op.
RPC arguments (`@getforma/core/server`) are stripped recursively too.

Verified by `src/dom/__tests__/activate-isolation.test.ts` > "island activation strips forbidden keys at every depth, inline and shared, with no opt-out"
Verified by `src/dom/__tests__/activate-isolation.test.ts` > "island props nested 10,000 deep are parsed and stripped"
Verified by `src/dom/__tests__/props-loading.test.ts` > "props that are JSON but neither an object nor an array mark the island error with FORMA_E_ISLAND_PROPS"
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
above).

If **no** row carries `data-forma-key`, adoption matches rows by index, which is
right only when the client array is the one the server rendered. So it first
checks the count. When the number of server rows differs from the array's
length (more items, fewer, or none at all, as before a signal is seeded), no
row is adopted, removed or rendered. The island keeps the server's rows and is
marked `error`, and the error `FORMA_E_HYDRATE_LIST_COUNT`, naming both counts,
is logged in every build and passed to `onError` handlers with the source
`'hydration'`. An island in `error` is inert. The listeners attached during
adoption are removed, on the server's elements and on those adoption built
through `h()` before the failure. The bindings it adopted are disposed, also
when you call `hydrateIsland()` yourself and your root lives on.

Adoption runs in a batch. A signal its code writes during adoption (in a `ref`,
say) takes its new value at once. The effects that write triggers elsewhere,
in another island or another `mount()` root, run when adoption ends. So what
they build is theirs: it keeps its listeners and its bindings if this island
fails. Adoption's own bindings still run when they are created. This holds
for any adoption that fails part-way. Nodes adoption had already replaced or
added before the failing list (a tag mismatch, a keyed row the server did not
render) stay as it left them. `mount()` and `hydrateIsland()` keep
`data-forma-ssr` on the container and do not throw, as for
`FORMA_E_HYDRATE_NODE` below. Equal counts adopt every row in place, and after
adoption the list reconciles by key as usual. This check is the bridge until the
server writes keys for every list (decision brief DR-8).

The server writes an empty list region when the list's data is not an array.
So a list the client computes for itself, inside a server-rendered island,
leaves the island inert unless its array starts empty. Start that list's signal
empty and fill it after activation, or render the list in the browser only. An
island whose only server content is an empty list region (comments, no element
or text) is rendered in the browser instead, like any island with no server
content.

Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "marks the island error with FORMA_E_HYDRATE_LIST_COUNT and removes or adds no row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a server region with no rows and a client array with items fails the island and inserts nothing"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "equal counts adopt 40 unkeyed rows in place by index, as before, and keep reconciling"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "rows that carry data-forma-key keep matching by key when the counts differ"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "an island failed by the row count keeps no handler or binding that adoption attached before the list"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "an island failed by the row count answers no click on the nodes adoption built fresh before the list"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "hydrateIsland() called directly keeps no binding it adopted before the list failed"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a failing island's ref that writes a shared signal does not detach another island's new list row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a failing island's ref that writes a shared signal does not detach another island's new show branch"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a failing mount() whose ref writes a shared signal does not detach a second mount() root's new row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "a failing island's ref that writes a shared signal does not detach a client-rendered mount() root's new row"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "another island's row created while a failing island adopts keeps its reactive binding"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "the migration: an empty server region adopts an empty array, and rows filled after activation render"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "an island whose only server content is an empty list region is rendered in the browser, not checked"
Verified by `src/dom/__tests__/list-adoption-count.test.ts` > "onError receives FORMA_E_HYDRATE_LIST_COUNT from activateIslands, mount() and hydrateIsland(), and each keeps the server rows"

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

## What adoption does with Fragments, form controls, `textarea`, `title` and SVG

**Fragments.** A component may return a Fragment (`<>…</>`, `h(Fragment, …)`
or `fragment(…)`) at a `mount()` root, at an island root, inside an element or
as a `createShow` branch. The server renders a Fragment's children in place, so
adoption walks them in place: their handlers and bindings attach to the
server's nodes. A root `createShow` or `createList` with no wrapping element is
adopted the same way.

**A component that returns a DOM node.** Returning the island's own element, a
node inside it, or a fragment it already appended into the element (and so
emptied) means the component wired the server's DOM itself: the island
activates as usual. A node built while hydrating that is not part of the
server's HTML cannot be adopted. The server's DOM stays as served, and the
error `FORMA_E_HYDRATE_NODE` is logged in every build and passed to `onError`
handlers with the source `'hydration'`. `activateIslands` marks that island
`error` and carries on with the others. `mount()` and
`hydrateIsland()` keep `data-forma-ssr` on the container and do not throw;
`mount()` also disposes the effects the component created. A component that
returns nothing (an island that sets up its own effects) still activates.

Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a root Fragment binds its click handler and reactive text after mount() adoption"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a Fragment at an island root is adopted, each island on its own"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "a root createShow or createList is adopted against the container's children"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an island that returns its own element stays active and keeps updating"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an island that returns a detached DOM node is marked error with its code, its sibling unaffected"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "mount() of a detached DOM node keeps the server DOM, logs the code, disposes its effects and does not throw"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "an island that appends a fragment into its element and returns it, now empty, stays active"
Verified by `src/dom/__tests__/hydrate-fragment.test.ts` > "onError receives FORMA_E_HYDRATE_NODE from activateIslands, mount() and hydrateIsland()"

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

**Inline SVG and MathML.** These are adopted like any other element: the nodes
stay the server's, so focus and state inside an icon survive activation. The
parser keeps an SVG or MathML tag's case (`clipPath`), and adoption matches it
exactly; an HTML element matches a tag in any case. Where adoption must create
an element (the server rendered another tag, or nothing), it creates it in the
namespace of the element it goes into: SVG inside an SVG element, MathML
inside a MathML element, HTML inside a `foreignObject` and in HTML. A `title`
it creates in an SVG is an SVG `title`.

That is the namespace the HTML parser gives the server's markup, except where
the parser switches back to HTML inside SVG or MathML. Adoption follows that
switch only in a `foreignObject`. In these places it keeps the parent's
namespace, where the parser does not:

- the content of a MathML `mi`, `mo`, `mn`, `ms` or `mtext`, other than an
  `mglyph` or `malignmark`;
- the content of a MathML `annotation-xml` whose `encoding` is `text/html` or
  `application/xhtml+xml`, and an `svg` in any `annotation-xml`;
- the content of an SVG `title` or `desc`;
- an HTML element such as `p` or `div` put directly in SVG or MathML, which the
  parser moves out of it (that markup is not valid there).

For example, a `b` that adoption creates in an `mtext` is a MathML `b`, where
the parser makes the server's `b` an HTML one. What the server rendered in
these places keeps the parser's namespace, because adoption keeps those nodes.

Client rendering differs for icons: plain `h()` creates SVG-only tags (`svg`,
`path`, `clipPath`) in the SVG namespace by name, but a `title` or an `a` is
built before the `svg` it goes into, so it is created as HTML. Build an icon
that has a `title` or a link inside `svg()` (see the SVG section of
[API.md](API.md)) to get what the server's HTML parses to.

**Reactive attributes.** An attribute the server already rendered with the
client's value is not written at adoption, on any element; every later change
is. Setting an attribute to the value it has is still a DOM write, and for an
`iframe`'s `src` it reloads the frame.

Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "adopts a server-rendered inline SVG with no DOM write and no re-created node"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "adopts case-sensitive SVG tags such as clipPath and linearGradient in place"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "rebuilds a mismatched SVG child in the SVG namespace, title and a included"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "creates the content of a foreignObject in the HTML namespace"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "creates MathML the server did not render in the MathML namespace"
Verified by `src/dom/__tests__/hydrate-svg.test.ts` > "writes nothing where the server already holds the value, and still writes every change"
Verified by `src/dom/__tests__/svg-namespace.test.ts` > "an icon built in svg() has the namespaces and markup the parser gives the server HTML"

---

## Browser-only components: `browserOnly()`

Some components cannot render on the server: a chart that measures the
viewport, a map, an editor. Wrap such a component in `browserOnly()`, the one
marker for a subtree that renders in the browser alone (one name, so a search
finds every use):

```ts
import { activateIslands, browserOnly, h } from "@getforma/core";

// chart.tsx: declared once, at the top level of a module.
export const Chart = browserOnly((props: { title: string }) =>
  h("canvas", { "aria-label": props.title }),
);

// The page renders it like any component: <Chart title="Sales" />.
// The entry registers it under that name:
activateIslands({ Chart });
```

`@getforma/compiler` 0.3.7 and later emit it as a registered island whose
server output is its empty host element with its declared props:

```html
<div data-forma-island="0" data-forma-component="Chart" data-forma-status="pending"
     data-forma-hydrate="load" data-forma-props='{"title":"Sales"}'></div>
```

`activateIslands` finds the host empty and renders the component in its place,
with those props (or `{}`), carrying the island's `data-forma-*` attributes over
to the component's root. Register it as `browserOnly()` returns it: activation
calls it with the island's element and props, and it passes the props to the
component. In a client-rendered page it renders as any component. Where there
is no document (Node rendering) it renders nothing.

- **Props.** Only props the compiler can evaluate to a string, number, boolean
  or null reach the host: literals and module-level consts. A function, a
  spread, an array or object, or a value only the browser knows is left out
  and reported (`BUILD-706`); read such a value in the browser. A handler
  cannot change them; 3.0.0's declared island props do (DR-4).
- **Registration.** On a page that activates islands from a literal registry,
  a browser-only component the registry does not name never renders, and the
  build says so (`BUILD-708`).
- **Development builds** log, for each browser-only island, that it has no SSR
  content and falls back to client rendering. For these islands that is what
  was asked for.

Verified by `src/dom/__tests__/browser-only.test.ts` > "registered in activateIslands, renders the component in its empty host, from the server props"
Verified by `src/dom/__tests__/browser-only.test.ts` > "called as a component, renders it as any component in a client-rendered tree"

---

## What adoption skips today

Adoption has no handling for the constructs below, so a server-rendered page
that uses one is not adopted as written (FORMA-016). Since compiler 0.3.7 each
is reported at build time with its code, file and line, and `@getforma/build`'s
strict mode makes it an error; the way out is to render the subtree in the
browser with `browserOnly()`, or to write it as a construct the server renders.

What each one does, measured in Chromium on a `mount()` root built with
compiler 0.3.7 and activated by this runtime, with a counter button after the
construct:

| Construct | What a server-rendered page gets today | Build code | Instead |
|---|---|---|---|
| A plain array child: `{rows.map(r => <li>…</li>)}` without `createList` | The server renders an empty island shell nothing registers; adoption skips the array, so the rows never appear. The rest of the page activates | `BUILD-701` | `createList(rows, keyFn, (r) => …)`, or `...CONST.map(…)` over a module-level const |
| The same in a reactive child: `{() => rows.map(r => <li>…</li>)}` | The server renders empty text; after activation the page shows the elements as text, `[object HTMLLIElement],[object HTMLLIElement]`. The rest of the page activates | `BUILD-701` | The same |
| `createErrorBoundary` | The server renders an empty shell where it stands, and **activation throws** `TypeError: Failed to execute 'insertBefore' on 'Node': parameter 1 is not of type 'Node'`: nothing after the construct activates (the button stays dead) | `BUILD-702` | Move the boundary out of the server-rendered tree |
| `createSwitch` | The same: activation throws, and nothing after it activates | `BUILD-703` | A `createShow` per case |
| `createPortal` | No error, and the rest of the page activates, but the portal's content never appears: the server's empty shell stays where it stood | `BUILD-704` | Create the portal from an effect after activation |
| `createSuspense` | The same as `createErrorBoundary`: activation throws, and nothing after it activates | `BUILD-705` | Render the loaded state from server data |

A reactive child that returns an element, `{() => c() ? <el /> : null}`,
renders right on the server, but adoption binds it as text: beside the
server's element the page shows `[object HTMLElement]` (or `null`), and the
element is never removed. Write it as `createShow(() => c(), () => <el />)`.
Client-rendered, all of these work.

Whether adoption learns these constructs, with parity vectors and a browser
fixture each, or 3.0.0's compiler refuses them in a server-rendered component,
is decided for 3.0.0 (DR-1).

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
