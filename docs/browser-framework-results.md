# Browser framework comparison

Recorded 2026-08-13T02:40:47.099Z from commit `a35e286e3cef` with uncommitted benchmark changes.

## Scope

This is local developer benchmark infrastructure. It is not application code, a production endpoint, or content shipped in the FormaJS package.

Production FormaJS 2.0.1 is compared with React 19.2.8 and the stable React Compiler 1.0.0. React Compiler output was verified before the run. TanStack Query 5.101.4 appears only in the server-state lane.

These results describe this machine and the recorded browser builds, not a universal framework ranking. A ratio above 1.00 means React took longer in this capture. Believe a difference only when it is larger than the recorded sample spread in the adjacent JSON.

## Runtime work

### Chromium 151.0.7922.34

| Scenario | Forma median / p95 | React Compiler median / p95 | React ÷ Forma |
|---|---:|---:|---:|
| Mount 1 widgets | 0.100 ms / 0.150 ms | 0.180 ms / 0.280 ms | 1.80× |
| Mount 50 widgets | 0.250 ms / 0.775 ms | 0.425 ms / 0.620 ms | 1.70× |
| Mount 100 widgets | 0.360 ms / 1.29 ms | 0.585 ms / 0.835 ms | 1.62× |
| Mount 500 widgets | 1.31 ms / 2.08 ms | 1.75 ms / 2.00 ms | 1.34× |
| Committed update 1 of 500 widgets | 0.26 µs / 0.28 µs | 0.033 ms / 0.034 ms | 129.93× |
| Committed update all 500 widgets | 0.152 ms / 0.166 ms | 0.627 ms / 0.667 ms | 4.12× |
| Reverse 1000 keyed rows | 0.780 ms / 0.823 ms | 2.27 ms / 2.38 ms | 2.91× |

### Firefox 153.0

| Scenario | Forma median / p95 | React Compiler median / p95 | React ÷ Forma |
|---|---:|---:|---:|
| Mount 1 widgets | 0.120 ms / 0.500 ms | 0.460 ms / 1.36 ms | 3.83× |
| Mount 50 widgets | 0.400 ms / 0.740 ms | 0.860 ms / 1.22 ms | 2.15× |
| Mount 100 widgets | 0.560 ms / 0.940 ms | 1.14 ms / 1.52 ms | 2.04× |
| Mount 500 widgets | 2.18 ms / 4.58 ms | 5.42 ms / 10.20 ms | 2.49× |
| Committed update 1 of 500 widgets | 0.50 µs / 0.77 µs | 0.075 ms / 0.095 ms | 149.98× |
| Committed update all 500 widgets | 0.250 ms / 0.289 ms | 1.38 ms / 1.63 ms | 5.51× |
| Reverse 1000 keyed rows | 1.53 ms / 2.24 ms | 7.82 ms / 8.63 ms | 5.11× |

### WebKit 26.5

| Scenario | Forma median / p95 | React Compiler median / p95 | React ÷ Forma |
|---|---:|---:|---:|
| Mount 1 widgets | 0.140 ms / 0.200 ms | 0.320 ms / 0.420 ms | 2.29× |
| Mount 50 widgets | 0.420 ms / 0.580 ms | 0.640 ms / 1.00 ms | 1.52× |
| Mount 100 widgets | 0.600 ms / 0.740 ms | 0.900 ms / 1.30 ms | 1.50× |
| Mount 500 widgets | 2.28 ms / 2.60 ms | 3.16 ms / 3.78 ms | 1.39× |
| Committed update 1 of 500 widgets | 0.36 µs / 0.55 µs | 0.031 ms / 0.032 ms | 86.82× |
| Committed update all 500 widgets | 0.181 ms / 0.215 ms | 0.588 ms / 0.629 ms | 3.25× |
| Reverse 1000 keyed rows | 1.49 ms / 1.54 ms | 3.81 ms / 3.93 ms | 2.56× |

The update cases use identical visible DOM. React updates are wrapped in `flushSync`, so the measured interval contains render and commit instead of timing only the state enqueue. Forma uses a signal write, with `batch()` for the broad update. This is a synchronous committed-update lane; it does not measure React transitions or concurrent batching.

## Chromium retained heap after 500 widgets

| Runtime | Retained delta | DOM nodes |
|---|---:|---:|
| Forma | 284.5 KiB | 2,001 |
| React Compiler | 920.1 KiB | 2,001 |

Chromium garbage collection is requested before both heap readings. The delta includes each runtime's live state graph for the mounted fixture.

## Server-state fan-out (50 consumers)

| Browser | Mode | Settle median | Browser requests | Provider executions |
|---|---|---:|---:|---:|
| Chromium | forma isolated | 48.92 ms | 50 | 1 |
| Chromium | forma shared | 24.51 ms | 1 | 1 |
| Chromium | react query | 24.96 ms | 1 | 1 |
| Firefox | forma isolated | 48.10 ms | 50 | 1 |
| Firefox | forma shared | 28.82 ms | 1 | 1 |
| Firefox | react query | 30.20 ms | 1 | 1 |
| WebKit | forma isolated | 48.20 ms | 50 | 1 |
| WebKit | forma shared | 32.46 ms | 1 | 1 |
| WebKit | react query | 32.16 ms | 1 | 1 |

- **Forma isolated** models one resource per widget, like independent declarative `data-fetch` hosts. The simulated broker coalesces provider work, but browser ingress remains per widget.
- **Forma shared** hoists one Forma resource and lets every widget observe it.
- **React Query** lets every component declare the same query key; Query shares the browser request automatically.

This lane intentionally reports both browser requests and provider executions. Crediting the server broker's coalescing to the FormaJS renderer would be misleading.

## Production bundle payload

| Fixture | Raw | gzip | Brotli |
|---|---:|---:|---:|
| forma.js | 31.0 KiB | 10.9 KiB | 9.7 KiB |
| forma-query.js | 31.5 KiB | 11.1 KiB | 9.9 KiB |
| react.js | 191.6 KiB | 59.8 KiB | 51.4 KiB |
| react-query.js | 224.9 KiB | 69.4 KiB | 60.2 KiB |

The server-state payload is kept out of both ordinary runtime fixtures. Forma imports its public package entry; production tree shaking applies to both sides.

## Method

- 12 recorded samples after 3 warmups.
- Chromium 151.0.7922.34; Firefox 153.0; WebKit 26.5; darwin arm64; Apple M1 Pro.
- Each runtime owns a separate warmed page. No benchmark workers share a CPU.
- Every fixture is cross-origin isolated so its browser exposes high-resolution timers.
- `script_ms` includes synchronous update work; server-state operations include async settlement.
- `settled_ms` in the JSON additionally includes two animation-frame boundaries.
- Repeated update and reorder lanes normalize `script_ms` and mutation counts per operation; `settled_ms` describes the whole repeated batch.
- Mutation counts, raw samples, p95, min/max, and run-to-run spread remain in [browser-framework-results.json](browser-framework-results.json).

## Boundaries still required before a public universal claim

1. Repeat the matrix on representative Windows, Linux, Intel Mac, and lower-power hardware. Playwright WebKit is a WebKit engine build, not a claim about a particular Safari release.
2. Add equivalent SSR hydration and streaming fixtures.
3. Add high-frequency telemetry, nested context, forms, and error-boundary cases.
4. Run an established third-party framework benchmark in addition to the product-shaped fixtures.
5. Keep React, React Compiler, TanStack Query, and Forma versions pinned in every published capture.
