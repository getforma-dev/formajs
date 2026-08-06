# Archive — `formajs`

Nothing here is current. Everything here was once published or relied on, and
is kept so a reader who meets a stale claim can find out what replaced it and
why.

**How to add an entry.** Never delete a superseded document: move it into this
directory with a `YYYY-MM-DD-` prefix and add a row below. If you corrected a
false claim inside a live document instead of retiring the whole file, still
add a row.

---

## Retired documents

| Document | Retired | What it was, and why it moved |
|---|---|---|
| [`2026-08-05-hardening-audit.md`](2026-08-05-hardening-audit.md) | 2026-08-06 | The five-lens hardening audit of 1.5.0: 55 entries, every one closed with a **Fixed:** line and a `Verified by:` citation. A completed point-in-time ledger reads as current documentation when it sits next to the reference docs, which is the confusion this directory exists to prevent. The fixes it records are in `CHANGELOG.md`; what is true today is in the pages listed in [`../README.md`](../README.md). Its citations are **still machine-checked** — `src/__tests__/docs-truth.test.ts` resolves them by path, so the move and the test edit were one change. |

## Retired and corrected claims

| Claim | Where it lived | Retired | Why |
|---|---|---|---|
| The README was the entire narrative documentation set: install, three entry points, the expression grammar, the whole core API, islands and SSR, CDN builds, subpath exports, comparisons and the stability table — about 1,170 lines in one file | `README.md` | 2026-08-06 | Nobody re-reads 1,170 lines to check one sentence, which is a large part of why so many claims in it rotted unnoticed. The narrative now lives in [`../API.md`](../API.md), [`../HTML-RUNTIME.md`](../HTML-RUNTIME.md), [`../ISLANDS.md`](../ISLANDS.md), [`../CDN-AND-EXPORTS.md`](../CDN-AND-EXPORTS.md), [`../COMPARISONS.md`](../COMPARISONS.md) and [`../STABILITY.md`](../STABILITY.md), each with its citations carried across unchanged. The pages were written on 2026-08-05 while the source tree was frozen; the README edit and the paired test edits landed together on 2026-08-06, and the instruction list that carried them (`docs/PENDING-README-SPLIT.md`) was deleted on landing as it asked to be. |
| "WASM render … unreachable before 1.6.0" | `README.md` Stability table | 2026-08-06 | A prediction about a version number nobody had committed to. What is checkable: `./wasm` had no build entry, no dist output and no `exports` key from 0.7.1 through 1.5.0, so the import always failed; the subpath exists in the working tree and first ships in the next release, whatever it is numbered. [`../STABILITY.md`](../STABILITY.md) states that, and the `window.__FORMA_WASM__` requirement, and nothing else. |
| The CSP version-history row `> 1.5.0` | `CSP.md` | 2026-08-06 | It described a build nobody could install — correct on the day it was written, wrong the moment a release was cut without touching it. The row is now labelled `Unreleased`, like the CHANGELOG heading it tracks, and a test pins both that label and the released row below it to `package.json`. |

## Pending moves — proposed, not yet done

These need a change this pass could not make. They are listed so the next
person does not have to re-derive them.

| Material | Proposal | Reason |
|---|---|---|
| [`../../CSP.md`](../../CSP.md) and [`../../README.md`](../../README.md) | A joint pass **when the CSP grammar work reaches its next milestone** | The design record ([`../design/CSP-SAFE-EXPRESSION-GRAMMAR.md`](../design/CSP-SAFE-EXPRESSION-GRAMMAR.md)) is SHIPPED, and CSP.md and the README both already state the eval-free guarantee. What is still owed is the pass that folds any *further* grammar change into both at once: today the README states the promise, [`../HTML-RUNTIME.md`](../HTML-RUNTIME.md) states the grammar, and CSP.md states the posture, and nothing mechanically stops the three drifting apart on the day the grammar grows. Whoever widens the allowlist owns all three edits in the same change. |
