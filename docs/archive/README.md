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

*(none yet — this directory was created 2026-08-05 with the docs restructure)*

## Retired and corrected claims

| Claim | Where it lived | Retired | Why |
|---|---|---|---|
| The README was the entire narrative documentation set: install, three entry points, the expression grammar, the whole core API, islands and SSR, CDN builds, subpath exports, comparisons and the stability table — about 1,170 lines in one file | `README.md` | 2026-08-05 | Nobody re-reads 1,170 lines to check one sentence, which is a large part of why so many claims in it rotted unnoticed. The narrative now lives in [`../API.md`](../API.md), [`../HTML-RUNTIME.md`](../HTML-RUNTIME.md), [`../ISLANDS.md`](../ISLANDS.md), [`../CDN-AND-EXPORTS.md`](../CDN-AND-EXPORTS.md), [`../COMPARISONS.md`](../COMPARISONS.md) and [`../STABILITY.md`](../STABILITY.md), each with its citations carried across unchanged. **The README edit itself is pending** — see [`../PENDING-README-SPLIT.md`](../PENDING-README-SPLIT.md) — because the split had to be prepared while the source tree was frozen for other work. |

## Pending moves — proposed, not yet done

These need a change to a file this pass was not allowed to touch. They are
listed so the next person does not have to re-derive them.

| Material | Proposal | Reason |
|---|---|---|
| [`../HARDENING-AUDIT.md`](../HARDENING-AUDIT.md) | Move to `docs/archive/2026-08-05-hardening-audit.md` **once its ledger is closed**, leaving a pointer in `docs/README.md` | It is a completed point-in-time audit: every finding has a fix and a citation, and the fixes are in `CHANGELOG.md`. It reads as current documentation while sitting next to the reference docs, which is exactly the confusion this archive exists to prevent. Note that `src/__tests__/docs-truth.test.ts` resolves the citations inside it by path (`docs/HARDENING-AUDIT.md` is a key in its `DOCS` map), so the move and the test edit are one change. |
| The version history table at the bottom of [`../../CSP.md`](../../CSP.md) | Keep, but re-check the `> 1.5.0` row when the next release ships | It describes the fixed behaviour as landing *after* 1.5.0, while 1.5.0 is the current version in `package.json` — i.e. the row describes an unreleased build. That is honest today and becomes wrong the moment a release is cut without updating it. |
