/**
 * Layer 2 Hydration Observability: SSR-vs-Client Diff Test
 *
 * Automated test that catches hydration mismatches in CI by comparing:
 *   1. Client render:     h() creates real DOM nodes directly
 *   2. Descriptor render: h() creates HydrationDescriptors, then
 *                         descriptorToElement() converts them back to DOM
 *
 * Both paths should produce structurally equivalent HTML. Divergence here
 * means the descriptor path would silently produce wrong output during
 * island hydration.
 */

import { describe, it, expect } from 'vitest';
import { createSignal, createRoot } from 'forma/reactive';
import { h, createShow } from 'forma/dom';
import {
  setHydrating,
  isDescriptor,
  isShowDescriptor,
  descriptorToElement,
  type HydrationDescriptor,
  type ShowDescriptor,
} from 'forma/dom/hydrate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize HTML for structural comparison:
 * - Strips SSR hydration markers (<!--f:t0-->, <!--/f:s1-->, etc.)
 * - Removes zero-width spaces injected during hydration
 * - Collapses runs of whitespace to a single space
 */
function normalizeHtml(html: string): string {
  return html
    .replace(/<!--\/?f:[tsi]\d+-->/g, '') // Strip hydration markers
    .replace(/\u200B/g, '')               // Remove zero-width spaces
    .replace(/\s+/g, ' ')                 // Collapse whitespace
    .trim();
}

/**
 * Render a component in normal client mode (h() creates real DOM) and
 * return the normalized innerHTML of a wrapper container.
 */
function renderClient(componentFn: () => unknown): string {
  let html = '';
  createRoot((_dispose) => {
    const result = componentFn();
    if (result instanceof Node) {
      const container = document.createElement('div');
      container.appendChild(result as Node);
      html = normalizeHtml(container.innerHTML);
    }
  });
  return html;
}

/**
 * Render a component in hydration (descriptor) mode, convert the top-level
 * HydrationDescriptor back to a real DOM element via descriptorToElement(),
 * and return the normalized innerHTML of a wrapper container.
 *
 * Only works for components whose top-level return is a HydrationDescriptor
 * (i.e., the root call is h(), not createShow()).
 */
function renderDescriptor(componentFn: () => unknown): string {
  let html = '';
  createRoot((_dispose) => {
    setHydrating(true);
    let result: unknown;
    try {
      result = componentFn();
    } finally {
      setHydrating(false);
    }

    if (isDescriptor(result)) {
      const el = descriptorToElement(result as HydrationDescriptor);
      const container = document.createElement('div');
      container.appendChild(el);
      html = normalizeHtml(container.innerHTML);
    }
  });
  return html;
}

/**
 * Render a show branch component in hydration mode.
 * createShow() returns a ShowDescriptor during hydration; extract the
 * initialBranch and convert it using descriptorToElement().
 *
 * Used only for tests that call createShow() at the top level.
 */
function renderShowDescriptorBranch(componentFn: () => unknown): string {
  let html = '';
  createRoot((_dispose) => {
    setHydrating(true);
    let result: unknown;
    try {
      result = componentFn();
    } finally {
      setHydrating(false);
    }

    if (isShowDescriptor(result)) {
      const show = result as ShowDescriptor;
      const branch = show.initialBranch;
      if (isDescriptor(branch)) {
        const el = descriptorToElement(branch as HydrationDescriptor);
        const container = document.createElement('div');
        container.appendChild(el);
        html = normalizeHtml(container.innerHTML);
      }
    }
  });
  return html;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * The client tree and the descriptor tree, both pinned to the EXACT markup.
 *
 * This table replaces 12 tests of the shape
 * `expect(renderClient(c)).toBe(renderDescriptor(c))` plus three of the shape
 * `expect(renderClient(a)).not.toBe(renderDescriptor(b))`. Neither shape can
 * fail for the right reason: the equality ones compare one implementation's
 * output to the same implementation's output (both paths end in `h()`), so a
 * defect that breaks BOTH paths identically is invisible — and the inequality
 * ones assert that two DIFFERENT components render differently, which is true
 * by construction.
 *
 * Pinning the bytes keeps the original property (the two paths agree) and adds
 * the half that was missing (they agree on the RIGHT markup).
 */
const CASES: Array<[name: string, component: () => unknown, html: string]> = [
  [
    'static element tree',
    () => h('div', { class: 'container' }, h('h1', null, 'Title'), h('p', null, 'Description')),
    '<div class="container"><h1>Title</h1><p>Description</p></div>',
  ],
  [
    'element with static props',
    () => h('form', { class: 'login-form', method: 'post' },
      h('input', { type: 'email', placeholder: 'Email' }),
      h('input', { type: 'password', placeholder: 'Password' }),
      h('button', { type: 'submit', class: 'btn primary' }, 'Login'),
    ),
    '<form class="login-form" method="post"><input type="email" placeholder="Email">'
    + '<input type="password" placeholder="Password">'
    + '<button type="submit" class="btn primary">Login</button></form>',
  ],
  [
    'nested elements with mixed children',
    () => h('div', { class: 'card' },
      h('div', { class: 'card-header' }, h('h2', null, 'Card Title'), h('span', { class: 'badge' }, 'Active')),
      h('div', { class: 'card-body' }, h('p', null, 'Some content here'),
        h('ul', null, h('li', null, 'Item 1'), h('li', null, 'Item 2'))),
    ),
    '<div class="card"><div class="card-header"><h2>Card Title</h2>'
    + '<span class="badge">Active</span></div><div class="card-body">'
    + '<p>Some content here</p><ul><li>Item 1</li><li>Item 2</li></ul></div></div>',
  ],
  [
    'void elements (input, br)',
    () => h('form', null,
      h('input', { type: 'text', name: 'email' }),
      h('br', null),
      h('input', { type: 'password', name: 'password' }),
    ),
    '<form><input type="text" name="email"><br><input type="password" name="password"></form>',
  ],
  ['empty elements', () => h('div', { class: 'toast' }), '<div class="toast"></div>'],
  [
    'SVG elements keep their case-sensitive attribute names',
    () => h('svg', { viewBox: '0 0 24 24', fill: 'none' },
      h('path', { d: 'M12 2L2 22h20L12 2z', stroke: 'currentColor' })),
    '<svg viewBox="0 0 24 24" fill="none">'
    + '<path d="M12 2L2 22h20L12 2z" stroke="currentColor"></path></svg>',
  ],
  [
    'deeply nested elements',
    () => h('section', { class: 'page' },
      h('nav', { class: 'sidebar' }, h('ul', null,
        h('li', null, h('a', { href: '/home' }, 'Home')),
        h('li', null, h('a', { href: '/about' }, 'About')))),
      h('main', { class: 'content' }, h('article', null,
        h('h1', null, 'Article Title'),
        h('p', null, 'First paragraph.'),
        h('p', null, 'Second paragraph.'))),
    ),
    '<section class="page"><nav class="sidebar"><ul><li><a href="/home">Home</a></li>'
    + '<li><a href="/about">About</a></li></ul></nav><main class="content"><article>'
    + '<h1>Article Title</h1><p>First paragraph.</p><p>Second paragraph.</p></article></main></section>',
  ],
  [
    'element with data attributes',
    () => h('div', { 'data-testid': 'my-widget', 'data-value': '42', 'data-active': 'true' }, 'content'),
    '<div data-testid="my-widget" data-value="42" data-active="true">content</div>',
  ],
  [
    'element with aria attributes',
    () => h('button', { type: 'button', 'aria-label': 'Close dialog', 'aria-expanded': 'false', role: 'button' }, 'X'),
    '<button type="button" aria-label="Close dialog" aria-expanded="false" role="button">X</button>',
  ],
  [
    'reactive text signal',
    () => {
      const [name] = createSignal('World');
      return h('div', null, h('span', null, 'Hello, '), h('span', null, name));
    },
    '<div><span>Hello, </span><span>World</span></div>',
  ],
  [
    'multiple reactive signals in one tree',
    () => {
      const [firstName] = createSignal('Jane');
      const [lastName] = createSignal('Doe');
      return h('div', { class: 'profile' },
        h('span', { class: 'first' }, firstName),
        h('span', { class: 'sep' }, ' '),
        h('span', { class: 'last' }, lastName));
    },
    '<div class="profile"><span class="first">Jane</span><span class="sep"> </span>'
    + '<span class="last">Doe</span></div>',
  ],
];

describe.each([
  ['client', renderClient],
  ['descriptor', renderDescriptor],
] as const)('Hydration Observability: the %s path renders', (_path, render) => {
  it.each(CASES)('%s', (_name, component, html) => {
    expect(render(component)).toBe(html);
  });
});

describe('Hydration Observability: SSR-vs-Client Diff', () => {

  // -------------------------------------------------------------------------
  // createShow tests
  // -------------------------------------------------------------------------

  // createShow returns a ShowDescriptor during hydration (not a HydrationDescriptor),
  // so it cannot be passed to descriptorToElement directly.  Instead we:
  //   a) test the client render independently (checking expected content)
  //   b) verify the hydration descriptor captures the correct initial branch
  //      by rendering only the initialBranch descriptor.

  it('conditional rendering: client render shows visible branch', () => {
    const component = () => {
      const [visible] = createSignal(true);
      return createShow(
        visible,
        () => h('div', { class: 'content' }, 'Visible'),
        () => h('div', { class: 'placeholder' }, 'Hidden'),
      ) as unknown as Node;
    };

    // Client side: injects into container and checks innerHTML
    let html = '';
    createRoot((_dispose) => {
      const frag = component();
      const container = document.createElement('div');
      container.appendChild(frag);
      html = normalizeHtml(container.innerHTML);
    });

    expect(html).toContain('Visible');
    expect(html).not.toContain('Hidden');
  });

  it('conditional rendering: hydration descriptor initialBranch matches client visible branch', () => {
    // Client render: visible=true → 'Visible' branch
    const clientComponent = () => h('div', { class: 'content' }, 'Visible');
    const clientHtml = renderClient(clientComponent);

    // Descriptor render of the show's initial branch
    const showComponent = () => {
      const [visible] = createSignal(true);
      return createShow(
        visible,
        () => h('div', { class: 'content' }, 'Visible'),
        () => h('div', { class: 'placeholder' }, 'Hidden'),
      );
    };
    const branchHtml = renderShowDescriptorBranch(showComponent);

    expect(branchHtml).toBe(clientHtml);
  });

  it('conditional rendering: false initial branch matches client fallback', () => {
    // Client render: visible=false → 'Hidden' branch
    const clientComponent = () => h('div', { class: 'placeholder' }, 'Hidden');
    const clientHtml = renderClient(clientComponent);

    // Descriptor render of the show's initial branch (condition=false)
    const showComponent = () => {
      const [visible] = createSignal(false);
      return createShow(
        visible,
        () => h('div', { class: 'content' }, 'Visible'),
        () => h('div', { class: 'placeholder' }, 'Hidden'),
      );
    };
    const branchHtml = renderShowDescriptorBranch(showComponent);

    expect(branchHtml).toBe(clientHtml);
  });

  it('createShow during hydration returns ShowDescriptor not HydrationDescriptor', () => {
    // Guards the assumption that the test helpers above are using the right path.
    createRoot((_dispose) => {
      setHydrating(true);
      let result: unknown;
      try {
        const [visible] = createSignal(true);
        result = createShow(
          visible,
          () => h('div', null, 'yes'),
        );
      } finally {
        setHydrating(false);
      }

      expect(isDescriptor(result)).toBe(false);
      expect(isShowDescriptor(result)).toBe(true);
    });
  });

  it('h() during hydration returns HydrationDescriptor not a DOM element', () => {
    createRoot((_dispose) => {
      setHydrating(true);
      let result: unknown;
      try {
        result = h('div', { class: 'test' }, 'hello');
      } finally {
        setHydrating(false);
      }

      expect(isDescriptor(result)).toBe(true);
      const desc = result as HydrationDescriptor;
      expect(desc.tag).toBe('div');
      expect(desc.props).toEqual({ class: 'test' });
      expect(desc.children).toEqual(['hello']);
      expect(result instanceof Element).toBe(false);
    });
  });

});
