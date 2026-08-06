/**
 * `h()` attribute writes, split by which guards the write actually pays for.
 *
 * The hardening lane put two checks on the generic attribute path
 * (src/dom/element.ts, `handleGenericAttr` / `applyStaticProp`):
 *
 *   1. `isEventHandlerAttr(key)` — a `/^on/i` regex test on the prop NAME.
 *      Paid by every generic attribute write, static or reactive.
 *   2. `isDangerousUrl(value, tag)` — normalizes the value with an allocating
 *      `String.replace` and runs two regexes over it. Paid ONLY when the prop
 *      name is one of the eight URL-bearing attributes.
 *
 * So the split below is the point of this file: `static attrs` and
 * `dynamic attrs` pay (1) only, `URL-bearing` pays (1) and (2). A regression in
 * the URL row that does not show up in the static row is the URL check, and
 * nothing else.
 *
 * `handleGenericAttr` hoists the `isUrlAttr(key)` lookup out of the reactive
 * closure, so a reactive binding pays the name lookup once and the value check
 * per run. The `dynamic … updates` benchmarks are what makes that visible.
 */

import { bench, describe } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { h } from 'forma/dom';
import {
  isDangerousUrl,
  isEventHandlerAttr,
  isUnsafeAttrWrite,
  isUrlAttr,
} from 'forma/security/url-safety';
import { MICRO, detachedContainer } from './_support';

// ---------------------------------------------------------------------------
// The guards, on their own
// ---------------------------------------------------------------------------

/**
 * Guard cost with no DOM underneath it. This is the ceiling on what the
 * hardening can possibly have cost per attribute — everything else in this file
 * measures that number diluted by real `setAttribute` work.
 */
describe('attribute-safety guards in isolation', () => {
  const CALLS = 20_000;
  const SAFE_URL = 'https://cdn.example.com/assets/app.9f2c1b.js?v=3';
  const DANGEROUS_URL = 'java\tscript:alert(1)';

  bench(`isEventHandlerAttr on a non-event name (×${CALLS})`, () => {
    let n = 0;
    for (let i = 0; i < CALLS; i++) if (isEventHandlerAttr('class')) n++;
    if (n !== 0) throw new Error('"class" is not an event-handler name');
  }, MICRO);

  bench(`isUrlAttr on a non-URL name (×${CALLS})`, () => {
    let n = 0;
    for (let i = 0; i < CALLS; i++) if (isUrlAttr('class')) n++;
    if (n !== 0) throw new Error('"class" is not a URL attribute');
  }, MICRO);

  bench(`isDangerousUrl on a benign https URL (×${CALLS})`, () => {
    let n = 0;
    for (let i = 0; i < CALLS; i++) if (isDangerousUrl(SAFE_URL, 'a')) n++;
    if (n !== 0) throw new Error('a benign URL must not be flagged');
  }, MICRO);

  bench(`isDangerousUrl on an obfuscated javascript: URL (×${CALLS})`, () => {
    let n = 0;
    for (let i = 0; i < CALLS; i++) if (isDangerousUrl(DANGEROUS_URL, 'a')) n++;
    if (n !== CALLS) throw new Error('the payload must be flagged');
  }, MICRO);

  bench(`isUnsafeAttrWrite on <a href> with a benign URL (×${CALLS})`, () => {
    let n = 0;
    for (let i = 0; i < CALLS; i++) if (isUnsafeAttrWrite('a', 'href', SAFE_URL)) n++;
    if (n !== 0) throw new Error('a benign URL must not be flagged');
  }, MICRO);
});

// ---------------------------------------------------------------------------
// Static attribute writes
// ---------------------------------------------------------------------------

describe('h(): static attribute writes', () => {
  const NODES = 500;

  bench(`h('div') with 4 static non-URL attrs (×${NODES})`, () => {
    const parent = detachedContainer();
    for (let i = 0; i < NODES; i++) {
      parent.appendChild(h('div', {
        id: `n${i}`,
        class: 'row item',
        title: 'a row',
        'data-index': String(i),
      }));
    }
  }, MICRO);

  /**
   * The same four attributes written with no library in the way. The gap is
   * everything `h()` does — namespace resolution, the prop dispatch table, the
   * guards — so it is the honest denominator for "what did the guards cost".
   */
  bench(`document.createElement + 4 setAttribute, no library (×${NODES})`, () => {
    const parent = detachedContainer();
    for (let i = 0; i < NODES; i++) {
      const el = document.createElement('div');
      el.setAttribute('id', `n${i}`);
      el.setAttribute('class', 'row item');
      el.setAttribute('title', 'a row');
      el.setAttribute('data-index', String(i));
      parent.appendChild(el);
    }
  }, MICRO);

  bench(`h('div') with no props (×${NODES})`, () => {
    const parent = detachedContainer();
    for (let i = 0; i < NODES; i++) parent.appendChild(h('div', null, 'text'));
  }, MICRO);
});

// ---------------------------------------------------------------------------
// URL-bearing static writes — the only ones that pay isDangerousUrl
// ---------------------------------------------------------------------------

describe('h(): URL-bearing static attribute writes', () => {
  const NODES = 500;

  bench(`h('a') with href + 3 static non-URL attrs (×${NODES})`, () => {
    const parent = detachedContainer();
    for (let i = 0; i < NODES; i++) {
      parent.appendChild(h('a', {
        href: `https://example.com/item/${i}?ref=list`,
        class: 'row item',
        title: 'a row',
        'data-index': String(i),
      }));
    }
  }, MICRO);

  /**
   * Same element, same attribute count, but `href` renamed to a non-URL name so
   * `isUrlAttr` short-circuits.
   *
   * This is NOT a clean isolation of `isDangerousUrl`: measured against the
   * pre-hardening tree, which runs no URL check at all, the `href` row is
   * already the slower of the two — the DOM itself treats `href`/`src` as
   * reflected URL properties and does its own work on them. The pair is still
   * worth having (it is the total cost of putting a URL in an attribute), but
   * the guard's cost is attributed by the A/B in docs/PERFORMANCE.md, not by
   * subtracting these two rows.
   */
  bench(`h('a') with the same 4 attrs, none URL-bearing (control) (×${NODES})`, () => {
    const parent = detachedContainer();
    for (let i = 0; i < NODES; i++) {
      parent.appendChild(h('a', {
        'data-href': `https://example.com/item/${i}?ref=list`,
        class: 'row item',
        title: 'a row',
        'data-index': String(i),
      }));
    }
  }, MICRO);

  bench(`h('img') with src + srcset + alt (×${NODES})`, () => {
    const parent = detachedContainer();
    for (let i = 0; i < NODES; i++) {
      parent.appendChild(h('img', {
        src: `/img/${i}.webp`,
        srcset: `/img/${i}.webp 1x, /img/${i}@2x.webp 2x`,
        alt: `image ${i}`,
      }));
    }
  }, MICRO);
});

// ---------------------------------------------------------------------------
// Reactive attribute writes — the guards run on every re-run
// ---------------------------------------------------------------------------

describe('h(): reactive attribute updates', () => {
  const UPDATES = 500;
  const URL_A = 'https://example.com/stable';
  const URL_B = 'https://example.com/other';

  function reactiveAttrs(urlBearing: boolean) {
    return createRoot(() => {
      const [n, setN] = createSignal(0);
      const parent = detachedContainer();
      const props: Record<string, unknown> = {
        class: () => `row item-${n()}`,
        title: () => `row ${n()}`,
      };
      if (urlBearing) props.href = () => `https://example.com/item/${n()}`;
      else props['data-target'] = () => `https://example.com/item/${n()}`;
      parent.appendChild(h('a', props));
      return setN;
    });
  }

  const withUrl = reactiveAttrs(true);
  let a = 0;
  bench(`3 reactive attrs incl. href: signal write → attr writes (×${UPDATES})`, () => {
    for (let i = 0; i < UPDATES; i++) withUrl(++a);
  }, MICRO);

  const withoutUrl = reactiveAttrs(false);
  let b = 0;
  bench(`3 reactive attrs, none URL-bearing (control): write (×${UPDATES})`, () => {
    for (let i = 0; i < UPDATES; i++) withoutUrl(++b);
  }, MICRO);

  /**
   * Equal-value updates: `handleGenericAttr` caches the last written string and
   * returns before touching the DOM. The URL guard runs BEFORE that cache check,
   * so this row is the one where the guard is the whole cost. The binding must
   * still READ the signal (otherwise it has no dependency and the writes below
   * would flush nothing at all), so it reads it and discards it.
   */
  const cached = createRoot(() => {
    const [n, setN] = createSignal(0);
    const parent = detachedContainer();
    parent.appendChild(h('a', { href: () => (n() >= 0 ? URL_A : URL_B) }));
    return setN;
  });
  let c = 0;
  bench(`href bound to an unchanging URL: write → cache hit (×${UPDATES})`, () => {
    for (let i = 0; i < UPDATES; i++) cached(++c);
  }, MICRO);
});

// ---------------------------------------------------------------------------
// Whole-element construction, the shape a component actually builds
// ---------------------------------------------------------------------------

describe('h(): realistic component subtree', () => {
  const SUBTREES = 200;

  bench(`card subtree: 6 elements, 11 attrs, 1 href, 2 handlers (×${SUBTREES})`, () => {
    const parent = detachedContainer();
    for (let i = 0; i < SUBTREES; i++) {
      parent.appendChild(
        h('article', { class: 'card', 'data-id': String(i) },
          h('header', { class: 'card-head' },
            h('h3', { class: 'card-title', title: `Item ${i}` }, `Item ${i}`),
            h('a', { class: 'card-link', href: `/item/${i}`, rel: 'noopener' }, 'open'),
          ),
          h('p', { class: 'card-body' }, 'Lorem ipsum dolor sit amet'),
          h('button', { class: 'btn', type: 'button', onClick: () => {} }, 'Buy'),
          h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => {} }, 'Save'),
        ),
      );
    }
  }, MICRO);
});
