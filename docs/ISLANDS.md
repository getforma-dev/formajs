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
an element, it creates it in the namespace the parser gives that place. This
covers what the server rendered differently or left out, a show branch it left
empty, a keyed row it did not render, and every later toggle or row. Inside an
SVG element that namespace is SVG, inside a MathML element MathML, and HTML at
the parser's HTML integration points (a `foreignObject`, `desc` or `title`; a
MathML `mi`, `mo`, `mn`, `ms` or `mtext`; an `annotation-xml` whose `encoding`
is `text/html` or `application/xhtml+xml`) and in HTML. A `title` it creates in
an SVG is an SVG `title`, and an `svg` is SVG wherever it appears.

The parser still differs in three cases of markup that is not valid there:
- an HTML element such as `p` or `div` put directly in SVG or MathML, which the
  parser moves out of it and adoption leaves where it is;
- an `svg` directly inside a MathML element that is not an integration point
  (an `mrow`), which the parser makes a MathML element;
- a MathML name inside SVG, which the parser makes an SVG element.

`h()` creates an `svg` in SVG and a MathML name in MathML wherever it appears.

Client rendering gives the same namespaces where `h()` knows the parent: a
`title` or an `a` built inside `svg()`, or as a reactive child, a control-flow
branch or row, a portal or a `mount()` into an SVG. One written as a child
argument outside `svg()` is built before its `svg` exists and is HTML. See the
SVG and MathML section of [API.md](API.md).

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
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "a show branch the server left empty, the branches it toggles to, and fresh keyed rows"
Verified by `src/dom/__tests__/namespace-resolution.test.ts` > "adoption creates what the server left out of a desc or an mtext in HTML, and an svg in SVG anywhere"

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
