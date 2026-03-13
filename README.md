# FormaJS

[![CI](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@getforma/core)](https://www.npmjs.com/package/@getforma/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals, islands architecture, and SSR hydration. ~15KB gzipped.

## Install

```bash
npm install @getforma/core
```

## Quick Start

```typescript
import { createSignal, h, mount } from '@getforma/core';

const [count, setCount] = createSignal(0);

mount(() =>
  h('button', { onClick: () => setCount(count() + 1) },
    () => `Clicked ${count()} times`
  ),
  '#app'
);
```

## Features

- **Real DOM** — `h()` creates actual DOM elements with reactive bindings. No virtual DOM, no diffing overhead.
- **Fine-grained reactivity** — signals, effects, computed values via alien-signals. Only what changed updates.
- **Islands architecture** — `activateIslands()` for independent hydration of server-rendered HTML regions.
- **SSR hydration** — `adoptNode()` walks server-rendered DOM and attaches reactive bindings without re-creating elements.
- **Conditional rendering** — `createShow()`, `createSwitch()` with branch caching for O(1) toggle.
- **List rendering** — `createList()` with LIS-based keyed reconciliation, handles 50K+ rows.
- **State management** — `createStore()` with deep reactivity, history, persistence.

## Ecosystem

- [forma](https://github.com/getforma-dev/forma) — Rust server framework (forma-ir + forma-server)
- [forma-tools](https://github.com/getforma-dev/forma-tools) — Build tooling (@getforma/compiler + @getforma/build)
- [create-forma-app](https://github.com/getforma-dev/create-forma-app) — CLI scaffolder

## License

MIT
