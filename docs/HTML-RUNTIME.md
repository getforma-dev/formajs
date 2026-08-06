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
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@2.0.0/dist/formajs-runtime.global.js"></script>

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
  slot.** Every expression terminates by construction; budgets bound cost.

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
<script src="https://cdn.jsdelivr.net/npm/@getforma/core@2.0.0/dist/formajs-runtime-hardened.global.js"></script>
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
