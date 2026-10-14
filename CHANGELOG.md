# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Security

- **Operators that build or read strings are charged before they run**
  (FORMA-028, DR-16). Core 2.0.3 charged every built-in call but no operator,
  and the engine keeps a joined string as a rope that its first read copies
  whole, so an expression with no state could build a 524,288-character rope in
  19 steps and read copies of it for 0.6 to 4.3 s at 4x CPU throttling (the
  cases of formajs#14's second review). Now:
  - `+`, `+=` and template literals pay a 128th of a unit for each character
    they build past 511 (a string under 512 characters is free: the step
    budget bounds how many one evaluation builds);
  - comparing two strings of 128 characters or more pays a 128th a character
    compared (`===` and `==` only when the lengths match), and an array search
    for such a string pays for every element of the same length;
  - an operator that parses a string of 32 characters or more as a number
    (`s * 1`, `-s`, `s < 1`, `s == 1`) pays an eighth a character: parsing
    digits measured 11 ns a character, and a thousand conversions of a million
    digits ran for eleven seconds;
  - comparing, or reading a character of (`at`, `charAt`, `charCodeAt`,
    `s[i]`), a string the same expression has just built with `+` or a
    template pays for copying it: 8 units plus a 32nd a character, to 512;
  - a default `sort()` adds each string element's length, at a 128th, to every
    level of its comparisons.

  Each case of the review is refused with `FORMA_E_BUDGET` before the long
  task: at 4x, in Chromium 151 on an Apple M1 Pro, the slowest of 41 runs took
  27 ms. A loop of character reads is otherwise bounded by the step budget, as
  before. `+=` now keeps the 1 MiB result cap that `+` has.
- **The budgets are one per task and per event, not per evaluation**
  (FORMA-028). The runtime keeps a meter of what the evaluations of the
  current task have spent, and every evaluation it starts counts on from it,
  for the 250,000 units and the 100,000 steps alike; an evaluation started
  inside another (a `data-computed` a binding reads, a handler `$el.click()`
  or `$dispatch` reaches) spends the running one's budget. Ten bindings at the
  cap in one widget used to run in one 382 ms task. A binding refused only
  because the bindings before it in its task spent the budget is not reported:
  it renders in the next task, where it starts first, so those ten render one
  task at a time, none over 42 ms at 4x. A binding over the budget on its own
  is reported as before. A computed refused inside a heavy reader is evaluated
  alone at the start of the next task, so its refusal is not cached as its
  answer. A handler cannot be re-run, so an event the runtime has not seen
  (and a `data-model` input) starts a fresh meter, and the handlers one event
  reaches as it bubbles share it. A charge larger than the whole budget is
  refused and reported at once, whatever the task had spent: no later task
  could hold it, so it is not priced again in each retry.
- **The runtime's own conversions of a result to text are charged before
  they run** (FORMA-025). `data-text`, `data-bind:*`, `data-model`,
  `data-persist`, and a `data-list` row's `{item.x}` placeholders and
  `data-key` are charged, inside the binding's budget, for the `String()` or
  `JSON.stringify` they are about to make of the value (an array or object at
  its text weight; a string a row places, at a 128th a character). A list of a
  thousand references to one 300,000-character string costs 2,000 units to
  build and would be 300 million characters as text: `data-text` of it is
  refused in 2 ms at 4x, and `String()` never runs.
- **An ordinary search answers in Greek, Cyrillic, CJK and Latin Extended as
  2.0.1 does** (FORMA-028, L-50). Core 2.0.3 charged lowercasing any text with
  a character above Latin-1 at half a unit a character, so the text filter
  `rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q))` over
  260-character records was refused past about 1,716 records of such text.
  Lowercasing two-byte text measured 4 to 19 ns a character at 4x in Latin
  Extended, Greek, Cyrillic, Armenian, Hebrew, Arabic, the Indic scripts,
  Thai, Vietnamese, CJK, kana, Hangul and emoji, and 17 to 40 ns beyond them.
  Text whose first character above Latin-1 is in one of those scripts now costs
  1/16 a character, so the search answers 9,090 records, where the step budget
  stops it in every release, as it does for ASCII; Georgian, Cherokee, Greek
  Extended or fullwidth Latin text keeps 1/2 (about 2,280 records, 2,170 in
  2.0.3). Latin-1
  text answers as in 2.0.3. A string method now reads a string argument (a
  search pattern, a separator) for a 32nd of a unit a character instead of a
  whole unit. `src/expr/__tests__/ordinary-search.test.ts` holds the corpus:
  900 and 9,000 records in seven scripts.
- **Case mapping past the 1 MiB result cap is refused before it runs**: 2.0.3
  lowercased 8 million two-byte characters (115 ms at 4x) before refusing the
  result.
- **SR33 is checked in a browser**: `e2e/sr33.spec.ts` gives every allowlisted
  native a hostile size, in Chromium at 4x and then in Firefox and WebKit, and
  asserts that each is refused before the native runs, that no task reaches
  50 ms and, in Chromium, that the heap grows under 16 MB. Its table is the one
  `native-cost.test.ts` checks in Node.
- **Still not bounded to 50 ms**, and listed in SECURITY.md ("What the budgets
  do not bound"). The meter is zeroed by each event the runtime has not seen,
  so the several events one task can deliver (those of one click or keystroke,
  one per control of a submitted form) each get a budget: a widget that
  handles all of them spends a budget per event in that task. Under A14 every
  widget is the founder's reviewed code, and this is carried with the rest.
  Each of the following is bounded to one evaluation per task: a string search
  whose pattern's first characters fill the text (`'ab'` in `'aaaa…'`, 39 ns a
  character where ordinary text takes 1; one evaluation ran up to 315 ms at
  4x); case mapping of text stored two bytes a character but all Latin-1
  (charged as one-byte text, up to about four times under: 56 ms for seven
  calls on a million characters, 100 ms for alternating-case text); and text
  whose first character above Latin-1 is in a `1/16` script but whose rest is
  costlier (all-capital Greek 73 ms for four calls on 960,000 characters; a
  Greek letter followed by Cherokee 90 ms), because a full scan of two-byte
  text measured 6 to 7 ns a character, most of what lowercasing it costs. Its
  bound is a task's 4 million characters at 1/16 lowercased at about 40 ns,
  the costliest measured: about 160 ms. Turkish `İ` (U+0130) is a Latin
  Extended-A letter, so text with it is priced 1/16 though it measured 27 to
  30 ns a character: one call on a million ran 76 ms before the 1 MiB cap
  refused its two-million-character result. Nor does the budget price
  `data-list`'s rows: about 14 µs each at 4x, in 2.0.3 as here (FORMA-172).
  The largest ordinary evaluation is near the line as well: the 9,000-record
  search measured 24 ms median at 4x in ASCII and up to 50 ms in Greek, where
  2.0.1 measured 19 and 42 ms in the same session.
- **Behaviour change: what a task can no longer compute.** Measured with this
  release's engine against 2.0.3's:
  - Building a string with `reduce` and `+`, accepted by the lead (L-50):
    `rows.reduce((s, r) => s + r.name + ', ', '')` over names of 20 characters
    is refused past about 1,200 rows, where 2.0.3 answered about 14,300. Each
    `+` is charged the whole length it builds, so an accumulator pays the
    square of its length. `rows.map(r => r.name).join('')` stays cheap: it
    answers about 11,360 rows of 20 characters, as 2.0.3 does, in 7 ms median
    at 4x for 11,000; with separators, `rows.map(r => r.name).join(', ')`
    answers about 10,400.
  - Comparing two strings a callback has just built, or reading a character of
    one: `(s + 'y') === (s + 'z')` over 100-character strings past about
    10,280 iterations, `(s + 'y').charCodeAt(0)` past about 15,470 (2.0.3:
    about 12,500 and 16,700, where the step budget stops them). A string read
    from state, or held in a variable, costs what it did.
  - A default `sort()` of 10-character strings past about 6,280, counting
    everything else the evaluation does (numbers: about 6,400, as before).
  - Bindings that together pass the budget in one task render over several
    tasks: until its turn, a binding shows what it showed before.
  - `data-forma-expr-budget` now sets the step budget of a task (of an event,
    for a handler and the bindings it updates), not of each evaluation. A page
    that set it low renders its bindings over more tasks than before, where
    2.0.3 gave each binding the whole of it.
  - A computed read inside a binding spends that binding's budget.
  - Among the handlers one event reaches as it bubbles, one that finds the
    budget spent by the handlers before it is refused with `FORMA_E_BUDGET`.
  - A handler's `x += s` that would build a string past 1 MiB is refused, as
    `x = x + s` was.
  - What the runtime converts to text is charged as an expression converting it
    would be (FORMA-025), so a value heavier than the budget is not written:
    `data-text` (or `data-bind`, `data-model`) of an array of 20-character
    strings past about 11,360 elements, counting what built it (2.0.3: about
    33,000, where the step budget stops `map`); `data-persist` of a value past
    about 250,000 characters as JSON, which is reported and leaves the stored
    copy as it was; a `data-list` whose row template places a whole object
    (`{item}`) past about 250,000 characters across its rows (2,500 rows of
    100-character records). A string a row places costs a 128th a character,
    so ordinary lists are not affected.

  More is answered than in 2.0.3, too: the non-Latin search, and a string
  method given a long string argument. Rollback: pin 2.0.3.
- **Size** (L-51): measured on `main` with FORMA-132, the CDN runtime grows
  by 1,479 B gzipped (34,061 to 35,540 B) and the hardened runtime by 1,470 B
  (33,072 to 34,542 B); their gates rise from 34,500 to 36,000 B and from
  33,500 to 35,000 B. This change leaves the core entry and the browser ESM
  bundle as they were.
- **What core writes of its own passes Trusted Types, and its raw sinks take
  them** (FORMA-126, FORMA-127; DR-19, DR-20). Under a page policy with
  `require-trusted-types-for 'script'`, which forma-server 0.2.2 sends as
  Report-Only and 3.0.0 enforces, a string written to an HTML or script sink
  is reported, and refused where enforced.
  - `mount()`, the function it returns, and a reactive
    `dangerouslySetInnerHTML` that becomes `null` emptied an element with
    `innerHTML = ''`; they now call `replaceChildren()`, which no policy
    checks.
  - The raw sinks (`dangerouslySetInnerHTML`, `setHTMLUnsafe()`, `template()`
    and `templateMany()`, the runtime's `reconcile()`, and a `srcdoc` value on
    `h()`, in adoption and in `./ssr`) write a `trustedHtml()` value as the
    `TrustedHTML` it is. Anything else is written exactly as before: a string,
    and a non-string where the sink converted one (`setHTMLUnsafe()`,
    `template()`, `srcdoc`); `dangerouslySetInnerHTML` and `reconcile()` still
    refuse a non-string with a `TypeError`.
  - Only a trusted `srcdoc` is written as itself. An attribute value is
    otherwise converted to a string once, for the URL guard and the write
    alike (formajs#29's review, B1: an object whose string changed between
    the two would have written `javascript:`).
  - `reconcile()` trims what it is given before parsing it, so markup that
    arrived as a browser `TrustedHTML` is minted again, trimmed, through core's
    second policy, `forma-runtime`, and parsed by it; a string is never
    minted. The diff of trusted markup mints a changed `srcdoc` of an iframe
    that markup parsed into, and writes no `on*` attribute or script `src` (or
    `href`): a changed one is removed, as h() and adoption write no `on*` name.
    The diff of a string writes every changed attribute, those included, as
    2.0.3 did (formajs#29's second review, R1: L-18). It records
    markup as current only once the write succeeded, so after a write the page
    refused, the same markup as `trustedHtml()` is not skipped as unchanged.
  - Each policy is made once per page, on first use, since an enforcing page
    refuses a second policy of one name, and every copy of core on the page
    (the runtime's IIFE beside core's ESM build) shares it through a registry
    on `globalThis` (`Symbol.for('@getforma/core#trusted-types')`, a record
    with no prototype). The registry holds no policy object: it holds the mint
    `trustedHtml()` is, which a consumer's SR8 lint lists as a raw entry, and
    a `forma-runtime` parser that takes only a browser `TrustedHTML`, so on an
    enforcing page no script can mint a `forma-runtime` value from a string.
    If the page refuses
    a name, core writes strings (which the page then refuses), and a
    development build logs `FORMA_W_TT_POLICY_REFUSED` once per name. An
    element clobbered onto `window.trustedTypes` is not taken for Trusted
    Types.
  - In Chromium, Firefox and WebKit, served with `require-trusted-types-for
    'script'; trusted-types forma forma-runtime` Report-Only and enforced,
    core's own test pages and every raw sink given `trustedHtml()` raise no
    violation, a `reconcile()` diff that changes an iframe's `srcdoc` and a
    button's `onclick` included; a string written to `innerHTML` raises one
    report and still renders under Report-Only (`e2e/trusted-types.spec.ts`).
  - Not covered: the HTML runtime's own `srcdoc` bindings
    (`data-bind:srcdoc`, `{item…}` in a list row's `srcdoc`) write an
    expression's value or a row's data as a string that such a page reports or
    refuses; see *Deprecated*.
- **Size** (L-51, FORMA-126 and FORMA-127), measured against `main` with
  FORMA-123 and FORMA-169: `trustedHtml()`, the two policies, the typed
  `reconcile()` and its parser grow the CDN runtime by 834 B gzipped (35,540
  to 36,374 B) and the hardened runtime by 854 B (34,542 to 35,396 B). Both
  passed their gates, which rise to the measured size rounded up to the next
  500 B: 36,000 to 36,500 B and 35,000 to 35,500 B (`scripts/check-size.mjs`,
  the README's size table). The core entry grows by 509 B (28,776 to 29,285 B
  of its 30,000 B gate) and the browser ESM bundle by 517 B (27,626 to
  28,143 B of 29,000 B); the runtime's parser is a module of its own
  (`src/dom/runtime-parser.ts`) that only `reconcile()` imports, so the core
  entry does not carry it. The production files that changed are the ones that
  reach a raw sink: the entries `index`, `runtime`, `runtime-hardened` and
  `ssr/index` (ESM and CJS), the shared chunks holding the DOM and the URL
  checks (which now hold `trustedHtml()` too), and the CDN bundles; `http`,
  `server`, `storage`, `tc39-compat`, `wasm` and the reactive chunks are
  byte-identical. No development warning reaches a production artifact: each
  sits behind the build flag inside `src/dom/trusted-html.ts`, which the build
  folds in every artifact and chunk.

### Added

- **`browserOnly(component)`, the browser-only marker** (DR-1, L-1, FORMA-119).
  Wraps a component that renders in the browser alone; one name, so a search
  finds every use. `@getforma/compiler` 0.3.7 and later emit
  `const X = browserOnly(Impl)` as a registered island whose server output is
  its empty host element with its declared props (`data-forma-props`).
  Registered as it is (`activateIslands({ X })`), activation calls it with the
  island's element and props, and it renders `Impl(props)` in the host's place;
  called as a component in a client-rendered tree it renders `Impl(props)`;
  with no document it renders nothing. Additive: no existing export changes.
  The core entry grows 103 B gzipped (27,703 to 27,806 B of its 30,000 B gate)
  and the browser ESM bundle 99 B; the CDN runtimes do not change.
- **A development build, behind the `development` export condition**
  (FORMA-169; L-18's A2 bridge, whose old paths "warn in development builds").
  Every published file folds `__DEV__` to `false`, so no development warning
  in core reached anyone who installed the package: not FORMA-131's
  deprecations, not the hydration-mismatch, dropped-prop or raw-HTML-sink
  warnings. Each `exports` subpath's `import` and `require` branch now has a
  `development` key, after `types` and before `default`, that selects a twin
  of its file under `dist/dev/`: the same sources and options, with `__DEV__`
  folded to `true`. The type declarations are shared. Vite's dev server,
  webpack in development mode, Vitest and Bun's bundler select it by
  themselves; esbuild with `conditions: ['development', 'module']`, Rollup with
  `exportConditions: ['development']`, Node with `--conditions=development`,
  and `@getforma/build` in watch mode (forma-tools, FORMA-169).
  `docs/CDN-AND-EXPORTS.md` (*Development build*) has every resolver checked,
  and `docs/STABILITY.md` (*Development builds*) says the CDN bundles have no
  development build. Additive; rollback is removing the condition.
  - **Test suites log core's warnings.** Vitest (4 and 5) asks for
    `development` by default, for a test's own imports and for the
    dependencies it leaves to Node, so a suite on this release loads the
    development build and its output shows `[forma]` warnings; a suite that
    fails on console output fails on them. To keep a suite on production, run
    it with `NODE_ENV=production`, or drop the condition with the
    `configEnvironment` plugin in `docs/CDN-AND-EXPORTS.md` (*Vitest*).
    Setting `resolve.conditions` or `ssr.resolve.conditions` does not do it:
    Vitest appends its own list, which carries the condition.
  - **Bun's bundler selects it even when minifying.** `bun build --minify`
    and `Bun.build({ minify: true })` ship `dist/dev/` unless given
    `--production` or `NODE_ENV=production`; that is Bun's convention, and
    the package cannot override it.
  - **Production is unchanged.** A resolver that does not ask for the
    condition resolves the same files as before, and all 87 production files
    under `dist/`, maps and declarations included, are byte-identical to
    `main`'s build before this change. `node scripts/dist-baseline.mjs [ref]`
    (new, `npm run check:baseline`) builds a ref in a temporary worktree and
    compares, through `scripts/verify-dist.mjs --baseline`. No size gate moves.
  - **Package size** (`npm pack`, against `main` at FORMA-123's merge):
    1,477,609 to 1,656,308 B packed (+178,699 B, +12.1%), 5,978,199 to
    6,783,862 B unpacked (+805,663 B, +13.5%), 90 to 120 files. The
    JavaScript behind `exports` (802,129 B) ships twice. The twins carry no
    source maps, which would have added another 2.7 MB unpacked (0.64 MB
    packed): their code keeps its names and one statement a line. A
    development bundle's own source map therefore reaches core's `dist/dev/`
    files, not its TypeScript sources.
  - **One build per process.** A resolver applies one set of conditions to
    every specifier, and a development file imports only development files,
    so one resolver loads one copy of core's reactive state. Two resolvers in
    one process that disagree (Vite's server-side rendering with
    `ssr.resolve.externalConditions: ['development']` while Node loads an
    external dependency without `--conditions=development`) load both
    builds, and the existing duplicate-instance warning says so. A bundler
    that inlines core while Node loads it for an external dependency (Vite's
    `ssr.noExternal`, Vitest's `server.deps.inline`) loaded two copies before
    this change and still does; only which build each copy is can differ.
    `sideEffects` lists the twins' runtime files and chunks as it lists
    production's.
  - **Checks.** `scripts/verify-dist.mjs` fails a build in which a subpath's
    branch lacks its twin or orders it after `default`, a twin is
    byte-identical to its production file, a development graph reaches a
    production file or the reverse, a production file binds `__DEV__` to
    anything but `false` or a development one to anything but `true`, a
    deprecation code is missing from a development entry, or Node, with and
    without `--conditions=development`, resolves any subpath, imported or
    required, to the wrong file. `npm run check:pack` also runs publint and
    attw over a copy of the package whose development leaves replace the
    defaults (`scripts/check-pack-development.mjs`), since attw takes no
    conditions.
  - Tests: `src/__tests__/development-build.test.ts` (the real tsup configs,
    built into a scratch package and resolved by Node) > "every subpath
    resolves to production files without the condition and to their
    development twins with it", "a process resolving with the development
    condition loads one copy of core, and it is the development build", "a
    process resolving without the condition loads one copy of core, and it is
    the production build", "a process that loads both builds is told so by the
    duplicate-instance warning"; `src/__tests__/build-config.test.ts` >
    "builds a development twin of every config the exports map reaches,
    differing only in the dev flag, the directory and the declarations", and
    "hard-defines the dev flag in every artifact", "keeps dependencies external
    for the Node-facing entries" and "ships a build entry for every dist file
    the exports map promises", extended to the twins;
    `src/__tests__/package-exports.test.ts` > "gives every import/require
    condition a development twin between types and default". The ticket's
    acceptance test, in Chromium on every merge (and Firefox and WebKit before
    a release): `e2e/development-build.spec.ts` packs the package, bundles one
    application from the tarball with esbuild twice, and loads each: "a
    development bundle of the packed package resolves the development build
    and logs a known warning once", "a production bundle of the same
    application resolves the production files and logs nothing".
- **`trustedHtml(markup)`, the one raw-HTML entry** (DR-19, L-37, FORMA-126),
  exported from `@getforma/core` and `@getforma/core/runtime`
  (`FormaRuntime.trustedHtml` in the CDN bundles), with its type `TrustedHtml`.
  Every raw sink takes it beside a string: one name, so a search, or a
  consumer's CI allowlist (SR8), finds every raw entry. Where the browser has
  Trusted Types it returns a `TrustedHTML` made by Forma's policy `forma`;
  elsewhere a frozen stand-in that core's sinks recognise and write as its
  markup. A `TrustedHTML` from an application's own policy is accepted too.
  It sanitizes nothing. `./ssr`'s renderers write its markup as they write a
  string. `template()` and `templateMany()` are now documented as raw sinks
  (`docs/API.md`, `SECURITY.md`), and `CSP.md` gains a Trusted Types section.
  Additive: every sink still takes a string.

### Changed

- **List adoption fails the island on a row-count mismatch instead of deleting
  rows** (FORMA-123, DR-8). Server rows without `data-forma-key` are matched by
  index. Before, a client array shorter than the server's rows had the extra
  rows removed and a longer one had rows rendered fresh, silently (ksx's #5 lost
  the server rows absent from a list's array before its state was seeded). Now,
  when the counts differ (including an empty array, or an empty server region
  with items), no row is adopted, removed or rendered: the island keeps the
  server's rows and is marked `error`, and `FORMA_E_HYDRATE_LIST_COUNT`, naming
  both counts, is logged in every build and passed to `onError` handlers
  (source `'hydration'`). An island in `error` is inert: the listeners attached
  during adoption are removed, on the server's elements and on any adoption
  built through `h()` before the failure, and the bindings it adopted are
  disposed, also for a direct `hydrateIsland()` caller whose root lives on.
  This holds for any adoption that fails part-way.
  **Adoption now runs in a batch.** A signal written during adoption (in a
  `ref`, say) takes its new value at once, but the effects that write triggers
  in other islands or roots run when the walk ends, not during it. Adoption's
  own bindings still run when they are created. So a failing island detaches
  nothing that another island or `mount()` root built. Such a root's new rows
  are no longer owned by the failing island either; before, they were disposed
  with it, also on 2.0.x for an island failing by a throwing reactive child. Nodes adoption replaced or
  added before the failing list (a tag mismatch, a fresh keyed row) stay as it
  left them. `mount()` and `hydrateIsland()` keep `data-forma-ssr` and do not
  throw, as for `FORMA_E_HYDRATE_NODE`. Equal counts adopt as before, and rows
  that carry `data-forma-key` keep matching by key. Applications whose state
  reaches the island from the server's data see no change.
  **Migration:** the server writes an empty list region when the list's data
  is not an array, so a list the client computes for itself inside a
  server-rendered island was rendered fresh on 2.0.x and now leaves the island
  inert. Start that list's signal empty and fill it after activation (an empty
  array adopts the empty region), or render the list in the browser only.
  Core's ESM entry grows by 365 B gzipped (28,411 to 28,776 B, gate 30,000 B
  unchanged) and the CDN ESM bundle by 323 B (27,303 to 27,626 B, gate
  29,000 B). A page with one island, bundled from the core entry with esbuild
  (minified, gzip -9) as DR-35 counts N2, grows by about 205 B (a counter from
  12,595 to 12,801 B). The CDN runtimes do not include adoption; each shrinks by
  8 B, because a module-level `Symbol.for` call in the adoption code, kept in
  their bundles as a side effect, is gone.
- **`createWebSocket` reconnects with full jitter** (FORMA-132, L-46). The n-th
  reconnect used to wait exactly `reconnectInterval * 2^(n-1)`, so after a
  deploy every client of a server reconnected in the same instant. The delay is
  now drawn uniformly between 0 and that cap, still for at most
  `maxReconnects` (5) attempts, and a successful open still restarts the count.
  A new option, `random`, replaces `Math.random` as the source of the draw (a
  test passes a seeded one); a value that is not a function, or a draw outside
  [0, 1), falls back to `Math.random`.
- **`data-fetch` aborts a request after 30 seconds** (FORMA-132, L-46),
  `createFetch`'s default timeout. Before, a request the server never answered
  held its `loading:` target true forever. Now the abort lands in the `error:`
  target as `data-fetch timed out after 30000 ms` in every engine (WebKit
  rejects an aborted fetch with its own message, so the runtime writes this
  one; `createFetch` reports no error on its timeout), and `loading:` turns
  false. Each request of a `poll:` fetch has its own 30 seconds. Tearing a
  scope down (`unmount()`, or removing its element) clears each in-flight
  request's timer and aborts it. A shorter timeout
  granted per mount comes with the tiered mount (FORMA-128).
  **Size (L-51):** the CDN runtime grows by 200 B gzipped (33,861 to 34,061 B)
  and the hardened runtime by 199 B (32,873 to 33,072 B). Both passed their
  gates, which rise to the measured size rounded up to the next 500 B: 34,000
  to 34,500 B and 33,000 to 33,500 B (`scripts/check-size.mjs`, the README's
  size table).

### Deprecated

- **A value that is not `trustedHtml()` given to a raw sink, the HTML
  runtime's `srcdoc` bindings, and `h('script')`** (DR-19, L-18, FORMA-126).
  All keep working through 2.x, written exactly as before, and 3.0.0 refuses
  them (FORMA-109). In a development build the first such value each sink
  receives (a string, a look-alike object or a `String` object) logs one
  coded line: `FORMA_W_RAW_INNER_HTML` (`dangerouslySetInnerHTML`),
  `FORMA_W_RAW_SET_HTML` (`setHTMLUnsafe()`), `FORMA_W_RAW_TEMPLATE`
  (`template()`, `templateMany()`), `FORMA_W_RAW_RECONCILE` (`reconcile()`)
  and `FORMA_W_RAW_SRCDOC` (`srcdoc`, on h(), in adoption and in `./ssr`), as
  `[forma] FORMA_W_RAW_SRCDOC: …`. The runtime's `data-bind:srcdoc`, and
  `{item…}` in a list row's `srcdoc`, write an expression's value or a row's
  data as a document, a raw entry no `trustedHtml()` can reach: they stay
  strings and log `FORMA_W_RAW_RUNTIME_SRCDOC`. `h('script')` logs
  `FORMA_W_SCRIPT_ELEMENT` once. Each is logged once per page or process,
  whichever copy of core asks. `docs/STABILITY.md` lists what replaces each
  under *Deprecated forms*. The `srcdoc` line replaces the uncoded warning
  `h()`, adoption and `./ssr`'s `renderToString` logged for every `srcdoc`,
  `trustedHtml()` or not.
  The development build (FORMA-169) carries them, so an application bundled
  from the npm package in development logs them; production builds carry
  none, and `scripts/verify-dist.mjs` fails a build in which a production
  file holds one or a development entry lacks one. The CDN bundles have no
  development build, so a page loading the runtime from a CDN logs none.
  - Tests: `src/dom/__tests__/trusted-html.test.ts` (twenty-one, under a
    simulated Trusted Types engine where it matters, among them "a string to
    each raw sink still renders, and warns once with the sink's code in
    development", "core's own writes raise no Trusted Types violation: mount,
    unmount, the null clear, and every sink given trustedHtml()", "reconcile()'s
    diff mints a changed srcdoc of trusted markup and writes no on* or script
    src", "a string reconcile()'s diff writes a changed on*, script src and
    srcdoc as 2.0 did" and "the shared registry holds no policy, and its forma-runtime handle
    mints nothing from a string"); `src/__tests__/renderer-contract.test.ts` >
    "writes %s as the string the URL guard checked, not a second conversion"
    (static, reactive, adoption and SSR); `src/__tests__/runtime-srcdoc.test.ts`
    (three); `src/dom/__tests__/trusted-html-build.test.ts` > "a production
    build carries none of the raw-HTML warnings, in any artifact" (the real
    tsup configs) and its control; `e2e/trusted-types.spec.ts` (fifteen per
    engine); `e2e/development-build.spec.ts` > "a development bundle of the
    packed package logs a string at a raw sink once, with its code, and
    trustedHtml() never".
- **`@getforma/core/server`, `@getforma/core/ssr` and `@getforma/core/wasm`
  are deprecated, and are removed in 3.0.0** (FORMA-131; DR-22 to DR-24). They
  keep working through 2.x. Server functions give way to routes in the
  application's Rust server, `./ssr` to the Rust walker, and `./wasm` to
  core's `h()`, which islands already re-render with. `docs/STABILITY.md` marks
  each row **Deprecated** and lists the codes under *Deprecated entry points*;
  `SECURITY.md` and `docs/CDN-AND-EXPORTS.md` mark the entries too.
  - The first time one of them is loaded where core runs from source, it logs
    one line with a stable code: `FORMA_W_DEPRECATED_SERVER`,
    `FORMA_W_DEPRECATED_SSR` or `FORMA_W_DEPRECATED_WASM`, as
    `[forma] FORMA_W_DEPRECATED_SSR: …`, naming 3.0.0 and the replacement. Once
    per process: a second copy of the module stays quiet.
  - The line logs only in a development build, as every `__DEV__` diagnostic
    does: the installed package resolved with the `development` condition
    (FORMA-169, under *Added*), or core from source (in Node with `NODE_ENV`
    other than `production`, in a browser with the global `__FORMA_DEV__`
    set). The production files log nothing. An installed package also shows
    the deprecation in its types: every function the three entries export
    carries `@deprecated`.
    Every `.js` and `.cjs` file under `dist/` is byte-identical to the build
    before this change (all 33), so no size gate moved; the files that differ
    are the three entries' type declarations and their source maps.
  - The deprecated SSR row links to *SSR form controls* (FORMA-017) for how
    `./ssr` differs from the walker, which that section states; it is no
    longer a row of its own.
  - `scripts/verify-dist.mjs` fails a build in which a deprecation code reaches
    any published artifact.
  - Tests: `src/__tests__/deprecated-entries.test.ts` > "$subpath logs its
    deprecation once in development, with its code", "$subpath stays quiet when
    NODE_ENV is production", "decides a development build as __DEV__ does,
    under every NODE_ENV", "a production build of each deprecated entry carries
    no warning" (the real tsup configs) and its control, "a build without the
    production flag keeps the warning". The exact export-surface test still
    lists all three entries until 3.0.0 removes them.

### Fixed

- **A reactive `dangerouslySetInnerHTML` is adopted as content, and A → null
  → A shows A again** (FORMA-176; DR-5, DR-9, DR-19). Adoption treated the
  prop as an attribute: a reactive one wrote `dangerouslysetinnerhtml="[object
  Object]"` and never touched the content, where client rendering writes it,
  and a static one was skipped though the walker ships such an element empty.
  It now binds the prop as h() does, through one writer
  (`bindInnerHTML` in `src/dom/element.ts`): the content through the raw sink
  (a `trustedHtml()` value typed, a string with `FORMA_W_RAW_INNER_HTML` in
  development), never an attribute, writing nothing where the server's element
  already holds the markup, and not walking that markup as children. And a
  reactive value going A → null → A left the element empty, in h() as in
  adoption: the `null` branch kept A's markup as the current one, so A again
  read as no change; `null` now forgets it. Tests:
  `src/dom/__tests__/adopt-inner-html.test.ts` (eight: both server outputs,
  the walker's empty element and `./ssr`'s markup, matched against client
  rendering through every transition; no write where the server agrees; the
  string warning); `src/dom/__tests__/trusted-html.test.ts` > "an adopted
  island's dangerouslySetInnerHTML writes trustedHtml() typed, as content and
  never as an attribute"; `e2e/adoption.spec.ts` > "a reactive
  dangerouslySetInnerHTML is adopted as content, follows its signal through
  null and back, and matches client rendering", and the Trusted Types sink
  test's adopted island, in Chromium, Firefox and WebKit. Size: the core entry
  grows by 100 B gzipped (29,285 to 29,385 B of its 30,000 B gate) and the
  browser ESM bundle by 92 B (28,143 to 28,235 B); the CDN runtimes, which do
  not adopt, do not change.
- **SVG and MathML namespaces where `h()` knows the parent** (FORMA-026,
  DR-9). A tag that is both HTML and SVG (`title`, `a`, `script`, `style`,
  `font`) now takes the namespace of the content it is built in. Where its
  parent is known, that is the parent's, as the HTML parser gives it: a
  reactive child, a `createShow` branch, `createList` row or `createSwitch`
  case rendered once the helper is in the document, a portal into an SVG,
  `mount()` into an SVG element, and what adoption creates (a show branch it
  repairs, a fresh keyed row). Before, all of these created such a tag as
  HTML inside an SVG. Content at the parser's HTML integration points is HTML:
  a `foreignObject`, `desc` or `title`, a MathML token element, an HTML
  `annotation-xml`. `h()` also creates MathML Core's elements (`math`,
  `mrow`, `mi`, …) in MathML, and more SVG names (`feDropShadow`, `mpath`,
  `view`, the remaining filter primitives) in SVG.
  A child passed to `h()` is still built before its parent exists. In
  `h('svg', null, h('title'))` the `title` is HTML, as before; build such a
  tree inside `svg()`, where a helper's first render is SVG too. Shared namespace vectors (`src/__tests__/vectors/namespaces.json`)
  run through `h()`, `renderToString`, and each browser's parser and adoption
  in Chromium, Firefox and WebKit.
  **Size (L-51, DR-35):** core's ESM entry grows by 605 B gzipped (27,806 to
  28,411 B, gate 30,000 B) and the CDN ESM bundle by 568 B (26,725 to
  27,293 B, gate 29,000 B); no gate is passed and none rises. A page with one
  island, bundled from the core entry with esbuild (minified, gzip -9) as
  DR-35 counts N2, grows by about 456 B: a counter from 12,139 to 12,595 B,
  a page with a `createShow` and a `createList` from 12,210 to 12,668 B. The
  CDN runtimes build nothing through `h()` and shrink by 12 B and 13 B.

### Documentation

- **`docs/ISLANDS.md` states what adoption skips today** (FORMA-016): a plain
  array child (`.map()` without `createList`), `createErrorBoundary`,
  `createSwitch`, `createPortal` and `createSuspense`, and a reactive child
  that returns an element; what a server-rendered page gets with each,
  measured in Chromium (on a `mount()` root, `createErrorBoundary`,
  `createSwitch` and `createSuspense` make activation throw and nothing after
  them activates; `createPortal`'s content never appears; a reactive `.map()`
  shows its elements as `[object HTMLLIElement]` text), the build code
  compiler 0.3.7 reports for it, and what to write instead. It also documents
  `browserOnly()`.
- **`./ssr`'s form controls are documented as a known gap** (FORMA-017, DR-24).
  `renderToString` writes a `textarea`'s and a `select`'s `value` as a `value`
  attribute, which the HTML parser ignores, where forma-ir 0.2.1 writes the
  textarea's text and `selected` on the option. The renderer is unchanged
  until `./ssr` is removed in 3.0.0; `docs/STABILITY.md` says what the served
  page shows and how to write these controls instead, and two tests pin it.
- `docs/STABILITY.md`'s footnote on `./wasm` said the subpath first resolves
  "in the next release". It first resolved in 2.0.0 (npm's 1.5.0 has no
  `./wasm` key; 2.0.0 has it), and the footnote now says so.

### CI

- **Actions pinned to commits; every job declares its token** (DR-32, SR21,
  FORMA-010). Each `uses:` names the commit its tag pointed to on 2026-10-14,
  with the tag in a comment, so moving a tag no longer changes what runs. Every
  job in `ci.yml` declares `contents: read`; `release.yml`, `docs.yml` and
  `e2e-engines.yml` already declared their permissions and keep them. Every
  install was already `npm ci`. The published package is unchanged.
- **Only the release's publish job can mint the publish credential** (SR43,
  L-34, L-42, FORMA-134). `release.yml` splits into `engines`, `test`, `pack`
  and `publish`. Tests and builds run in jobs without `id-token: write`; `pack`
  restores no cache, packs the tarball and records its SHA-256; `publish`, the
  only job holding `id-token: write`, restores no cache and installs nothing,
  checks the downloaded tarball against that record (whose own hash travels as
  a job output) and runs `npm publish <tarball> --provenance --ignore-scripts`.
  The create-forma-app dispatch moves to a `notify` job with no permissions.
  The tag stays the only trigger. CI's new `release-workflow` job runs
  actionlint (binary checked against a pinned SHA-256),
  `scripts/check-release-workflow.rb --self-test` and
  `scripts/test-release-artifacts.sh`. The published package is unchanged.
  The lint also refuses a publish job that could go on after a failed check
  (`continue-on-error`, an `if:` on a step up to the publish, `always()`,
  `failure()` or `cancelled()` in the job's `if`, a check line that can
  swallow its failure, a shell without errexit), `container:` or `services:`
  on the publish or pack job, and a checkout of another repository or ref;
  every rule has a seed in `--self-test`, which fails if one does not. The
  artefact test flips a byte instead of writing one that may already be there.

## [2.0.3] - 2026-10-14

### Security

- **A built-in call in an expression is charged before it runs** (FORMA-004,
  DR-16). `Array.from({length: 12000000})` used to build a 139 MB array in a
  300 ms task and only then be refused; it now costs nothing. Every allowlisted
  native is charged, against one budget per evaluation (`LIMITS.ALLOC_BUDGET`,
  250,000 units, one unit being about an `Array.from` slot), the weight of its
  arguments as text (or, for the natives that read arguments as data, such as
  `Object.keys`, `Array.from` and `concat`, their element count) and then its
  row in `src/expr/cost.ts`, and is refused with `FORMA_E_BUDGET` before it runs
  once the evaluation would pass the budget. Rows that copy or produce cost a
  unit per element; string rows that amplify nothing are weighted by their
  measured cost per character, tiered by the costliest character of the text:
  lowercasing Latin-1 and the self-mapping punctuation, currency and
  letterlike symbols costs 1/32 of a unit a character and any other text 1/2;
  uppercasing ASCII 1/16, Latin-1 and those symbols 1/2, any other text 1; a
  string search 1/32; `slice` 1/64.
  An operator that converts an array or object to text (`'' + list`,
  `` `${list}` ``, `list < 1`, `x += list`, a write to `$el`) is charged the
  same way; `x != null` and object-to-object `==` convert nothing and are not.
  The budget is sized from the tail of measurements at 4x CPU throttling with
  garbage collection counted (`scripts/measure-alloc-budget.mjs`): the slowest
  of 41 runs of the largest call any row allows took 46.6 ms (a text search
  over 9,000 records with a curly apostrophe in each; 48.0 ms at most over 81
  runs with a dash), and an evaluation that spends the budget and then exhausts
  the step budget 23.7 ms. These figures hold for strings stored one byte a
  character, and for that search's two-byte records. A string stored two bytes
  a character costs about four times its charge: one `toLowerCase` of 8 million
  such characters took 108 ms median and 115 ms at most, refused only
  afterwards by the 1 MiB result cap, and seven calls on 1 million characters
  in one evaluation 92 ms, answered. This is listed under FORMA-028. The cost
  check itself takes time: the repository's expression benchmarks
  (`scripts/bench.mjs --file expression`, 5 runs against 2.0.2) are within
  noise, but a string-heavy filter pays for it. The text search over 9,000
  records, in Chromium at 4x, went from 22.4 to 29.5 ms median for ASCII
  (+32%), and from about 28 to 42 or 43 ms median (49 ms at most) with one `’`
  in each record (about +50%). Its 9,100-record form, refused by the step
  budget as in 2.0.2, runs 43 ms median and 65 ms at most before the refusal.
  About half the added time is the two-byte tier scan, the rest the per-call
  check (about 0.4 µs a call at 4x). The bound is **per evaluation** (one
  binding or one handler run), not per task: a widget with many bindings can
  spend one budget in each; a per-task (per-widget) budget is a design change,
  left to a follow-up ticket. Not yet bounded (FORMA-028; SECURITY.md,
  "Termination and budgets"): string `+`, template literals, reads of a long
  concatenated string, and a string search whose pattern's first characters
  fill the text (`'ab'` in `'aaaa…'`, 39 ns a character where ordinary text
  takes under 1).
- **Behaviour change: what one binding or handler can no longer compute.** As
  DR-16 accepts, the budget refuses, with `FORMA_E_BUDGET`, some evaluations
  2.0.2 answered. Measured with this release's engine and 2.0.2's on the same
  data:
  - **String work per record in a callback counts toward the one budget.** The
    text filter `rows.filter(r => (r.title + ' ' + r.body).toLowerCase().includes(q))`
    over records of about 260 characters:
    - is answered as in 2.0.2, up to about 9,090 records (where the step
      budget stops both releases), when every character of the records is
      Latin-1 or one of the punctuation, currency and letterlike symbols that
      map to themselves (U+2000 to U+20CF, U+2100 to U+2125): ASCII, `é`, curly
      quotes `’ “ ”`, dashes `– —`, `…`, `€`, `™`, `№`;
    - is refused past about 1,716 records, where 2.0.2 answered about 9,090,
      when each record holds any other character above U+00FF: a Greek,
      Cyrillic or CJK character, a Latin Extended letter such as `č`, `ł` or
      `ő`, Turkish `İ` or `ı`, an emoji, or a symbol with a case mapping such as
      the Ohm sign (U+2126). Such text measured up to about 43 ns a character
      to lowercase, against 2 ns for Latin-1.
  - A default `sort()` of more than about 6,400 strings or numbers, counting
    everything else the evaluation does (2.0.2 had no limit).
  - `rows.map(r => r.name).join(', ')` past about 18,000 rows (2.0.2: about
    33,000, where the step budget stops it).
  - `Object.keys`, `values` or `entries` of more than about 15,600 keys or
    characters.
  - `every`, `some` or `reduce` over more than 250,000 elements, even when the
    callback would stop at the first.
  - A built-in that produces a string or array longer than 250,000, such as
    `Array.from({length: 300000})` (the 1 MiB and 1,000,000-element result caps
    still apply to `+` and template literals).
  - A handler write that would grow an array past 250,000 elements, such as
    `items[999999] = x`.
  - `padStart` / `padEnd` with a negative or non-numeric length now return the
    string unpadded, as JavaScript does, instead of `FORMA_E_BUDGET`.

  Rollback: pin 2.0.2.
- **Island props are stripped of `__proto__`, `constructor` and `prototype` at
  every depth while they are parsed** (FORMA-004, DR-21), inline and shared,
  with no opt-out. 2.0.1 stripped the top level only, so a nested key reached
  any island that deep-merged its props. The pass is iterative (a JSON reviver
  would overflow the stack near 5,000 levels); `sanitizePropsDeep` stays
  exported. The strip also drops legitimate nested fields named `constructor`
  or `prototype` (a standings table keyed `constructor`, say): DR-21 accepts
  this; rename such fields on the server. Props that are valid JSON but
  neither an object nor an array (`null`, a number, a string, a boolean),
  inline or in the shared block, mark the island `error` as they did in 2.0.1,
  now with the coded message
  `FORMA_E_ISLAND_PROPS` logged in every build (2.0.1 threw an uncoded
  `TypeError`, logged in development builds only). An array reaches the island,
  as before, stripped at every depth. Rollback: pin 2.0.2.

## [2.0.2] - 2026-10-14

### Changed

- **Bound `value`, `checked` and `selected` are live properties.** `h()` and
  adoption write them to the control itself, not only to its attribute, and a
  `select` is bound after its options exist. A bound `value` on a `select` or
  `textarea` now reaches the control; before, it never did. A controlled input
  therefore follows its signal after the user edits it: an update replaces what
  they typed, where 2.0.1 changed only an attribute the browser ignores once a
  control is edited. An option's value stays its attribute, so an option bound
  to `undefined` or `null` still submits its text. (Local checkpoint `042e353`.)
- **`updateOnItemChange: 'rerender'` replaces a changed row.** A same-key row
  whose item object changed is rendered again in a fresh reactive scope, and
  the new element replaces the old one; the old row's effects are disposed.
  Before, static rows were patched in place and rows with bindings were not
  re-rendered at all. Refs and focus inside a changed row do not carry over.
  Unchanged items and keyed moves keep their DOM. `reconcileList`'s own contract
  is unchanged: a node returned by its `updateFn` is ignored. (Local checkpoint
  `042e353`.)
- **A component that returns a detached DOM node while hydrating is reported.**
  2.0.1 counted it as adopted and removed `data-forma-ssr` with nothing bound.
  Now the error `FORMA_E_HYDRATE_NODE` is logged in every build and passed to
  `onError` handlers (source `'hydration'`), and the server's DOM stays as
  served: `activateIslands` marks that island `error`, and `mount()` and
  `hydrateIsland()` keep `data-forma-ssr` (`mount()` also disposes the
  component's effects; a direct `hydrateIsland()` caller owns its root). Neither
  throws. Returning the island's own element, a node inside it, or a fragment
  the component already appended into it (now empty) works as in 2.0.1.

### Fixed

- **A Fragment is adopted.** `h(Fragment, …)` and `fragment(…)` return a
  descriptor while hydrating, and adoption walks a Fragment's children in place,
  at a `mount()` or island root, inside an element and as a `createShow` branch.
  A root JSX Fragment was inert after server-rendered activation. A root
  `createShow` or `createList` with no wrapping element is adopted too.
- **Adoption keeps what the user entered before activation.** A control whose
  live state differs from its markup's default (`value` from `defaultValue`,
  `checked` from the `checked` attribute, a select from its `selected` options)
  is not written at adoption, and a control that already holds the client's
  value is not written at all. Updates after activation are still written.
- **`textarea` and `title` text is bound by the element, not by markers,** to
  match forma-ir 0.2.1, which writes no markers inside RCDATA elements. A
  textarea's reactive text stays its default value, client-rendered or adopted,
  as in 2.0.1. For one release the marker text older servers write inside these
  elements (and the zero-width space they write for empty text) is also
  accepted, and removed on adoption when it accounts for the whole difference
  from the client's text.
- **Inline SVG and MathML are adopted, not rebuilt.** Adoption compared an
  element's `tagName` with the component's tag upper-cased, but the parser keeps
  an SVG or MathML tag's case (`svg`, `clipPath`), so every inline SVG was taken
  for a mismatch and replaced at activation, with whatever focus or state it
  held, and the replacement's `title` or `a` was an HTML element (an icon lost
  its accessible name). Adoption now matches a foreign element by its exact
  `localName`, and an HTML element in any case, as before. Where adoption must
  create an element (the server rendered another tag, or nothing) inside SVG or
  MathML, it creates it in that namespace with `createElementNS`; inside a
  `foreignObject` it creates HTML. (FORMA-020)
- **A reactive attribute the server already holds is not written at
  adoption.** Adoption set every bound attribute once, even to the value it
  had, which a `MutationObserver` records and which reloads an `iframe` whose
  `src` is bound. A change is still written. (FORMA-020)
- `createList` with `updateOnItemChange: 'rerender'` disposes a replaced row's
  effects. (Local checkpoint `042e353`.)

### Tests

- Regression fixture for the native-call cost path (FORMA-001, stage 0; DR-16):
  `src/expr/__tests__/native-preflight.test.ts` requires `Array.from({length: 12000000})`
  to be refused with `FORMA_E_BUDGET` (passes today) and to be refused before
  `Array.from` runs. The interpreter checks a native's result only after the
  call returns, so today the array is built first; that case is marked
  `it.fails` until FORMA-004's preflight lands.
- `e2e/csp.spec.ts` detects a CSP violation in Firefox. It read violations from
  console text, and Firefox words them "Content-Security-Policy: …", which the
  pattern missed, so a Firefox run would have passed with violations. It now
  also records the `securitypolicyviolation` event, and a control test proves
  a blocked inline script is seen in each engine. (FORMA-027)

### CI

- **Firefox and WebKit before each release** (DR-9, FORMA-027). The Playwright
  config has `firefox` and `webkit` projects beside `chromium`. A new workflow,
  `e2e-engines.yml`, runs the whole e2e suite in each of the three engines,
  one job per engine; `release.yml` calls it and its `publish` job needs it,
  so a tag publishes only if all three pass on the tagged commit. Run it on a
  branch with `gh workflow run e2e-engines.yml --ref <branch>`. Every merge
  still runs Chromium only: `npm run test:e2e` selects the `chromium` project,
  and `npm run test:e2e:engines` runs all three.

### Documentation

- `docs/ISLANDS.md` no longer says adoption always creates an element in the
  namespace the HTML parser would have used. It names where it does not: the
  content of MathML `mi`, `mo`, `mn`, `ms`, `mtext` and an HTML
  `annotation-xml`, of SVG `title` and `desc`, and HTML elements the parser
  moves out of SVG or MathML. A `foreignObject` is handled. (FORMA-027)

## [2.0.1] - 2026-08-08

### Fixed

- Snapshot an element's attributes before binding colon directives. A synchronous
  `data-bind:*` effect can add or remove an attribute; iterating the browser's live
  `NamedNodeMap` could therefore skip an adjacent `data-class:*` or `data-on:*`
  directive. Forma Vector Studio exposed this integration defect and now has the
  released runtime fix available through npm.
- Declare generated split runtime chunks as side effects and verify those declarations
  against the actual distribution, preventing linked consumers from dropping required
  bare side-effect imports.

## [2.0.0] - 2026-08-06

A hardening release. A five-lens audit of 1.5.0 (docs-vs-behaviour, security,
reactive-core correctness, packaging, downstream contract) produced 38 confirmed
findings; this entry is the result of fixing them. The theme is that several
things the documentation promised were not true of the shipped code — most
importantly the headline CSP promise — so behaviour was changed to match the
promise rather than the other way round.

**If you are upgrading, read "Changed — breaking" first.** The suite went from
1007 tests to 1699 — but the number that moved is the one under "Test suite —
measured, not assumed": the share of injected defects the suite actually
detects.

### Changed — breaking

- **The regex expression parser and the `new Function()` fallback are gone.**
  Every build now evaluates `data-*` expressions with an allowlist AST
  interpreter (`src/expr/`): lexer, precedence-climbing parser, validator,
  tree-walking interpreter. **No shipped artifact contains `eval`,
  `new Function` or `with()`.** `setUnsafeEval()`, `isUnsafeEvalAllowed()`,
  `setUnsafeEvalMode()`, `getUnsafeEvalMode()`, `data-forma-unsafe-eval` and
  `__FORMA_RUNTIME_CONFIG.allowUnsafeEval` are **removed** — there is no
  fallback left for them to control. Code calling them must delete the call.
- **The grammar got bigger, not smaller.** Newly supported, with no
  `'unsafe-eval'`: arrow-function callbacks in `map` / `filter` / `find` /
  `findIndex` / `some` / `every` / `flatMap` / `reduce` / `sort` (the flagship
  README example runs again), object literals, `typeof`, unary `-`,
  general computed member access (`obj[k]`, `items[i + 1]`, `a.b[0].c`),
  member and computed assignment (`item.done = !item.done`, `obj.n += 1`),
  handler statements that are a bare method call (`$el.classList.toggle('x')`,
  `$refs.myInput.focus()`, `$dispatch('selected', {id})`), and the frozen
  namespaces `JSON`, `Object`, `Array`, `Date.now`, `Number`, `String`,
  `Boolean`, `parseInt`, `parseFloat` alongside `Math`.
- **Two silent wrong answers are now correct.** Unary `!` had the LOWEST
  precedence in the regex cascade, so `!a || b` computed `!(a || b)` and
  rendered the wrong value with no diagnostic. The ternary matcher was
  string-blind, so `{ok ? 'https://a' : 'https://b'}` — the commonest
  `data-bind:href` idiom — was rejected because of the `//` inside a string.
- **Three silent `undefined`s are now either working or reported.**
  `{q = $event.target.value}` parsed, emitted no diagnostic and wrote
  `undefined`; it now works. `{JSON.stringify(o)}` and `{Object.keys(o)}`
  parsed and returned `undefined`; they now work. `{items.push(x)}`,
  `{document.title}` and every other denial now report with a stable code
  (`FORMA_E_METHOD_DENIED`, `FORMA_E_UNRESOLVED`, …) and a column, and the
  binding leaves the DOM untouched instead of writing an empty string.
- **An unknown assignment target in a handler is an error, not a no-op.**
  `{coutn = 1}` used to run `scope.setters[name]?.(val)` and do nothing at all;
  it now reports `FORMA_E_ASSIGN_DENIED`.
- **Identifiers that are not declared state are errors.** The regex parser read
  an unknown name as `undefined`. `{missing ?? 'x'}` now requires `missing` to
  be a declared key (a key holding `null`/`undefined` is fine — the error is for
  names that do not exist at all).
- **A `formajs:diagnostic` event now fires once per distinct expression**
  rather than once per occurrence; the running total stays available through
  `getDiagnostics()`. A 1,000-row list sharing one denied expression used to
  dispatch 1,000 events.
- **`h()` now drops props whose name starts with `on` in ANY casing.** Detection
  was a case-sensitive two-character test, so `ONCLICK` / `Onerror` / `ONLOAD`
  skipped `addEventListener` and fell through to `setAttribute`, writing a real
  inline handler that the browser executes (SSR dropped these case-insensitively,
  so spreading server-supplied props produced clean HTML and an executing handler
  on the client). Apps that relied on writing an `ONCLICK` *attribute* break.
- **`h()` and hydration now drop dangerous-scheme URL attributes**, matching what
  the SSR renderer has always dropped: `javascript:`, `vbscript:` and
  `data:text/html` on `href`, `src`, `action`, `formaction`, `xlink:href`,
  `poster`, `background` and `data`. Previously the SSR-blocked payload was
  *re-added* on the client at hydration. A reactive URL binding whose value turns
  dangerous now **removes** the attribute rather than leaving the last accepted
  value.
- **`createStore` refuses `__proto__` / `constructor` / `prototype` writes**
  through both `setState` and the proxy's `set` trap. Previously a `__proto__`
  key — which `JSON.parse` creates as a real own property — replaced the store's
  prototype, letting untrusted JSON forge fields the app never defined.
- **Removed `renderToStringWithHydration`** from `@getforma/core/ssr`. It emitted
  a second, undocumented marker dialect that no client code could enter (adoption
  is driven per-island by `hydrateIsland` from a `data-forma-island` shell), and
  its docstring promised hydration it could not deliver.
- **Removed the `./runtime/global` and `./runtime-csp/global` exports subpaths.**
  The files still ship and still load by URL; they were never resolvable as
  modules, because an IIFE that assigns `var FormaRuntime = …` defines nothing
  when imported.
- **Deleted `dist/formajs.global.js`** (461 KB with its map). An undocumented
  orphan: no README row, no exports subpath, no `sideEffects` entry. Use
  `dist/forma.esm.js` to load the core from a CDN.
- **`engines.node` raised from `>=18` to `>=20.19.0`**, which is what the dev
  toolchain (vite) already required and what CI actually exercises.
- **Show adoption no longer re-inserts the server's DOM after a toggle.** When
  both branches render the same tag, adoption cannot tell which one the server
  produced; the adopted nodes are now dropped on the first swap away and the
  branch is rebuilt from its factory on return. Node identity across a full
  toggle round-trip is gone — that is the price of never guessing.
- **Adopted list rows re-run `renderFn` once at hydration** (in hydration mode:
  descriptors only, no DOM), which is what makes `onClick` and reactive props
  work on server-rendered rows. A `renderFn` with side effects therefore runs
  once on the server and once at adoption.
- **`MarkerMap.show` lost its `cachedContent` field** (public type change): it
  was always `null` and never read.

### Added

- **A hot-path benchmark suite** — `bench/*.bench.ts`, run with `npm run bench`
  (`bench:doc` regenerates the table, `bench:compare` diffs against the committed
  `docs/performance-baseline.json`). It covers signal-write → effect-flush,
  `h()` attribute writes split by which guards they pay for, `createList` render
  and keyed reconciliation, SSR adoption, island activation through both props
  channels, `renderToString`, and the CSP-safe interpreter against the
  `new Function` path it replaced. Every row reports median, p95 and run-to-run
  spread, so a later comparison can tell a regression from noise. Results,
  method, and a per-guard A/B against the pre-hardening tree are in
  [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **Two regressions the hardening introduced are now measured and documented**
  rather than suspected: routing every list-row removal through
  `deactivateIslandsIn` costs ~15 µs per removed row (a `querySelectorAll` per
  row, +206% on a 1000-row teardown), and `handleGenericAttr` running the URL
  scheme check *before* its identity cache costs +50 ns on every no-op reactive
  URL write. Both have named fixes in the doc that keep the safety.
- **`sanitizePropsDeep(props)`** (root entry): strips `__proto__` /
  `constructor` / `prototype` at every depth, iteratively and cycle-safe. Island
  props remain **shallow-sanitized by default** — call this yourself before
  handing props to anything that deep-merges them. RPC arguments are already
  sanitized recursively without an opt-in; the two were previously documented as
  equivalent and are not.
- **`isUnsafeEvalAllowed()`** (`@getforma/core/runtime`): the live answer to
  whether the Function-constructor fallback can run.
- **`data-forma-expr-error="unsupported"`**: client-only DOM marker on an element
  whose expression could not be compiled, mirroring the existing
  `data-forma-handler-error`. Not part of the hydration wire contract; the Rust
  walker does not read it.
- **`activateIslands(registry, root?)`**: optional root, so a Shadow DOM subtree
  can be activated without touching the rest of the document.
- **`dist/forma.esm.js`**: a self-contained browser ESM bundle (alien-signals
  inlined, no code-split chunks), which is what makes the documented
  `<script type="module">` CDN recipe work. The old recipe pointed at
  `dist/index.js`, which imports the bare specifier `"alien-signals"` — a browser
  can resolve neither that nor the chunks. **Do not mix it with the npm entry in
  one app**; it carries its own copy of the core.
- **`@getforma/core/wasm`** is now built, typed and exported. `renderLocal` /
  `renderIsland` were announced as available "via direct import from the
  `@getforma/core/wasm` path" in 0.7.1 but had no build entry, no dist output and
  no exports key from 0.7.1 through 1.5.0, so the import always failed.
- **Duplicate-instance detection**: loading two copies of the core in one process
  (mixing `import`/`require`, or the browser bundle alongside the npm entry) now
  warns once. Signals, the owner tree and both registries are per-copy, so this
  used to present as "my signal updates nothing".
- `$event` and `event` now resolve in the CSP-safe handler parser, so
  `q = $event.target.value` and `if (event.key === 'Enter') { … }` compile with
  no eval. The former used to compile into an assignment of `undefined` with no
  diagnostic at all — silent data loss.
- `scripts/verify-dist.mjs` runs as the last step of `npm run build` and asserts
  properties of the real artifacts: exports targets exist, `require` conditions
  are `.cjs`, the browser bundle is self-contained, Node entries keep deps
  external, `__DEV__` is a literal, the hardened builds contain no
  `new Function`, and each file has at most one sourcemap footer.

### Test suite — measured, not assumed

The suite was mutation-probed one surgical break at a time against a corpus of
93 real defect shapes, now committed at `probes/corpus.json`. It detected
**64%** of them overall, **72%** on security-relevant code and **33%** on
`src/ssr/render.ts` — the one component whose output goes straight into a
browser. Re-run against the same corpus after the work below: **100%**,
**100%**, **100%** (three probes are marked equivalent-by-construction and
excluded, each with its proof written into the corpus entry; counting them as
survivors it is 90/93). Four of the defects the work found were live.

- **A shared renderer contract** (`src/__tests__/renderer-contract.test.ts`).
  FormaJS writes attributes through six independent sinks — SSR
  `renderToString`, `h()` static, `h()` reactive, hydration adoption, the
  `data-bind:` binder, and `$el.setAttribute()` in the CSP-safe grammar — and
  each guarantee used to be asserted thoroughly on exactly one of them. That
  habit produced 7 of the 25 code defects in `docs/archive/2026-08-05-hardening-audit.md`. Dangerous
  URLs (8 vectors x all 8 `URL_ATTRS`), safe-URL negative space, event-handler
  names, attribute-name breakout, boolean-attribute semantics and text escaping
  are now asserted once, parameterised over every sink, with a completeness test
  that fails when a new attribute-writing module appears and does not join the
  table.
- **The mutation-probe corpus is committed** (`probes/corpus.json`,
  `node scripts/run-probes.mjs`). Anchors are re-checked on every PR; the full
  run is nightly with a detection floor. Every probe written during a future bug
  investigation goes in it.
- **The testing policy is written down and enforced.** CONTRIBUTING.md gains the
  eight rules and the reviewer's checklist; `src/__tests__/test-policy.test.ts`
  fails the build on a test with no `expect()`, a test file that touches no
  production code, `it.skip` / a self-skipping `existsSync` guard, a test whose
  only assertions are presence checks, a file that is 90% one identical
  assertion, and `vi.mock` of a first-party module without `importOriginal`.

### Fixed — security

- **`$el.setAttribute()` in the expression grammar was unguarded.** It was the
  only attribute sink in the repo with no safety check at all, so a CSP-safe
  `data-on:click` handler could write the `javascript:` href that `data-bind:href`
  refuses twenty lines away in the same file — and, because the name and the
  value both come from expressions that can read state, both halves were
  attacker-reachable. `setAttribute` and `toggleAttribute` now apply the same
  `isSafeAttrName` + `isUnsafeAttrWrite` predicate as every other sink and raise
  `FORMA_E_METHOD_DENIED` instead.
- **A non-function `on*` prop is dropped instead of registered.**
  `h('button', {onclick: 'alert(1)'})` — the inline-handler shape the SSR
  renderer refuses — used to reach `addEventListener` with a string. The string
  never ran; instead the first real click threw `listener.call is not a function`
  inside dispatch and took every other listener on that element down with it. An
  object with a `handleEvent` method is still accepted, because that is a real
  `EventListener`.

### Fixed — hydration and reactivity

- **`data-bind:` writes a bare attribute for `true`.** It wrote `String(true)`,
  producing `disabled="true"` where `h()`, hydration adoption, the SSR renderer
  and the Rust walker all produce a bare `disabled`. An SSR page and its bound
  self disagreed byte-for-byte on every boolean attribute.



- **SSR tag names are validated.** A `VNode.tag` is interpolated into markup with
  no escaping, so an attacker-controlled tag could inject an attribute
  (`div onload=x`) or close the tag. All three VNode branches (`render.ts` and
  both of `stream.ts`) now drop unsafe tags.
- **`data:image/svg+xml` now has a context rule** instead of being blanket-allowed:
  permitted for image-context sinks (`<img src>`, `<image href>`, `<video
  poster>`/`src`, `<audio src>`, `<source src>`, the legacy `background`
  attribute) where the browser decodes it in image mode, blocked for document
  sinks (`<iframe src>`, `<object data>`, `<a href>`, `<use href>`) where an
  `onload=` inside it fires, and blocked when the sink is unknown.
- **`srcdoc`** is recognised as a raw-HTML sink (attribute escaping does not
  neutralize it, because the browser entity-decodes and then parses the value as
  a document). Still emitted — a sandboxed `<iframe srcdoc>` is legitimate — with
  a dev-mode warning.
- **RPC argument sanitization no longer recurses.** `deepStripForbidden` walked
  fully attacker-controlled JSON recursively, before any authorization guard and
  outside `handleRPC`'s try/catch: a ~120 KB deeply nested body overflowed the
  stack, the `RangeError` escaped into `createRPCMiddleware`'s un-caught `await`,
  and Node's default `--unhandled-rejections=throw` killed the process.
  Remote, unauthenticated process kill. The walk is now iterative and
  `createRPCMiddleware` has an error barrier that answers 500.
- **A malformed `__forma_islands` block no longer stops every island on the
  page.** The shared props block was parsed with a bare `JSON.parse` before the
  island loop and outside any try/catch, so one truncated block — or an empty one,
  since `JSON.parse('')` throws — meant zero islands hydrated, including islands
  with inline props or no props. It now degrades to "no shared props". Only a
  real `<script id="__forma_islands">` is accepted; `getElementById` alone matched
  any element with that id, so a user-controlled node earlier in the document
  could supply every island's props.
- **A blocked expression no longer aborts runtime initialization.** The
  blocklist path threw instead of degrading to the existing noop, and the
  throw propagated out of `initRuntime`, so a single offending expression left
  every directive on the page unbound.

### Fixed — hydration and reactivity

- **Hydrated list rows dispose their effects.** Rows created after SSR adoption
  were rendered bare — no `createRoot`, no stored dispose — so their bindings
  stayed subscribed forever: not on row removal, not on island dispose. They now
  match the CSR path.
- **A failed island disposes what it built.** `__formaDispose` was assigned only
  *after* `hydrateIsland` returned, so a component that threw left every effect
  created before the throw live and unreclaimable, still reacting to signal
  writes inside an island marked `status="error"`.
- **Removing a list row tears down islands inside it.** An island's root is
  created with `createUnownedRoot`, so it deliberately does not die with the
  row's root — leaving its effects (and its `IntersectionObserver` / interaction
  listeners, if it had not hydrated yet) running against detached DOM.
- **One broken binding no longer freezes unrelated islands.** A throw inside
  alien-signals' flush aborted the flush, skipping every remaining queued
  binding, and surfaced at the unrelated setter's call site. Re-run errors now
  route to `reportError`/`onError` and the flush continues; the *first* run still
  propagates to its caller, so island activation can mark the island failed.
- **Reactive `className` / `htmlFor` / `tabIndex` survive adoption.** The
  hydration path wrote reactive attribute bindings using the raw prop key with no
  `PROP_TO_ATTR` mapping, producing a useless `classname="…"` attribute — the
  same component rendered correctly server-side and in CSR, then silently lost
  its class binding after hydration.
- **A show whose branch is directly a list is adopted.** `createShow(cond, () =>
  createList(…))` with no wrapper element left the SSR rows in place with no
  reconcile effect bound.
- **`unmount()` after the CSR fallback removes the right element.** When
  `hydrateIsland` replaces an empty SSR shell with the component's own root,
  clearing the detached original left the replacement in the document.
- Also fixed in adoption: `ref` props, event-handler attributes, island-shell
  skipping, digit-anchored marker parsing, duplicate-key ghost rows, and
  adopted-row rebinding.

### Fixed — packaging and build

- **`__DEV__` is a genuine build-time constant.** It is a module *export*, so
  esbuild's `define` never substituted it: no dev path was eliminated and the
  shipped bundles computed it at runtime from `process.env.NODE_ENV` — meaning
  every dev `console.warn`/`console.error` shipped and fired in any Node/SSR or
  bundler context where `NODE_ENV` was unset. The replaceable flag now has its
  own free-identifier name and the `NODE_ENV` fallback is gone from every shipped
  byte. `reportError`'s console fallback no longer re-reads the environment per
  error.
- **Syntax minification is on for all outputs**, which is what actually makes the
  build-time flags fold. Without it, `new Function(` was still present in
  `dist/runtime-hardened.js`, `.cjs` and `formajs-runtime-hardened.global.js`,
  contradicting every docstring that said otherwise. Identifiers and line
  structure are preserved, so nothing is obfuscated. This changes every shipped
  byte.
- **The build is reproducible.** `dist` is cleaned once up front instead of from
  inside parallel tsup configs, where the clean raced the other configs and
  deleted declaration files another config had already written. Two consecutive
  builds now produce 87 byte-identical files.
- **The size gate measures what the README claims.** It gzipped `dist/index.js`
  alone, a re-export shim, so moving code into a shared chunk — or growing one —
  was free. It now walks the real ESM import graph.
- **Types resolve everywhere.** `publint` reports "All good!" and
  `@arethetypeswrong/cli` reports 44 green cells / 0 problems, including node10
  resolution, which previously failed on all 8 subpaths.
- Every emitted file carried **two** `sourceMappingURL` footers (Rollup emits
  one, tsup appends another); they are collapsed to one and asserted.

### Performance

The hardening above was benchmarked after the fact (`npm run bench`,
`docs/PERFORMANCE.md`). Two of its changes cost a great deal; both are fixed with
the safety property intact, and the rest were measured and kept.

- **Removing a list row no longer scans the row for islands.** `reconcileList`
  ran `querySelectorAll('[data-forma-island]')` over **every** departing row,
  which cost ~19 µs per removed six-node row — paid by every list on every page,
  and almost none contain an island. `activateIslands` / `hydrateIslandRoot` now
  count scheduled-or-active islands and the scan is skipped when the count is
  zero; since an island cannot acquire anything to tear down without going
  through one of those paths, the guarantee is unchanged. Removing 1000 six-node
  rows went from 63.6 ms back to 45.7 ms, against 45.7 ms for the same removals
  done by hand with `removeChild` — i.e. back on the floor. Round trips over a
  1000-row list (append/prepend/remove + undo) are **~2.6× faster**.
- **A reactive URL attribute whose value has not changed no longer re-runs the
  scheme guard.** `handleGenericAttr` checked `isDangerousUrl` — an allocating
  `String.replace` plus two regexes — *before* the identity cache, so an
  unchanging `href` paid full price on every flush and then wrote nothing. The
  cache check moved ahead of the guard, which is safe because the reject path
  stores `null` rather than the refused string, so a refused value can never
  produce a cache hit. 76 ns → 28 ns per no-op write; a write whose value *does*
  change still pays for the guard and did not move.

`docs/PERFORMANCE.md` also now resolves the separate finding that `createList`'s
initial render is superlinear where the hand-built floor is linear: it is not the
per-row root, index signal or cache rebuild (3% of the gap), but happy-dom's
array-backed child lists, which make `insertBefore` before a marker and mounting
a `DocumentFragment` quadratic. Both are O(1) in a browser. Three new floors in
`bench/list.bench.ts` carry the evidence.

### Documentation

Every claim in `README.md`, `SECURITY.md` and `CSP.md` was re-checked against the
code, and the ones that assert a security or behavioural property now cite the
test that proves them.

- The flagship "single HTML file" showcase used arrow functions in
  `data-computed` and `data-list`, which the CSP-safe parser rejects — the
  example presented as proof of the zero-build CSP-safe story disproved it. It is
  replaced with markup that a test mounts against the *hardened* build.
- The `createHistory` snippet could not run: it showed a tuple return taking a
  plain initial value, while the real signature takes a `[get, set]` tuple and
  returns a `HistoryControls` object (`TypeError: source is not iterable`).
- `SECURITY.md` called the `with()` + `Proxy` wrapper a sandbox. It is not: the
  `has` trap returns `key in scope.getters`, so any undeclared identifier reports
  `false` and `with()` falls through to the real globals — `document`, `fetch`,
  `localStorage` are all reachable. Only the blocklisted names are stopped.
- The `$el` / `$refs` / `$dispatch` examples in the directive table are handlers
  whose whole body is a method call, which the CSP-safe grammar does not accept;
  they are now marked as needing the opt-in.
- Corrected: every CDN pin (was `1.0.7`), the alien-signals repository link, the
  size figures (the core entry is untree-shaken, not "~8 KB", and the runtime is
  not "~24 KB" — the table in `README.md` carries the current measurement and the
  date it was taken; the allowlist interpreter landed after that first correction
  and moved the runtime figures again), the island coverage figure, the
  `@getforma/core/tc39` shape (it exports `State` and `Computed` — there is no
  `Signal` namespace), and the Supported Versions table (it listed only `1.0.x`
  while 1.5.0 was on npm).
- Added: an *Escape hatches — the trust boundary* section naming the four
  unsanitized HTML sinks (`dangerouslySetInnerHTML`, `setHTMLUnsafe`,
  `reconcile`, `srcdoc`), which appeared in no document while `CSP.md` answered
  "innerHTML — FormaJS uses it? No"; sections for `createResource`,
  `createSuspense`, `svg()` and `createPortal`; a table covering the rest of the
  export surface; and a *Known gaps* section in `SECURITY.md`.
- `src/__tests__/docs-truth.test.ts` now checks the mechanically checkable
  claims — version pins, artifact names, export coverage, the tc39 shape, the
  coverage figure, the size limits — so this class of drift fails CI instead of
  waiting for an audit.
- **`README.md` is a landing page again — 1,183 lines down to 182.** The
  narrative moved to `docs/API.md`, `docs/HTML-RUNTIME.md`, `docs/ISLANDS.md`,
  `docs/CDN-AND-EXPORTS.md`, `docs/COMPARISONS.md` and `docs/STABILITY.md`,
  indexed from `docs/README.md`, with every `Verified by` citation carried across
  unchanged. Nothing was rewritten for style, so the move is diffable. The
  README keeps the badges, the size table, the intro example, install, the three
  entry points, the benchmark citations, the CSP promise and the index.
  All six pages joined `docs-truth.test.ts`'s `DOCS` map in the same change:
  moving a citation out of a checked file into an unchecked one would have
  quietly undone the thing this restructure exists to do. The flagship showcase
  and the directive table are still *extracted from the file at test time* and
  mounted — they now live in and are extracted from `docs/HTML-RUNTIME.md`.
- The hardening ledger moved to `docs/archive/2026-08-05-hardening-audit.md` now
  that all 55 entries are closed; a completed audit sitting next to the reference
  docs reads as current documentation. Its citations are still resolved by path.
- Dropped the README's "WASM render … unreachable before 1.6.0" claim: `./wasm`
  is an `exports` subpath now, and the release number it would first ship in is
  not decided. `docs/STABILITY.md` states the checkable part — no released
  version through 1.5.0 exported the subpath, and it needs
  `window.__FORMA_WASM__`.
- `CSP.md`'s version-history table ends in a row labelled `Unreleased` rather
  than `> 1.5.0`, and a test now pins that label and the released row below it to
  `package.json`, so cutting a release without updating the table fails CI.

### Note on 1.1.0

`getOwner`, `runWithOwner`, `getSignalName`, `value`, `Owner` and
`ResourceFetcherInfo` are listed as "Added" under 1.1.0, but were not re-exported
from the package root until commit `bf35b21` on this branch. Until then they were
reachable only by deep import.

## [1.5.0] - 2026-07-08

Storage / component / wasm robustness. Stacks on 1.4.0.

### Fixed
- **IndexedDB durability**: writes now resolve on transaction commit
  (`tx.oncomplete`), not request success, so a write whose transaction aborts
  (e.g. `QuotaExceededError` at commit) is reported as a failure, not success.
- **IndexedDB connections**: wire `onversionchange`/`onclose` (close + evict) so
  a version bump from another tab/store is not blocked forever; a blocked bump
  settles instead of leaking; a broken/store-less connection is evicted so the
  next call reopens. Concurrent creation of multiple object stores on one
  database is serialized so no store is lost or wedged.
- **`createLocalStorage`/`createSessionStorage`**: `remove()` degrades gracefully
  when storage access throws, matching `get`/`set`.
- **Component disposal**: a component that returns a `DocumentFragment` can now be
  disposed via any of its (now-detached) child nodes — the dispose handle was
  previously stranded on the emptied fragment and leaked.
- **Context**: values provided during a component's setup/mount are auto-removed
  on that component's dispose (by unique frame, so a sibling's value is never
  disturbed); a `setup()` that throws after `provide()` no longer leaks; the
  long-inaccurate "teardown pops automatically" docstring is now true.
- **WASM loader**: `getIR` checks `response.ok` (no longer caches a 404/500 error
  page as IR), and the wasm instantiate + IR fetch are memoized as in-flight
  promises (one per page) with retry-on-failure.
## [1.4.0] - 2026-07-08

Server / SSR robustness. Stacks on 1.3.0. Adds an RPC authorization hook.

### Added
- **RPC authorization guard** (`@getforma/core/server`): `setRPCGuard(fn)`
  (global) or the `authorize` option on `handleRPC`/`createRPCMiddleware`.
  `handleRPC` still performs no authentication by itself — this is the injection
  point. A guard that throws or rejects fails closed (403, no error leak).
- **`StreamOptions.suspenseTimeout`**: cap how long streaming SSR waits for each
  Suspense boundary; on timeout the fallback stays and the stream terminates
  instead of holding the connection open forever.

### Fixed
- **RPC arguments are sanitized**: deep-stripped of `__proto__`/`constructor`/
  `prototype` before the server function runs, so a deep-merging function cannot
  pollute `Object.prototype`. Safe on frozen/sealed arguments.
- **`createRPCMiddleware`** now enforces the `X-Forma-RPC: 1` header and a JSON
  content type (CSRF mitigation), resolves the endpoint path without the query
  string (a `?query` used to 404), and returns accurate status codes
  (400/403/404/415/500) instead of 500 for everything.
- **Streaming SSR** resolves a nested Suspense inside resolved content via its
  own swap (was emitted literally); a synchronous throw in a Suspense resolver no
  longer aborts the whole stream (the shell/fallback are preserved).
## [1.3.0] - 2026-07-08

DOM correctness. Stacks on 1.2.0. Adds the `svg()` helper and completes
`data-model`.

### Fixed
- **Reconciler cache is per-container.** A single reconciler instance shared one
  last-HTML cache, so reconciling a second container to the same HTML as the
  first was a no-op. Keyed per container.
- **Keyed lists no longer drop duplicate-keyed rows past 32 items.** The
  large-list diff path collapsed duplicate keys; it now consumes occurrences
  one-per-match like the small path.
- **`data-list {index}`** is the true loop index (was `indexOf`, wrong for
  duplicate/primitive items and O(n^2)).
- **Islands**: `activateIslands()` re-run no longer double-hydrates/double-binds;
  visible-trigger observers, idle timers, and interaction listeners are torn down
  by `deactivateIsland`/`deactivateAllIslands` (previously leaked and could
  zombie-hydrate); a disposed island cannot be resurrected by a stray callback.
- **Suspense** whose resolved content is a `DocumentFragment` no longer
  duplicates or loses content across re-suspend/re-resolve.
- **CSP expression parser** no longer mis-splits operators inside string literals
  (`{'a' + '-' + 'b'}`), and arithmetic/comparison are correctly left-associative
  (`10 - 3 - 2 === 5`, `12 % 5 % 3 === 2`).

### Added
- **`svg(build)`** context helper so nested `h()` calls create SVG-namespaced
  elements, including dual-use tags like `<a>`. Without it, dual-use tags default
  to HTML.
- **`data-model`** now supports radio groups, `<select multiple>`, an opt-in
  `data-model-indeterminate` companion, member-path targets (`{item.name}`), and
  guards numeric input against writing `NaN` (empty clears to `null`).

### Known limitations
- `svg()` resolves tags by explicit context (no parent-walk); `foreignObject`
  descendants stay SVG; MathML is unsupported.
- The reconciler/`parseHTML` `innerHTML` paths are a trust boundary — do not feed
  them attacker-controlled markup.
## [1.2.0] - 2026-07-08

State layer correctness. Stacks on 1.1.0. Several fixes change observable
behavior (they correct bugs), hence a minor bump.

### Fixed
- **Store array mutations are now reactive.** `push`/`pop`/`shift`/`unshift`/
  `splice`/`sort`/`reverse`/`fill`/`copyWithin`, `delete state.x`, and
  `arr.length = n` now notify subscribed effects (they previously deleted the
  path signals, orphaning subscribers). Effects reading an array itself, its
  `length`, or an index re-run correctly.
- **Store proxy identity**: an object aliased at two paths now gets a
  path-bound proxy (writes notify the correct path); the orphaning inline
  signal cache was removed; stale proxies are evicted on replace/delete.
- **Store**: re-assigning the identical object no longer orphans descendant
  subscribers; a stored function value (e.g. an array method read as a path) is
  no longer misread as a functional updater.
- **History** snapshots entries (in-place mutation can't corrupt past states),
  is batch-safe (an external set batched with `undo()` is recorded; a custom
  `equals` no longer leaks the ignore flag), clamps `maxLength >= 1`, and adds
  `destroy()`.
- **Persist**: cross-tab sync, versioned migration, an `onError` hook, and a
  disposer; JSON parsing stays prototype-pollution-safe.

### Known limitations
- Coarse array own-path reactivity: reading an array subscribes to its mutations
  (SolidJS-style), so unchanged-length mutations still re-run array-level effects
  (values are always correct).
- `createHistory` requires a signal with a stable value; a store-proxy slice that
  returns a fresh proxy per read is not supported.
- `Map`/`Set`/`Date` values and `Object.keys`/`for...in` remain non-reactive.
## [1.1.0] - 2026-07-08

Reactive-core correctness. Several fixes change observable behavior (they correct
long-standing bugs), hence a minor bump. Stacks on the 1.0.10 security release.

### Fixed
- **Effect cleanups are no longer dropped.** The `skipCleanupInfra` fast-path
  latched after a clean first run and then silently discarded — or cross-registered
  onto a sibling — any `onCleanup()`/returned cleanup registered on a later run.
- **An effect that writes a signal it depends on now re-runs** to observe the value
  (alien-signals swallowed the self-notify). Detection is precise: writes to signals
  the effect does not depend on do not cause a spurious re-run; genuine cycles are
  bounded and reported.
- **Nested effects are owned by their parent generation**, so their cleanups run when
  the parent re-runs and on disposal (previously leaked via alien's raw teardown).
  Teardown order is children-before-parents on both the re-run and dispose paths.
- **`createRoot` dispose() during setup** now defers teardown so work created after
  the call is also disposed (was a permanent leak).
- **Computed getters cache and rethrow errors** until a dependency changes (TC39/Solid),
  instead of returning a stale value; errors route through `onError`.
- **`createResource`**: a synchronously-thrown fetcher is captured (loading cleared,
  Suspense balanced); the `AbortSignal` is passed to the fetcher and aborted on
  refetch and on dispose; loading/error transitions are batched (no glitch frame).
- **`equals: () => false`** now force-notifies for identical references ("always
  notify"), not only suppresses.
- **`SignalOptions.name`** no longer breaks `isSignal()` (stored in a side table).

### Added
- `getOwner()` / `runWithOwner()` for owning work created outside the synchronous
  root scope; `getSignalName()`; `ResourceFetcherInfo`.
  **Correction:** these were reachable only by deep import until the root-barrel
  fix on the unreleased branch — see [Unreleased] > *Note on 1.1.0*.
- `onError()` supports multiple handlers and returns an unsubscribe function.

### Changed
- `__DEV__` defaults to production-safe (false) when the environment is
  indeterminate; opt into dev via a global `__FORMA_DEV__`.
## [1.0.10] - 2026-07-08

### Security
- **SSR `javascript:`/`vbscript:` URI filter no longer bypassable with control characters.** Browsers strip tabs/newlines/control chars from a URL scheme before interpreting it, so payloads like `java\tscript:alert(1)` executed despite the old contiguous-string check. Scheme detection now normalizes the value the same way the browser does before testing (`src/security/url-safety.ts`, used by `src/ssr/render.ts` and `src/ssr/stream.ts`).
- **`data-bind:*` and `data-list` row templates can no longer inject `javascript:` URLs or inline event handlers.** The `setAttribute` sinks now reject `on*` attribute names and dangerous URL schemes, in **both** the standard and hardened/CSP runtime builds (the sinks were identical in both; hardening previously only blocked `eval`).
- **SSR attribute-name handling hardened.** Event-handler filtering is now case-insensitive (`OnClick` was previously emitted), and malformed prop keys (e.g. containing whitespace/`=`) can no longer inject additional attributes. Renderer and streaming paths share one `renderAttr` helper so the rules cannot drift.

### Docs
- Corrected the inaccurate "~15 KB gzipped" size claim across `package.json`, `README.md`, and the runtime header: the core entry is ~8 KB gzipped and the full CDN runtime bundle is ~24 KB gzipped.
- `SECURITY.md` / `CSP.md` updated to match actual behavior.

### CI
- Bundle-size gate now enforces a limit on the CDN runtime bundle too (previously only `index.js` was gated; the larger runtime bundle was printed but never enforced). Limits: index ≤ 12 KB, runtime ≤ 28 KB gzipped.

### Chore
- Backfilled changelog entries for 1.0.2–1.0.9 (below).

## [1.0.9] - 2026-04-10

### Fixed
- Use `createUnownedRoot` in `mount`/`activateIslands`; auto-register `createRoot` with its parent plus disposal cleanup in primitives.

## [1.0.6] - 2026-03-31

### Fixed
- **CSP-safe style handling** — replaced `cssText` assignment with CSSOM parsing so inline styles work under a strict Content-Security-Policy.

### Docs
- Added the CSP guide (`CSP.md`) covering strict-CSP handling, common issues, and version history.

## [1.0.8] - 2026-03-27

### Fixed
- Default `elseFn` in `createShow` to prevent a crash when called with two arguments.

## [1.0.7] - 2026-03-17

### Fixed
- `createFetch` fire-and-forget `execute()` now `void`-prefixed.
- SVG `className` crash and array return from function children.
- `createFetch` uses `window.location.origin` as the default base URL.

### Changed
- CI Node matrix updated 18 → 20/22/24.

## [1.0.5] - 2026-03-16

### Fixed
- Export `template` and `templateMany` from the main barrel.
- SVG `className` crash and array return from function children; `createFetch` default base URL.

### Notes
- 1.0.2–1.0.4 were docs/packaging/CI iterations (npm keywords, issue templates, TypeDoc GitHub Pages deploy, trusted publishing (OIDC) migration) with no runtime code changes.

## [1.0.1] - 2026-03-16

### Fixed
- **IIFE global builds no longer minified** — Socket.dev flagged single-line minified files as "obfuscated code" (high severity false positive). IIFE builds are now unminified multi-line code. CDNs serve with gzip/brotli anyway so the wire size impact is negligible. Users who need minification use their own bundler.

## [1.0.0] - 2026-03-16

### BREAKING CHANGES
- **HTTP, storage, and server modules moved to subpath exports.** The main `@getforma/core` entry point no longer includes network-capable code. Import from the new subpaths:
  - `import { createFetch, createSSE, createWebSocket } from '@getforma/core/http'`
  - `import { createLocalStorage, createSessionStorage, createIndexedDB } from '@getforma/core/storage'`
  - `import { createAction, $$serverFunction, handleRPC } from '@getforma/core/server'`
- The main bundle (`dist/index.js`, `dist/index.cjs`) now has **zero `fetch`, zero `WebSocket`, zero `process.env`** — improving supply chain security scores.

### Why 1.0.0
- Subpath exports lock in the final API shape
- Security hardening complete (CSP bypass fixed, `$el` sandboxed, SSR injection fixed)
- alien-signals 3.x integrated with `SignalOptions.equals`, type guards, `trigger`
- 811 tests, full TypeDoc coverage, zero warnings
- Production-proven in GateWASM auth system

## [0.9.1] - 2026-03-15

### Changed
- **Hardened builds now have zero `new Function` in dist** — added compile-time `__EVAL_CAPABLE__` constant that esbuild constant-folds to `false` in hardened builds, enabling dead code elimination of all `new Function()` paths. Socket.dev/Snyk static analysis will no longer flag eval usage in hardened builds.
- **Exported 31 missing types** for TypeDoc — all parameter and return types of public functions are now properly exported (SignalGetter, SignalSetter, FetchOptions, SSEConnection, StoreSetter, etc.). `npm run docs` now generates with 0 warnings.

## [0.9.0] - 2026-03-15

### Added
- **`data-ref` directive and `$refs` magic** — register elements with `data-ref="name"` and access them from expressions via `$refs.name`. Refs are scoped to their `data-forma-state` parent. Supports reading properties (`$refs.input.value`), calling methods (`$refs.input.focus()`), and manipulating classes (`$refs.panel.classList.toggle('open')` via unsafe-eval path).
- **TypeDoc API reference generation** — `npm run docs` generates API documentation from JSDoc comments to `api-docs/`. Added `typedoc` dev dependency and `typedoc.json` config.

## [0.8.2] - 2026-03-15

### Docs
- Added jsDelivr CDN URLs alongside unpkg
- Added ESM import example for modern browsers (no bundler)
- Added version pinning guidance for production
- Updated runtime.ts header with all 6 design inspirations, complete file map, build output documentation, and monolith rationale

## [0.8.1] - 2026-03-15

### Added
- **Reactive introspection APIs** (from alien-signals 3.x):
  - `isSignal(fn)` — type guard: is this a signal getter?
  - `isComputed(fn)` — type guard: is this a computed value?
  - `isEffect(fn)` — type guard: is this a raw effect?
  - `isEffectScope(fn)` — type guard: is this an effect scope?
  - `getBatchDepth()` — returns current batch nesting depth (0 outside batch)
  - `trigger(fn)` — force a computed/effect to recompute even if dependencies unchanged
- **`createComputed` now receives previous value** — the getter function receives `(previousValue?: T)` for efficient diffing patterns without a separate signal
- **`createRoot` now uses alien-signals `effectScope`** — native graph-level effect tracking replaces the userland disposer array for reactive cleanup. Userland disposers (event listeners, timers) still use the array.

## [0.8.0] - 2026-03-15

### Changed
- **Upgraded alien-signals from 1.0.x to 3.1.2.** Replaced `pauseTracking`/`resumeTracking` with `getActiveSub`/`setActiveSub`. This brings the v2 Pending flag optimization (fewer intermediate recomputations) and aligns with Vue 3.6's reactivity engine.

### Added
- **`SignalOptions.equals` — custom equality for `createSignal`.** When provided, the setter reads the current value and only updates the signal if `equals(prev, next)` returns `false`. Works with both literal and functional setters. Previously declared in the type but never wired up — now fully functional.

```typescript
const [pos, setPos] = createSignal(
  { x: 0, y: 0 },
  { equals: (a, b) => a.x === b.x && a.y === b.y },
);
setPos({ x: 0, y: 0 }); // skipped — values are equal
setPos({ x: 1, y: 0 }); // applied — values differ
```

- TC39 compat `Signal.State` now passes `equals` through to `createSignal` natively instead of wrapping with its own setter logic.

## [0.7.1] - 2026-03-15

### Fixed
- **CSP parser operator precedence:** Arithmetic now correctly evaluates before comparison (`a + b > c` = `(a+b) > c`), and AND binds tighter than OR (`a || b && c` = `a || (b&&c)`). Previously produced silent wrong results for compound expressions.
- **Store `deepClone` circular reference guard:** `setState(prev => ...)` no longer stack-overflows on stores with circular references.

### Changed
- **Removed `SignalOptions.equals`:** Was declared in the type but never wired to alien-signals. Removed to prevent false API expectations. TC39 compat `Signal.State` retains its own local `equals` option.
- **Removed `renderLocal`/`renderIsland` from main exports:** These WASM-only functions throw without `window.__FORMA_WASM__` config. They remain available via direct import from `@getforma/core/wasm` path but no longer appear in the main barrel export.
- **Documented store `ownKeys` limitation:** `Object.keys()`, `for...in`, and spread are not reactive on store proxies.

## [0.7.0] - 2026-03-15

### Security
- **`$el` sandbox escape blocked:** `$el` is now wrapped in a safe Proxy that allowlists DOM properties (classList, dataset, style, value, focus, etc.) and blocks access to `ownerDocument`, `parentNode`, `innerHTML`, and any chain that reaches `window`/`document`. Applies to BOTH standard and hardened builds.
- **SSR swap script injection fixed:** `getSwapTag` now escapes `<` as `\u003c` and `>` as `\u003e` in JSON-serialized content, preventing `</script>` from breaking the inline script block during Suspense streaming.
- **Island props sanitized:** `loadIslandProps` now strips `__proto__`, `constructor`, and `prototype` keys from JSON-parsed props (inline and shared script block), matching the sanitization already done by `parseState`.
- **`escapeAttr` strengthened:** Now escapes `<`, `>`, and `'` in addition to `&` and `"`. Blocks `javascript:`, `vbscript:`, and `data:text/html` URIs in `href`, `src`, `action`, and `formaction` attributes across all SSR render paths.

## [0.6.1] - 2026-03-15

### Added
- **C1:** Tests for `suspense-context.ts` — 9 tests covering push/pop stack, LIFO ordering, empty stack safety
- **C2:** Tests for `rpc-client.ts` and `rpc-handler.ts` — 37 tests covering endpoint routing, FORBIDDEN_KEYS protection, error sanitization, fetch mocking, revalidation events
- **C7:** Tests for `reducer.ts` — 8 tests covering tuple return, reactivity, complex state, counter patterns

### Fixed
- Moved internal planning documents (hardening plan, Turbo Streams evaluation) out of public repo

## [0.6.0] - 2026-03-15

### Added
- **S6:** Real `idle` and `interaction` hydration triggers — `idle` defers via `requestIdleCallback` (with `setTimeout` fallback for Safari), `interaction` hydrates on first `pointerdown` or `focusin`. No more stubs.
- **S3:** Function components in `h()` — `h(Counter, {count: 5})` now calls the function with merged props and children. CSR-only (no hydration descriptors or SSR).
- **S7:** Turbo Streams design evaluation — documented that existing `createSSE` + `reconcile()` covers the use case without new abstractions.

### Fixed
- **C3:** Hydrated event listeners now use AbortController — `cleanup(el)` properly removes event listeners attached during island hydration, matching the pattern from `element.ts`.
- **C8:** Standardized HTTP module import paths — `forma/reactive/index.js` → `forma/reactive` in fetch, SSE, and WebSocket modules.

## [0.5.1] - 2026-03-15

### Changed
- **S1:** `createComputed` JSDoc clarified — documents that it is a lazy cached derivation (equivalent to `createMemo`), unlike SolidJS's eager `createComputed`
- **C4:** Removed `longestIncreasingSubsequence` from public API — internal algorithm no longer exported from `@getforma/core`
- **C5:** Removed deprecated `createValueSignal` — all internal usage migrated to `createSignal`. The `ValueSignalSetter` type is also removed.

### Added
- **S4:** `$el` and `$dispatch` magics in the HTML Runtime — `$el` resolves to the current element, `$dispatch(name, detail?)` fires a `CustomEvent` with `bubbles: true` and `composed: true` (crosses Shadow DOM boundaries)
- **H4:** `compiledTemplateCache` now capped at 2048 entries with FIFO eviction, matching `expressionCache` pattern

### Fixed
- **C6:** Component lifecycle errors (`onMount`, `onUnmount`, disposers) now reported via `reportError` instead of silently swallowed — surfaces through `onError()` handler with correct `source` field

## [0.5.0] - 2026-03-15

### Security
- **H2:** `findBlockedMethod` hardened against computed bracket access bypass — string concatenation inside brackets (e.g., `x['constr' + 'uctor']`) is now detected and blocked. Defense-in-depth proxy traps added to both expression and handler evaluation paths.
- **H1:** SSR streaming (`stream.ts`) now validates `dangerouslySetInnerHTML` shape — previously used a direct type assertion cast with no validation, risking runtime crashes or unexpected HTML in streamed SSR output.
- **H5:** Removed relaxed JSON parser from `parseState` — the `RE_UNQUOTED_KEYS` regex corrupted URLs and string values containing colons. `data-forma-state` now requires valid JSON (breaking change for unquoted-key users).

### Added
- `deactivateIsland(el)` — dispose a single island's reactive root and all effects
- `deactivateAllIslands(root?)` — dispose all active islands under a root element (for module swap cleanup in `<forma-stage>`)

### Fixed
- **H3:** Island memory leak — `__formaDispose` was stored on island elements but never called. Every module swap leaked a `createRoot` scope with all effects, listeners, and signal subscriptions.

## [0.4.0] - 2026-03-15

### Changed
- **BREAKING:** `IslandHydrateFn` signature changed from `(props) => unknown` to `(el, props) => unknown` — island callbacks now receive the root `HTMLElement` as the first argument for layout measurement, focus management, CSS class toggling, and third-party library integration

### Docs
- Added "Getting Started with a Bundler" section (Vite setup)
- Consolidated CDN URLs into a clear table with all filename variants
- Documented lifecycle semantics (`onMount` cleanup vs `onUnmount`)
- Added error handling section (`mount()` fail-fast, `onError()`, `createErrorBoundary`)
- Added Solid comparison table
- Added feature stability matrix
- Expanded ecosystem table with all Forma packages (Rust crates + npm)

## [0.3.0] - 2026-03-14

### Security
- SSR swap script injection: both args use `JSON.stringify` to prevent XSS
- Proto-pollution guard: `__proto__`, `constructor`, `prototype` stripped from `parseState()`
- Expanded unsafe method blocklist: `__defineGetter__`, `__defineSetter__`, `__lookupGetter__`, `__lookupSetter__`, `eval`
- RPC handler no longer leaks internal error messages to clients (dev-only in development mode)

### Changed
- `EventBus` constraint changed from `Record<string, any>` to `Record<string, unknown>` (stricter public API)
- `ListDescriptor` fields changed from `any` to `unknown` (stricter hydration types)
- `$$serverFunction` generic changed from `any` to `unknown`
- `alien-signals` pinned to `~1.0.0` (uses internal APIs, minor bumps could break)
- `createEffect` removed from tsup `pure` list (has side effects — tree-shakers could silently drop user calls)
- `enableAutoRevalidation()` guarded against SSR (checks `typeof window`)

### Added
- `setHTMLUnsafe()` method (preferred name), `setHTML()` deprecated with JSDoc warning
- Storage `validate` type guard option for `createLocalStorage` and `createSessionStorage`
- `parse` option for `createWebSocket` and `createSSE` custom message deserialization
- `runtime-hardened.d.ts` auto-copied from `runtime.d.ts` in post-build
- GitHub Actions CI pipeline (Node 18/20/22 matrix, Playwright E2E, bundle size check)
- GitHub Actions release pipeline (automated npm publish on `v*` tags with provenance)

## [0.2.0] - 2026-03-13

### Added
- HTML Runtime: Alpine-like declarative API via `data-*` attributes with CSP-safe expression parser
- Runtime hardened mode: `new Function()` locked off for strict CSP environments
- Playwright E2E test suite (27 tests across 10 directive groups)
- CDN global builds: `formajs-runtime.global.js` and `formajs-runtime-hardened.global.js`

## [0.1.0] - 2026-03-13

### Added
- Reactive primitives: createSignal, createEffect, createComputed, createMemo, batch, untrack
- Real DOM: h(), mount(), fragment, createText — creates actual DOM elements, no virtual DOM
- Conditional rendering: createShow, createSwitch
- List rendering: createList with keyed reconciliation
- Islands architecture: activateIslands(), hydrateIsland()
- Component lifecycle: defineComponent, onMount, onUnmount, createContext, provide/inject
- State management: createStore, createHistory, persist
- DOM utilities: $, $$, addClass, removeClass, onResize, onIntersect
- Events: createBus, delegate, onKey
- HTTP: createFetch, fetchJSON, createSSE, createWebSocket
- Storage: createLocalStorage, createSessionStorage, createIndexedDB
- SSR runtime: server-side rendering support
- WASM loader: forma-wasm integration
- Runtime hardened mode: locked-off unsafe eval
