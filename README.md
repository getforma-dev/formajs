# FormaJS

[![CI](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml/badge.svg)](https://github.com/getforma-dev/formajs/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/formajs)](https://www.npmjs.com/package/formajs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Reactive DOM library with fine-grained signals, islands architecture, and SSR hydration. ~15KB gzipped.

## Install

```bash
npm install formajs
```

## Quick Start

```typescript
import { createSignal, h, mount } from 'formajs';

const [count, setCount] = createSignal(0);

mount(() =>
  h('button', { onClick: () => setCount(count() + 1) },
    () => `Clicked ${count()} times`
  ),
  '#app'
);
```

## Features

- **Fine-grained reactivity** — signals, effects, computed values via alien-signals
- **Virtual DOM** — `h()` function with reactive attribute and text binding
- **Islands architecture** — `activateIslands()` for partial hydration of server-rendered HTML
- **Conditional rendering** — `createShow()`, `createSwitch()` with cached branches
- **List rendering** — `createList()` with keyed reconciliation, handles 50K+ rows
- **State management** — `createStore()` with deep reactivity, history, persistence
- **SSR support** — server-side rendering runtime with hydration

## Ecosystem

- [forma](https://github.com/getforma-dev/forma) — Rust server framework (forma-ir + forma-server)
- [forma-tools](https://github.com/getforma-dev/forma-tools) — Build tooling (@getforma/compiler + @getforma/build)
- [create-forma-app](https://github.com/getforma-dev/create-forma-app) — CLI scaffolder

## License

MIT
