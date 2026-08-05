# Contributing to FormaJS

## Setup

Node **>= 20.19.0** is required for development — that is the floor `vite`
declares, and `package.json`'s `engines` / `devEngines` state it so `npm ci`
warns instead of failing later in a confusing way. CI runs the same floor.

```bash
git clone https://github.com/getforma-dev/formajs.git
cd formajs
npm install
npm test        # run tests
npm run build   # build dist/ (ends with scripts/verify-dist.mjs)
```

## Development

- `npm test` — run vitest
- `npm run test:watch` — watch mode
- `npm run test:e2e` — build dist, then run Playwright against the real artifacts
- `npm run build` — build all output formats, then verify them
- `npm run check:size` — gzip the real ESM import graph per entry (the CI gate)
- `npm run check:pack` — `publint` + `@arethetypeswrong/cli`
- `npm run typecheck` — type check without emitting (covers `tsup.config.ts` and `scripts/`)

## Code Style

- Use `h()` for all DOM creation — never `document.createElement` in library code
- Reactive values must be functions: `() => count()` not `count()`
- Components are pure rendering — no side effects in render functions
- Tests go in `__tests__/` directories next to their source

## Comments that assert behaviour must cite their proof

A comment claiming a security or behavioural property is worse than no comment
when it is wrong, because it stops the next reader from checking. If you write
one, end it with the test that proves it, on its own line, in exactly this form:

```ts
// Verified by: src/security/__tests__/url-safety.test.ts > "blocks data:image/svg+xml when no tag is supplied"
```

The same rule applies to the markdown: `README.md`, `SECURITY.md` and `CSP.md`
carry `Verified by \`path\` > "test name"` lines under the claims they make. If
there is no test, write one. If the claim cannot be tested, do not assert it —
describe the actual mechanism instead.

`src/__tests__/docs-truth.test.ts` additionally checks the claims that can be
read straight off the repo (version pins, artifact names, export coverage,
coverage figures, size limits). Update the docs and it passes; leave them stale
and it fails.

## What must not change

The hydration wire contract is shared byte-for-byte with the Rust walker in the
`forma` repo and with ksx Studio: the `f:tN` / `f:sN` / `f:lN` / `f:iN` comment
markers, the `data-forma-*` attribute names, the `__forma_islands` script
protocol and its props JSON shape, and the FMIR binary layout. Everything else
is fair game.

## Pull Requests

1. Fork and create a feature branch
2. Add tests for new functionality — a regression fix needs a test that fails
   without it
3. Ensure `npm test`, `npm run typecheck` and `npm run build` pass
4. Add a `## [Unreleased]` entry to `CHANGELOG.md` for anything user-visible
5. Submit PR with clear description
