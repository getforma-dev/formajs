/**
 * Island activation through both props channels.
 *
 * `activateIslands` reads props one of two ways (src/dom/activate.ts):
 *
 *   - inline  — `data-forma-props` on each island, one `JSON.parse` per island.
 *   - shared  — a single `<script id="__forma_islands">` block, parsed once for
 *               the whole page and indexed by island id.
 *
 * The shared channel exists because the inline one costs an attribute read plus
 * a parse per island; whether that is actually true at page scale is the
 * question these benchmarks answer.
 *
 * The hardening lane changed both readers: shared props now require an actual
 * `<script>` element (a `getElementById` match on any node let user content
 * supply every island's props) and a malformed block degrades to `null` instead
 * of throwing before the loop. Both are on the once-per-page path, so they are
 * measured at page scale rather than per island.
 */

import { bench, describe } from 'vitest';
import { createSignal } from 'forma/reactive';
import { h, activateIslands, deactivateAllIslands } from 'forma/dom';
import { MACRO, attachedContainer } from './_support';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface CounterProps {
  label: string;
  count: number;
  tags: string[];
}

function propsFor(id: number): CounterProps {
  return { label: `Island ${id}`, count: id, tags: ['a', 'b', 'c'] };
}

/** The SSR shell for one island, including the content adoption will take over. */
function islandShell(id: number, props: string | null): string {
  const inline = props === null ? '' : ` data-forma-props='${props}'`;
  return (
    `<div data-forma-island="${id}" data-forma-component="Counter"${inline}>` +
    `<p class="count"><span class="label">Island ${id}</span>` +
    `<!--f:t0-->${id}<!--/f:t0--></p>` +
    `<button class="btn" type="button">+1</button>` +
    `</div>`
  );
}

function page(count: number, channel: 'inline' | 'shared'): string {
  const parts: string[] = [];
  if (channel === 'shared') {
    const shared: Record<string, CounterProps> = {};
    for (let i = 0; i < count; i++) shared[String(i)] = propsFor(i);
    parts.push(
      `<script id="__forma_islands" type="application/json">${JSON.stringify(shared)}</script>`,
    );
  }
  for (let i = 0; i < count; i++) {
    parts.push(islandShell(i, channel === 'inline' ? JSON.stringify(propsFor(i)) : null));
  }
  return parts.join('');
}

/**
 * A hydrate function shaped like a real island: it reads its props, creates a
 * signal, and returns a descriptor tree that adoption binds against the shell.
 */
const registry = {
  Counter: (el: HTMLElement, props: Record<string, unknown> | null): unknown => {
    const [count] = createSignal(Number(props?.count ?? 0));
    return h('div', null,
      h('p', { class: 'count' },
        h('span', { class: 'label' }, String(props?.label ?? el.dataset.formaComponent)),
        () => String(count()),
      ),
      h('button', { class: 'btn', type: 'button', onClick: () => {} }, '+1'),
    );
  },
};

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

describe('island activation: inline vs shared props', () => {
  for (const count of [10, 100] as const) {
    const inlineMarkup = page(count, 'inline');
    const sharedMarkup = page(count, 'shared');

    // Prove both channels actually deliver props before measuring them: an
    // island that silently activates with `null` props would be a much faster
    // benchmark of nothing.
    for (const [channel, markup] of [['inline', inlineMarkup], ['shared', sharedMarkup]] as const) {
      const host = attachedContainer(markup);
      const seen: Array<Record<string, unknown> | null> = [];
      activateIslands(
        { Counter: (el, props) => { seen.push(props); return registry.Counter(el, props); } },
        host,
      );
      if (seen.length !== count || seen[0]?.label !== 'Island 0') {
        throw new Error(
          `${channel} props channel did not reach all ${count} islands (got ${JSON.stringify(seen[0])})`,
        );
      }
      if (host.querySelector('[data-forma-island]')!.getAttribute('data-forma-status') !== 'active') {
        throw new Error(`${channel} channel: island did not reach status="active"`);
      }
      deactivateAllIslands(host);
      host.remove();
    }

    // The host is attached and removed inside every cycle. Attached because the
    // shared-props block is looked up as a document-level `<script>`, and a
    // detached subtree is not in the document; removed because a page that
    // accumulates 200 iterations' worth of islands measures the accumulation.
    bench(`${count} islands, inline props: parse markup only (control)`, () => {
      attachedContainer(inlineMarkup).remove();
    }, MACRO);

    bench(`${count} islands, inline props: parse + activateIslands`, () => {
      const host = attachedContainer(inlineMarkup);
      activateIslands(registry, host);
      deactivateAllIslands(host);
      host.remove();
    }, MACRO);

    bench(`${count} islands, shared props: parse markup only (control)`, () => {
      attachedContainer(sharedMarkup).remove();
    }, MACRO);

    bench(`${count} islands, shared props: parse + activateIslands`, () => {
      const host = attachedContainer(sharedMarkup);
      activateIslands(registry, host);
      deactivateAllIslands(host);
      host.remove();
    }, MACRO);
  }
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe('island teardown', () => {
  const markup = page(100, 'shared');

  bench('100 islands: activate + deactivateAllIslands (round trip)', () => {
    const host = attachedContainer(markup);
    activateIslands(registry, host);
    deactivateAllIslands(host);
    host.remove();
  }, MACRO);

  bench('100 islands: activate only (control)', () => {
    const host = attachedContainer(markup);
    activateIslands(registry, host);
    host.remove();
  }, MACRO);
});
