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

describe('Hydration Observability: SSR-vs-Client Diff', () => {

  it('static element tree matches between client and descriptor render', () => {
    const component = () => h('div', { class: 'container' },
      h('h1', null, 'Title'),
      h('p', null, 'Description'),
    );

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('element with static props matches', () => {
    const component = () => h('form', { class: 'login-form', method: 'post' },
      h('input', { type: 'email', placeholder: 'Email' }),
      h('input', { type: 'password', placeholder: 'Password' }),
      h('button', { type: 'submit', class: 'btn primary' }, 'Login'),
    );

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('nested elements with mixed children match', () => {
    const component = () => h('div', { class: 'card' },
      h('div', { class: 'card-header' },
        h('h2', null, 'Card Title'),
        h('span', { class: 'badge' }, 'Active'),
      ),
      h('div', { class: 'card-body' },
        h('p', null, 'Some content here'),
        h('ul', null,
          h('li', null, 'Item 1'),
          h('li', null, 'Item 2'),
        ),
      ),
    );

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('void elements (input, br) match', () => {
    const component = () => h('form', null,
      h('input', { type: 'text', name: 'email' }),
      h('br', null),
      h('input', { type: 'password', name: 'password' }),
    );

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('empty elements match', () => {
    const component = () => h('div', { class: 'toast' });

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('SVG elements match', () => {
    const component = () => h('svg', { viewBox: '0 0 24 24', fill: 'none' },
      h('path', { d: 'M12 2L2 22h20L12 2z', stroke: 'currentColor' }),
    );

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('deeply nested elements match', () => {
    const component = () => h('section', { class: 'page' },
      h('nav', { class: 'sidebar' },
        h('ul', null,
          h('li', null, h('a', { href: '/home' }, 'Home')),
          h('li', null, h('a', { href: '/about' }, 'About')),
        ),
      ),
      h('main', { class: 'content' },
        h('article', null,
          h('h1', null, 'Article Title'),
          h('p', null, 'First paragraph.'),
          h('p', null, 'Second paragraph.'),
        ),
      ),
    );

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('element with data attributes matches', () => {
    const component = () => h('div', {
      'data-testid': 'my-widget',
      'data-value': '42',
      'data-active': 'true',
    }, 'content');

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('element with aria attributes matches', () => {
    const component = () => h('button', {
      type: 'button',
      'aria-label': 'Close dialog',
      'aria-expanded': 'false',
      role: 'button',
    }, 'X');

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  // -------------------------------------------------------------------------
  // Reactive signal tests
  // -------------------------------------------------------------------------

  it('reactive text signal produces equivalent structure', () => {
    // Both render paths call the same componentFn, so the signal is read at
    // the same initial value in both paths.  The descriptor path stores the
    // getter function as a child; descriptorToElement calls h() outside
    // hydration which then sets up a reactive text binding with the same
    // initial value, giving identical innerHTML.
    const component = () => {
      const [name] = createSignal('World');
      return h('div', null,
        h('span', null, 'Hello, '),
        h('span', null, name),
      );
    };

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

  it('multiple reactive signals in one tree produce equivalent structure', () => {
    const component = () => {
      const [firstName] = createSignal('Jane');
      const [lastName] = createSignal('Doe');
      return h('div', { class: 'profile' },
        h('span', { class: 'first' }, firstName),
        h('span', { class: 'sep' }, ' '),
        h('span', { class: 'last' }, lastName),
      );
    };

    expect(renderClient(component)).toBe(renderDescriptor(component));
  });

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

  // -------------------------------------------------------------------------
  // Mismatch detection smoke test
  // -------------------------------------------------------------------------

  it('detects structural difference when tag names differ', () => {
    const clientComponent = () => h('div', null, 'Content');
    const descriptorComponent = () => h('section', null, 'Content');

    // These should produce different HTML — section vs div
    const clientHtml = renderClient(clientComponent);
    const descriptorHtml = renderDescriptor(descriptorComponent);

    expect(clientHtml).not.toBe(descriptorHtml);
    expect(clientHtml).toContain('<div>');
    expect(descriptorHtml).toContain('<section>');
  });

  it('detects structural difference when class attributes differ', () => {
    const clientComponent = () => h('div', { class: 'card-a' }, 'Text');
    const descriptorComponent = () => h('div', { class: 'card-b' }, 'Text');

    const clientHtml = renderClient(clientComponent);
    const descriptorHtml = renderDescriptor(descriptorComponent);

    expect(clientHtml).not.toBe(descriptorHtml);
  });

  it('detects structural difference when child text differs', () => {
    const clientComponent = () => h('p', null, 'Hello');
    const descriptorComponent = () => h('p', null, 'Goodbye');

    const clientHtml = renderClient(clientComponent);
    const descriptorHtml = renderDescriptor(descriptorComponent);

    expect(clientHtml).not.toBe(descriptorHtml);
  });
});
