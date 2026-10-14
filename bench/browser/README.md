# Browser framework comparison

This directory contains local developer benchmark fixtures used by
`npm run bench:browser`. They are not imported by FormaJS or an application,
served by a production endpoint, or included in the published package. React,
TanStack Query, Babel, and Playwright are benchmark-only dev dependencies.

The runner builds each fixture independently, executes them in fresh Chromium,
Firefox, and WebKit pages, and records framework-neutral timing, mutation,
memory, bundle, and request-fan-out measurements. Retained-heap measurement is
Chromium-only because it uses the Chrome DevTools Protocol.

The comparison is intentionally separate from the happy-dom hot-path suite in
`bench/*.bench.ts`. Browser results compare frameworks; the existing suite
detects FormaJS regressions with a tighter local noise floor.

## Lanes

- **Runtime:** equivalent per-widget local state, broad state updates, keyed
  reordering, retained heap, and production bundle payload.
- **Server state:** current isolated Forma resources, a deliberately shared
  Forma resource, and TanStack Query observers using one query key. The local
  broker simulation reports browser ingress separately from provider work.

React fixtures are transformed by the stable React Compiler before esbuild.
The runner fails if it cannot find compiler memoization output; it never falls
back to uncompiled React silently. React mutations use `flushSync`, so a state
enqueue cannot be misreported as completed UI work.

Run the full capture with:

```bash
npm run bench:browser
```

For a fast wiring check:

```bash
npm run bench:browser -- --quick
```

Quick mode prints a summary but does not overwrite the recorded Markdown or
JSON evidence.

Target one engine with `--browser chromium`, `--browser firefox`, or
`--browser webkit`. Use `--browser all` to override the quick mode's Chromium
default.

The generated Markdown is readable evidence. The adjacent JSON retains raw
samples, mutation counts, p95, min/max, and spread for review.
