# S7 — Turbo Streams Evaluation

**Status:** Design evaluation complete. No implementation in this phase.

## Question: Can FormaJS support targeted server-pushed DOM mutations?

**Answer: Yes, with existing primitives.** No new module needed.

## How It Works

The reconciler (`src/dom/reconcile.ts`) already handles HTML-string-to-DOM diffing. The SSE and WebSocket primitives already support custom event handlers and parsers. Wiring them together is a thin application-level pattern, not a framework feature.

```typescript
import { createSSE } from '@getforma/core';
import { reconcile } from '@getforma/core'; // or internal import

const sse = createSSE('/stream');

sse.on('mutation', (html: string) => {
  const target = document.getElementById('messages');
  if (target) reconcile(target, html);
});
```

## Constraints

1. **Container-level, not selector-level.** The reconciler operates on a container element's children, not arbitrary selectors. The server sends a full HTML fragment for that container's content. Elements are matched by `data-forma-id` (keyed) or position.

2. **HTML fragments, not JSON actions.** Unlike Turbo Streams' 7 named actions (append, prepend, replace, update, remove, before, after), FormaJS's reconciler takes raw HTML and diffs it. This is simpler but less granular — the server always sends the "desired state," not a mutation command.

3. **No new API needed.** `createSSE` + `reconcile()` is sufficient. A convenience wrapper could be built, but it would be ~10 lines of application code, not a framework primitive.

## Recommendation

**Do not build a framework-level Turbo Streams abstraction.** The existing primitives compose cleanly. Document the pattern in the cookbook/examples instead. If demand emerges for action-based mutations (append/remove/etc.), evaluate at that point — but the reconciler's diffing approach covers 90% of use cases without the complexity of a custom action protocol.

## Comparison

| | Turbo Streams | FormaJS (today) |
|--|---------------|-----------------|
| **Transport** | SSE, WebSocket | `createSSE`, `createWebSocket` |
| **Format** | `<turbo-stream action="append">` HTML | Raw HTML fragment |
| **Targeting** | `target="element-id"` | Container element passed to `reconcile()` |
| **Actions** | 7 named actions | Diff-based (desired state, not mutations) |
| **Framework code needed** | Built into Turbo | ~10 lines of app code |
