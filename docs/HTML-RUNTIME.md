# The HTML Runtime — reactivity with no build step

One `<script>` tag. One HTML file. No npm, no bundler, no `node_modules`, no
config files. Just open it in a browser.

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@latest/dist/formajs-runtime.global.js"></script>

<div data-forma-state='{ "count": 0 }'>
  <p data-text="{count}"></p>
  <button data-on:click="{count++}">+1</button>
  <button data-on:click="{count = 0}">Reset</button>
</div>
```

That is a working reactive counter with no JavaScript file and no build step.
It shares the signal graph with the `h()` and JSX entry points — this is not a
separate, lesser runtime. The same counter is the HTML-runtime entry in the
[README](../README.md)'s "three ways to use it" section, pinned rather than
`@latest`; both cite the test below, which mounts this markup and clicks it.

Verified by `src/__tests__/readme-examples.test.ts` > "the intro counter works without eval"

## Everything in one file

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@2.0.3/dist/formajs-runtime.global.js"></script>

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
  <button data-on:click="{darkMode = !darkMode}">Toggle Dark Mode</button>

  <!-- Dynamic classes and attributes -->
  <div data-class:dark="{darkMode}" data-bind:data-theme="{darkMode ? 'dark' : 'light'}">
    Theme is: <span data-text="{darkMode ? 'Dark' : 'Light'}"></span>
  </div>

  <!-- Persist to localStorage: survives page refresh -->
  <div data-persist="{darkMode}"></div>
</div>
```

Reactive state, two-way binding, computed values, conditional rendering, list
rendering *with filtering*, event handling, dynamic classes, dynamic attributes
and `localStorage` persistence — no JavaScript written, no build tools
installed.

That block is not illustrative. It is **extracted from this file at test time**
and mounted, so the documentation and its proof cannot drift — editing it into
something the grammar does not accept fails the suite, and so does deleting it.
A second copy is served in Playwright under a real
`Content-Security-Policy: script-src 'self'` response header, with the browser
console asserted to report zero violations.

Verified by `src/__tests__/readme-flagship.test.ts` > "the documented block renders exactly what this page says it renders"
Verified by `src/__tests__/readme-flagship.test.ts` > "typing in the data-model input filters the list and the count"
Verified by `src/__tests__/readme-flagship.test.ts` > "binds every directive in the block with zero diagnostics"

---

## The expression grammar is an allowlist, not a blocklist

Expressions are evaluated by an **allowlist AST interpreter** (`src/expr/`):
lexer, precedence-climbing parser, validator, tree-walking interpreter. Every
build. There is no `eval()`, no `new Function()`, no `with()` and no switch that
could reach one in any shipped artifact.

Four properties, each mechanical:

- **Identifier resolution never consults `globalThis`.** `document`, `fetch`,
  `window`, `localStorage` and `process` are unreachable rather than blocked —
  only arrow parameters, list-row locals, element magics, your declared state
  and one frozen table of captured intrinsics resolve.
- **A method is never obtained by reading a property of its receiver.**
  `items.filter(…)` applies the `Array.prototype.filter` captured at module
  init, so a state object carrying its own `filter` never contributes one and a
  page script poisoning `Array.prototype` later cannot change what runs.
- **`constructor`, `__proto__`, `prototype`, `call`, `apply` and `bind` are
  denied on the *evaluated* key**, so every spelling — `.constructor`,
  `['constructor']`, `[k]` from server JSON, `['cons' + 'tructor']` — is the
  same case.
- **No loops, no recursion, no function values that escape their callback
  slot.** Every expression terminates by construction; budgets bound cost. A
  built-in call, and an operator that builds or reads a long string, is
  charged before it runs, against 250,000 units (one unit is about the cost of
  an array slot), so `Array.from({length: 12000000})` is refused with
  `FORMA_E_BUDGET` without building anything, while a search that lowercases
  9,000 records is answered, in Greek, Cyrillic or CJK as in ASCII. The
  budget, and the 100,000 steps, are **one per task**: the bindings evaluated
  in one task share them, and a binding that finds them spent by the bindings
  before it renders in the next task instead (SECURITY.md, "Termination and
  budgets").

**Value expressions** — `data-text`, `data-show`, `data-if`, `data-list`,
`data-bind:*`, `data-class:*`, and the right-hand side of `data-computed` —
support: identifiers, `obj.a.b`, `obj?.a`, `obj['key']`, `arr[i + 1]`,
allowlisted method calls (`name.trim()`, `tags.join(', ')`, `Math.round(x)`,
`JSON.stringify(o)`, `Object.keys(o)`), **arrow-function callbacks** in `map` /
`filter` / `find` / `findIndex` / `some` / `every` / `flatMap` / `reduce` /
`sort`, `typeof x`, `!x`, unary `-x`, `? :`, `??`, `&&`, `||`, comparisons,
`+ - * / %`, array literals, object literals, and template literals with `${…}`
interpolation.

**Handler statements** — `data-on:*` — support all of the above plus `x++`,
`++x`, `x--`, `x = expr`, `x += expr` (and `-=`, `*=`, `/=`), the same on a
property path (`item.done = !item.done`, `$el.style.color = 'red'`), bare
method-call statements (`$el.classList.toggle('active')`,
`$refs.myInput.focus()`, `$dispatch('selected', {id})`), `if (cond) { … }` with
optional `else`, and `;`-separated sequences of those. `$event` and `event`
resolve inside them, gated by an allowlist.

A property-path write **mutates in place**: the signal still holds the same
object, so bindings reading it do not re-run. Reassign the root key
(`item = { done: !item.done }`) when the DOM has to follow.

Verified by `src/__tests__/readme-examples.test.ts` > "accepts every value-expression form the grammar section lists"
Verified by `src/__tests__/readme-examples.test.ts` > "accepts every handler-statement form the grammar section lists"
Verified by `src/expr/__tests__/handler-grammar.test.ts` > "a handler statement may be a bare method call"

**Permanently unsupported**, because these are the properties that make it safe:
statements inside expressions; `while` / `for` / `do`; `async` / `await`; arrows
used as values (legal *only* as the callback argument of the nine methods
above); bare calls `f(x)` where `f` is a value held in state; `.call` /
`.apply` / `.bind`; dynamic method lookup; `new`; `delete`; `in`; `instanceof`;
regex literals; `this`; `\u` / `\x` / octal escapes; destructuring; spread; and
any global outside the frozen table. A request to support X is answered by
adding X to a table, never by widening dispatch — see
[`../CONTRIBUTING.md`](../CONTRIBUTING.md).

Verified by `src/__tests__/readme-examples.test.ts` > "the forms this page says are permanently unsupported really are"
Verified by `src/expr/__tests__/adversarial.test.ts` > "no global is reachable by name"

An expression outside the grammar is **not evaluated, and it says so**. It logs
a `console.error` with a stable code and a column, emits a `formajs:diagnostic`
event, appears in `getDiagnostics()`, and marks its element
`data-forma-expr-error="unsupported"` (handlers get
`data-forma-handler-error="unsupported"`). The binding leaves whatever the DOM
already had — it never writes the string `undefined`.

Verified by `src/__tests__/failure-semantics.test.ts` > "a denied expression leaves the previous text in place and never renders undefined"
Verified by `src/__tests__/failure-semantics.test.ts` > "a denied binding does not stop its siblings from binding"

The hardened build is the same runtime under a second, tree-shaken bundling. It
is no longer a stronger guarantee — every build is equally eval-free:

```html
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@2.0.3/dist/formajs-runtime-hardened.global.js"></script>
```

Verified by `src/__tests__/build-artifacts.test.ts` > "no build emits new Function or a with() scope wrapper"

---

## Directive reference

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

Every `Example` cell above is extracted from this file by the test suite and
mounted on the element shape its directive needs; all of them bind with no
diagnostic, including the last three, which needed the eval fallback until the
allowlist interpreter landed. A row whose example stops parsing fails the suite
by name.

`$el`, `$event` and `$refs` hand expressions a **wrapped** element rather than
the live node, and the wrapper survives every hop, so `$el.ownerDocument`,
`$el.innerHTML` and `$refs.myInput.ownerDocument.location.href` are denials with
a diagnostic rather than answers.

Verified by `src/__tests__/readme-directive-table.test.ts` > "every Example cell in the directive table parses clean"
Verified by `src/__tests__/readme-directive-table.test.ts` > "the three magic-variable rows actually do what the table says"
Verified by `src/__tests__/readme-examples.test.ts` > "data-fetch loads into a state key and $refetch re-runs it, both without eval"

**`data-fetch` gives up after 30 seconds**, `createFetch`'s default timeout. A
request still unanswered then is aborted: its message (`data-fetch timed out
after 30000 ms`) lands in the `error:` target when the directive names one
(`data-fetch="GET /api/items → items |loading:busy |error:failed"`), and the
`loading:` target turns false. Each request of a `poll:` fetch has its own 30
seconds. Unmounting the scope or removing its element stops every request in
flight: its timer is cleared and the request aborted.

Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "a data-fetch to a stalled endpoint aborts at 30 s into its error: target"
Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "a data-fetch answered before 30 s lands in its target and is never aborted"
Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "each request of a polling data-fetch has its own 30 s"
Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "unmount() stops a stalled request: its 30 s timer is cleared and the request aborted"
Verified by `src/__tests__/runtime-fetch-timeout.test.ts` > "unmount() stops every in-flight request of a polling data-fetch, and removing the element does too"

---

## Mounting markup you did not write: tiers and grants

The script-tag runtime binds every `data-forma-state` on the page and, through
a `MutationObserver` on `body`, every one inserted later, with every power the
grammar has. That is right for a page you wrote. For markup a generator wrote,
such as a widget a model produced and an application admitted, `mountMarkup()`
(2.1.0) mounts it under a root you hand it, in a **tier**, with **grants**:

```ts
import { mountMarkup } from '@getforma/core/runtime';

const widget = mountMarkup(document.getElementById('widget-slot')!, html, {
  tier: 'reviewed',
  grants: { fetch: { methods: ['GET'], paths: ['/api/widgets/42/'], cookies: false } },
  config: { name: 'widget-42' },
});
widget.update(nextHtml); // reconciled: scopes whose shape is unchanged keep their state
widget.unmount(); // every binding disposed, the root emptied
```

- **Only under the root.** The mount binds the markup it is handed (and what
  `update()` hands it later) under its root, never by watching `body`. The root
  itself is the application's element, not the mount's.
- **Configuration only from the call.** The step budget (`config.exprBudget`,
  default 100,000), the expression diagnostics switch (`config.diagnostics`)
  and containment hints (`config.autoContainment`) come from the call; a
  script tag's `data-forma-*`, `window.__FORMA_RUNTIME_CONFIG`,
  `setDiagnostics()` and the server's directive map do not reach a mount.
- **Tiers** (decision brief DR-14). `'compiled'`: markup the application's own
  build made. `'reviewed'`: a widget the application reviewed and admitted, on
  its own origin. `'unreviewed'`: content nobody reviewed, which mounts only in a
  document with an opaque origin (an `iframe` sandboxed without
  `allow-same-origin`, where `self.origin` is `"null"`) and takes no grants; on
  any other origin the call throws `FORMA_E_MOUNT_ORIGIN`.

| Grant | What it allows | Without it |
|---|---|---|
| `fetch: { methods?, paths, cookies?, timeoutMs? }` | `data-fetch` with those `methods` (default `['GET']`), to URLs under those `paths` (`'/api/x/'` on the page's origin, or an absolute `https://…/` prefix on another; a prefix without a trailing slash covers that path and the paths below it, never `/api/x-admin`), with the user's cookies only if `cookies: true`, aborted after `timeoutMs` (at most and by default 30,000) | the request is never sent; its `error:` target reads `data-fetch denied: …` |
| `dom: true` | an element outside the mount root through `$el`, `$event` or `$refs`, and a selector that asks about one | `FORMA_E_GRANT_DOM`; the binding writes nothing |
| `navigate: true` | `click()`, which follows a link or submits a form in the user's session | `FORMA_E_GRANT_NAVIGATE`; the click is not made |

A grant left out of `grants` is not given; leaving out `grants` altogether
gives every grant. That default is 2.1.0's bridge, so a host can move its
call sites to `mountMarkup()` first and write grants second, and 3.0.0 turns
it to none (FORMA-108). Malformed grants throw `FORMA_E_MOUNT_ARGS` at the
call; mounting a root twice throws `FORMA_E_MOUNT_TWICE`, and `update()` after
`unmount()` throws `FORMA_E_MOUNT_GONE`.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "binds only under the root it is handed: markup injected outside it stays unbound"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a tiered mount takes its step budget from its call, never from a script tag"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a tiered mount ignores the page directive map"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "an unreviewed mount refuses any origin but an opaque one, and any grant"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "with explicit empty grants a generated tree binds neither data-fetch nor $el.click()"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a fetch grant admits only its methods and path prefixes: %j %s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a fetch grant's cookies decide the request's credentials"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a fetch grant's timeout shortens the abort"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "$el.click() is denied without navigate and runs with it"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a mount call names a known tier, an element and markup, and mounts a root once"

**`$el` stops at the mount root** (L-36). Every hop that yields an element
(`closest()`, `querySelector()`, `querySelectorAll()`, `children`, the first,
last, next and previous element, `$event.target`, `$event.currentTarget`,
`$refs`) hands back an element under the root, or is refused without `dom`, so
`$el.closest('body')` reaches nothing. A selector is a read of what it names,
so without `dom` it must be local: compound selectors (`li.row:not(.done)`,
`[data-key]`, `:nth-child(2n+1)`), with no combinator, which would ask about an
ancestor or a sibling (`body .row`, `[data-email^="a"] *`). What the allowlist
never offers stays unreachable whatever the grants: `parentElement`,
`parentNode`, `ownerDocument`, `getRootNode()`, `offsetParent`, `shadowRoot`,
`assignedSlot`, `form`, `labels`, `list`, `ownerSVGElement`, the node
siblings, `$event.relatedTarget`, `$event.composedPath()`, `$event.view`.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "$el.closest('body') reaches nothing without dom"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "no hop from $el reaches past the mount root: %s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a selector that reads past the element needs dom: %s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "no property or method outside the allowlist reaches another element, granted dom or not: $el.%s"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "no event field outside the allowlist reaches another element, granted dom or not: $event.%s"

**`data-fetch` under a mount** treats a status outside 200-299 as an error:
`data-fetch answered HTTP 404` lands in the `error:` target and the data
target keeps what it had. `$refetch` reaches only the fetches of its own mount.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a 404 with a JSON body lands in the error: target, not the data target"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "$refetch reaches only the fetches of its own mount"

**Every denial is a coded diagnostic**, whatever `config.diagnostics` or the
page's switch says: a `formajs:diagnostic` event, once per mount and expression,
whose `detail` is `{ kind: 'grant-denied', code, grant, mount, tier, expr,
reason, count }`, with `code` one of `FORMA_E_GRANT_FETCH`, `FORMA_E_GRANT_DOM`
and `FORMA_E_GRANT_NAVIGATE`. An application counts denials per tier from it.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a seeded denial raises one coded diagnostic, whatever the page's diagnostics switch says"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a mount takes its diagnostics switch from its call, not the page"

**Writing grants from observed use.** In a [development
build](STABILITY.md#development-builds), `handle.grantsUsed()` returns the
grants the mount has used so far, written as grants: the methods and exact
paths its `data-fetch` sent and whether the user's cookies went with them,
`dom: true` if it reached past its root, `navigate: true` if it clicked. Mount
a widget under the default, exercise it, and the report is the grant set to
review (L-36: a set derived this way takes effect once the founder approves
it, after the hostile corpus has run). A production build returns `null`.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "the development report lists exactly the grants a fixture widget used"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "a production build carries neither the grant report nor reconcile's warning"

**The shared responsibility** (v2 10.1). The application chooses each mount's
tier and passes grants only for content whose hash matches what its reviewer
approved, keeping the hash, the grants and the approver together (L-47);
markup whose hash differs mounts only in tier `'unreviewed'`. Forma enforces
what the mount grants. It cannot check which tier content deserves.

**In 2.x the tierless paths still run, unless the page turns them off.** By
default `@getforma/core/runtime` binds the page's `data-forma-state` on load and
watches `body`, and `mount()`, `initRuntime()` and `reconcile()` bind what they
are given with every power, as in 2.0.x; markup injected outside a tiered root
is bound by those paths. None of them binds or disposes anything under a
tiered root, and a tierless scope around one never binds the mount's elements
or hands out `$refs` to them.

A page that hosts tiered mounts turns every tierless path off with
`data-forma-mount="manual"` on a `<script>` element:

```html
<!-- CDN build: on the runtime's own script element -->
<script src="/vendor/formajs-runtime.global.js" data-forma-mount="manual"></script>
<!-- ESM build: on the module script that loads the application -->
<script type="module" src="/app.js" data-forma-mount="manual"></script>
```

Then nothing binds but `mountMarkup()`: no auto-mount on load, no `body`
observer, and `mount()`, `initRuntime()` and `reconcile()` throw
`FORMA_E_MOUNT_MANUAL` before touching the page, so markup injected outside a
tiered root stays unbound (SR16, in 2.x). The switch is read once, when the
runtime first runs, before it binds anything: from its own `<script>` element in
a CDN build, else from any `<script>` that carries it, since an ESM build has
no element of its own. Only `manual` counts, and one element saying it is
enough, so the switch can only take binding paths away; removing or changing
the attribute later changes nothing. It is an attribute, so it needs no inline
script. Without it, 3.0.0 makes this the only behaviour (FORMA-108).

`reconcile()` is deprecated: a development build logs
`FORMA_W_DEPRECATED_RECONCILE` on its first call, and 3.0.0 removes it with
the auto-mount and the observer. A mount's own `update()` re-renders its whole
root, including the root of a mount nested in it: unmount nested mounts first.

Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "no tierless path binds markup under a tiered root"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "with the page's mount switch only mountMarkup binds: markup injected outside a tiered root stays unbound"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "the mount switch is read once, from the runtime's own script element"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "reconcile behaves as at 2.0.x and warns once in development"
Verified by `src/__tests__/runtime-tiered-mount.test.ts` > "bindings a tierless path made under the root go first, with what they rendered"

---

## Where to go next

- [`../CSP.md`](../CSP.md) — the full CSP story: what a strict policy blocks,
  what FormaJS does instead, and the diagnostics you get when an expression is
  refused.
- [`API.md`](API.md) — the programmatic API (`createSignal`, `h()`,
  `createList`, …) that the same signal graph powers.
- [`CDN-AND-EXPORTS.md`](CDN-AND-EXPORTS.md) — which build to load, and the
  subpath exports.
- [`design/CSP-SAFE-EXPRESSION-GRAMMAR.md`](design/CSP-SAFE-EXPRESSION-GRAMMAR.md)
  — the design record behind the grammar: why it is a subset, where the line is
  drawn, and which alternatives were rejected. It is history, not a description
  of current behaviour; this page and [`../SECURITY.md`](../SECURITY.md) are.
