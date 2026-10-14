# Coming from React, or from Solid

Two questions this page answers: *what do I have to unlearn?* and *why would I
pick this over Solid?*

---

## Coming from React

If you know React, you already know most of FormaJS. Components are functions.
Props flow down. You import, export and compose the same way. The difference is
*how reactivity works* — and it is simpler.

React re-runs your component function on every state change, diffs a virtual
DOM, and patches the real one. FormaJS runs each component **once**. Signals
update only the specific DOM nodes that read them. No reconciliation, no stale
closures, no `useCallback`.

| React | FormaJS | What changes |
|---|---|---|
| `useState` | `createSignal` | Same `[value, setter]` tuple |
| `useMemo` | `createComputed` | No dependency array — auto-tracks |
| `useEffect` | `createEffect` | No dependency array — auto-tracks |
| `useReducer` | `createReducer` | Same dispatch pattern |
| `useContext` | `createContext` / `inject` | Same provider pattern |
| `React.memo` | *not needed* | Components already run once |
| Component functions | same | `function Counter(props) { … }` |
| Props | same | `<Counter count={count} />` |
| Children | same | Rest params or `props.children` |
| Import / export | same | Standard ES modules |

**The one habit to break.** In React, `{count}` in JSX is a value that a
re-render refreshes. Here there is no re-render, so a bare value is written
once and never again. Reactivity comes from passing a *function*:

```tsx
<p>{count()}</p>        // ❌ reads once at creation, never updates
<p>{() => count()}</p>  // ✅ re-runs when count changes
<div class={() => cls()}>…</div>   // ✅ same rule for props
```

That single rule explains most "why is my UI not updating" questions. See
[API.md](API.md) for the full `h()` contract.

### Measured browser comparison

`npm run bench:browser` is local, opt-in benchmark infrastructure. It builds
equivalent FormaJS and React fixtures in production mode, transforms the React
side with the stable React Compiler, and runs both in Chromium, Firefox, and
WebKit. It measures mount, one-widget and broad updates, keyed reordering,
retained heap, production payload, DOM mutations, and a separate TanStack Query
server-state lane. None of these fixtures are part of a Forma application or
the published package. The generated
[browser framework report](browser-framework-results.md) includes raw samples
and noise floors in its adjacent JSON.

That report is evidence for those fixtures on the recorded machine, not a
universal “Forma is faster than React” claim. Cross-browser hydration,
streaming, forms, context, and third-party benchmark lanes remain explicitly
listed before such a claim would be defensible.

---

## How is this different from Solid?

FormaJS shares Solid's core insight — fine-grained signals updating the real
DOM without a virtual DOM. If you know Solid, you will feel at home.

The differences are in scope and delivery. FormaJS adds islands hydration
without a meta-framework, CSP compliance without a build step, three entry
points (CDN script tag, hyperscript, JSX) sharing one signal graph, and a Rust
SSR path that removes Node.js from the server. Solid gives you a mature
JavaScript ecosystem: routing, a meta-framework (SolidStart), devtools and
community component libraries.

**Choose FormaJS** when you want islands baked in, CSP safety out of the box, a
Rust backend without a Node.js sidecar, or a CDN-first starting point that
scales to a full compiled pipeline.

**Choose Solid** when you want a mature JS ecosystem, SolidStart for full-stack
JS, community devtools, and your backend is already Node.js.

---

## What FormaJS is not

It is not a framework with opinions about routing, data fetching or state
management. It is a reactive DOM library — you bring the architecture. The
pieces that *are* opinionated (the compiler, the build pipeline, the Rust
server) are separate packages you add when you want them; see the
[stack architecture](https://github.com/getforma-dev/forma/blob/main/docs/ARCHITECTURE.md).
