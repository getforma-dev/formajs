# Forma dogfood findings

Forma applications are integration tests for the stack. When an application exposes a
framework or toolchain defect, the fix belongs in the owning repository and the
application must verify the released or linked fix before the finding is closed.

## Required workflow

1. Record the consuming application, affected package/version, minimal reproduction,
   and owning repository.
2. Add the smallest failing regression test in the owning repository.
3. Fix the owner rather than carrying an app-only framework workaround.
4. Link the issue or pull request and identify the release containing the fix.
5. Reinstall that release in the discovering application and rerun its regression gate.

## Active review

| ID | Found in | Owner | Finding and regression | Status |
|---|---|---|---|---|
| FD-001 | Forma Vector Studio | `formajs` | A synchronous `data-bind:*` effect could remove an attribute from the live `NamedNodeMap`, shifting indices and skipping an adjacent `data-class:*` or `data-on:*` directive. Verified by `src/__tests__/runtime-bind-security.test.ts` > "does not skip adjacent directives when a binding removes an attribute". | Fixed in [Formajs PR #9](https://github.com/getforma-dev/formajs/pull/9); released in `@getforma/core` 2.0.1. |
| FD-002 | Forma Vector Studio | `formajs` | Split runtime chunks were not declared in `sideEffects`, so a linked consumer could drop required bare side-effect imports. Wildcard promises are now validated against actual distribution artifacts by `scripts/verify-dist.mjs`. | Fixed in [Formajs PR #9](https://github.com/getforma-dev/formajs/pull/9); released in `@getforma/core` 2.0.1. |
| FD-003 | Forma Tools full-stack E2E | `forma-tools` | Local fixture sync requested the removed `dist/formajs.global.js` artifact and therefore tested a stale committed fixture. The shared sync path now bundles the shipped `forma.esm.js` into the required `FormaJS` IIFE for local and CI runs. | Fixed in [Forma Tools PR #6](https://github.com/getforma-dev/forma-tools/pull/6); review pending. |

## Resolved cross-repo findings

| Finding | Owner and resolution | Downstream proof |
|---|---|---|
| Compiler import-entered frames eagerly minted bindings for unread store signals. | `forma-tools` [PR #5](https://github.com/getforma-dev/forma-tools/pull/5), released as `@getforma/compiler` 0.3.5. | Gatewasm compiler regression suite and build-report artifact. |
| Compiler/build degradation needed a ratchet visible in CI. | `gatewasm` [PR #10](https://github.com/getforma-dev/gatewasm/pull/10). | Build report is generated and checked in the Gatewasm regression gate. |
| Gatewasm still consumed the pre-fix compiler. | `gatewasm` [PR #11](https://github.com/getforma-dev/gatewasm/pull/11), bumped to compiler 0.3.5. | Gatewasm `main` regression gate. |

App-owned defects remain in the app repository. For example, Vector's bracket-aware
Tailwind class tokenization belongs to its HTML/vector parser; it is not tracked here as
a FormaJS defect.
