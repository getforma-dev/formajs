# Contributing to FormaJS

## Setup

```bash
git clone https://github.com/getforma-dev/formajs.git
cd formajs
npm install
npm test        # run tests
npm run build   # build dist/
```

## Development

- `npm test` — run vitest
- `npm run test:watch` — watch mode
- `npm run build` — build all output formats
- `npm run typecheck` — type check without emitting

## Code Style

- Use `h()` for all DOM creation — never `document.createElement` in library code
- Reactive values must be functions: `() => count()` not `count()`
- Components are pure rendering — no side effects in render functions
- Tests go in `__tests__/` directories next to their source

## Pull Requests

1. Fork and create a feature branch
2. Add tests for new functionality
3. Ensure `npm test` passes
4. Submit PR with clear description
