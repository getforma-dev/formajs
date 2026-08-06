/**
 * `renderToString` — the server half of the thesis.
 *
 * The hardening lane rewrote `renderAttr` (src/ssr/render.ts) so every emitted
 * attribute now passes `isEventHandlerAttr` + `isSafeAttrName`, and every URL
 * attribute additionally passes `isDangerousUrl`. Server render time is a
 * per-request cost, so a regression here is paid on every page view rather than
 * once per session — the `URL-free (control)` variants exist so the URL check
 * can be priced separately from the name checks.
 */

import { bench, describe } from 'vitest';
import { renderToString, sh, type VNode } from 'forma/ssr';
import { HEAVY, MACRO, makeRows, type Row } from './_support';

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/** A card with one URL-bearing attribute, five plain ones and nested text. */
function card(row: Row): VNode {
  return sh('article', { class: 'card', 'data-id': String(row.id) },
    sh('header', { class: 'card-head' },
      sh('h3', { class: 'card-title', title: row.label }, row.label),
      sh('a', { class: 'card-link', href: `/item/${row.id}`, rel: 'noopener' }, 'open'),
    ),
    sh('p', { class: 'card-body' }, 'Lorem ipsum dolor sit amet, consectetur.'),
    sh('footer', { class: 'card-foot' }, sh('span', { class: 'badge' }, row.done ? 'done' : 'open')),
  );
}

/** The same card with `href` renamed so no attribute is URL-bearing. */
function cardNoUrl(row: Row): VNode {
  return sh('article', { class: 'card', 'data-id': String(row.id) },
    sh('header', { class: 'card-head' },
      sh('h3', { class: 'card-title', title: row.label }, row.label),
      sh('a', { class: 'card-link', 'data-link': `/item/${row.id}`, rel: 'noopener' }, 'open'),
    ),
    sh('p', { class: 'card-body' }, 'Lorem ipsum dolor sit amet, consectetur.'),
    sh('footer', { class: 'card-foot' }, sh('span', { class: 'badge' }, row.done ? 'done' : 'open')),
  );
}

function page(rows: Row[], builder: (row: Row) => VNode): VNode {
  return sh('main', { class: 'page', id: 'app' }, ...rows.map(builder));
}

// ---------------------------------------------------------------------------
// Size sweep
// ---------------------------------------------------------------------------

describe('renderToString: tree size sweep', () => {
  for (const [n, preset] of [[10, MACRO], [100, MACRO], [1000, MACRO], [5000, HEAVY]] as const) {
    const tree = page(makeRows(n), card);
    const bytes = renderToString(tree).length;
    bench(`${n} cards (~${Math.round(bytes / 1024)} KB of HTML)`, () => {
      renderToString(tree);
    }, preset);
  }
});

// ---------------------------------------------------------------------------
// What the attribute guards cost the server
// ---------------------------------------------------------------------------

describe('renderToString: URL-attribute guard cost', () => {
  const rows = makeRows(1000);
  const withUrl = page(rows, card);
  const withoutUrl = page(rows, cardNoUrl);

  bench('1000 cards, one href each', () => {
    renderToString(withUrl);
  }, MACRO);

  bench('1000 cards, same attrs, none URL-bearing (control)', () => {
    renderToString(withoutUrl);
  }, MACRO);
});

// ---------------------------------------------------------------------------
// Signal-valued props — the SSR-reactive path
// ---------------------------------------------------------------------------

describe('renderToString: reactive props and children', () => {
  const rows = makeRows(500);
  const staticTree = sh('ul', { class: 'todos' },
    ...rows.map((r) => sh('li', { class: 'todo', 'data-id': String(r.id) }, r.label)),
  );
  const reactiveTree = sh('ul', { class: 'todos' },
    ...rows.map((r) => sh('li', { class: () => 'todo', 'data-id': () => String(r.id) }, () => r.label)),
  );

  bench('500 list items, plain values', () => {
    renderToString(staticTree);
  }, MACRO);

  bench('500 list items, every prop and child a getter', () => {
    renderToString(reactiveTree);
  }, MACRO);
});
