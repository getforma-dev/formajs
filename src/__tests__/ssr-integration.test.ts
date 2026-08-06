import { describe, expect, it } from 'vitest';
import {
  renderToStream,
  renderToString,
  sh,
  shSuspense,
  ssrSignal,
} from '../ssr';
import * as ssr from '../ssr';

describe('ssr integration', () => {
  it('renders vnode trees and signal getters to string', () => {
    const [count] = ssrSignal(3);
    const html = renderToString(
      sh('div', { className: 'card' }, 'Count: ', () => count()),
    );

    expect(html).toBe('<div class="card">Count: 3</div>');
  });

  // renderToStringWithHydration was deleted: it emitted a marker grammar
  // (data-forma-h / <!--forma-t:N-->) that nothing in the ecosystem parses. The
  // client adopts only the walker's f:tN/f:sN/f:lN/f:iN markers, so its output
  // was never hydratable despite the docstring promising it was.
  it('does not export a second, unparseable hydration marker dialect', () => {
    expect((ssr as Record<string, unknown>).renderToStringWithHydration).toBeUndefined();
    const html = renderToString(
      sh('section', null, sh('h1', null, 'Title'), () => 'dynamic'),
    );
    expect(html).not.toContain('data-forma-h=');
    expect(html).not.toContain('<!--forma-t:');
  });

  it('streams fallback first and swap payload after suspense resolves', async () => {
    const stream = renderToStream(
      sh(
        'main',
        null,
        'before',
        shSuspense(
          sh('span', null, 'Loading...'),
          async () => sh('span', null, 'Resolved!'),
        ),
        'after',
      ),
    );

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const output = chunks.join('');

    expect(output).toContain('$FORMA_SWAP');
    expect(output).toContain('Loading...');
    expect(output).toContain('Resolved!');
    expect(output).toContain('forma-s:0');
  });

  it('SSR throws TypeError for invalid dangerouslySetInnerHTML (wrong shape)', () => {
    expect(() => {
      renderToString(sh('div', { dangerouslySetInnerHTML: 'bad' }));
    }).toThrow(TypeError);
    expect(() => {
      renderToString(sh('div', { dangerouslySetInnerHTML: 'bad' }));
    }).toThrow('dangerouslySetInnerHTML must be { __html: string }');
  });

  it('SSR throws TypeError for invalid dangerouslySetInnerHTML (non-string __html)', () => {
    expect(() => {
      renderToString(sh('div', { dangerouslySetInnerHTML: { __html: 123 } }));
    }).toThrow(TypeError);
    expect(() => {
      renderToString(sh('div', { dangerouslySetInnerHTML: { __html: 123 } }));
    }).toThrow('dangerouslySetInnerHTML must be { __html: string }');
  });

  it('SSR throws TypeError for invalid dangerouslySetInnerHTML (boolean __html)', () => {
    expect(() => {
      renderToString(sh('div', { dangerouslySetInnerHTML: 42 }));
    }).toThrow(TypeError);
    expect(() => {
      renderToString(sh('div', { dangerouslySetInnerHTML: { __html: false } }));
    }).toThrow('dangerouslySetInnerHTML must be { __html: string }');
  });

  it('escapeAttr escapes angle brackets and single quotes', () => {
    const html = renderToString(sh('div', { title: "a < b > c & d 'e'" }));
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
    expect(html).toContain('&#39;');
    expect(html).not.toContain("title=\"a < b");
  });

  it('blocks javascript: URI in href', () => {
    const html = renderToString(sh('a', { href: 'javascript:alert(1)' }, 'click'));
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<a');
    expect(html).toContain('click');
  });

  it('blocks javascript: URI in src', () => {
    const html = renderToString(sh('img', { src: 'javascript:alert(1)' }));
    expect(html).not.toContain('javascript:');
  });

  it('blocks data:text/html URI in href', () => {
    const html = renderToString(sh('a', { href: 'data:text/html,<script>alert(1)</script>' }, 'click'));
    expect(html).not.toContain('data:text/html');
  });

  it('allows safe URIs', () => {
    const html = renderToString(sh('a', { href: 'https://example.com' }, 'link'));
    expect(html).toContain('href="https://example.com"');
  });

  it('allows data: URIs for images (not text/html)', () => {
    const html = renderToString(sh('img', { src: 'data:image/png;base64,abc' }));
    expect(html).toContain('src="data:image/png;base64,abc"');
  });

  // Regression: browsers strip control chars from the scheme, so these execute.
  it('blocks javascript: URIs obfuscated with control characters', () => {
    const T = String.fromCharCode(0x09);
    const N = String.fromCharCode(0x0a);
    const R = String.fromCharCode(0x0d);
    const C1 = String.fromCharCode(0x01);
    for (const payload of [
      'java' + T + 'script:alert(1)',
      'javas' + N + 'cript:alert(1)',
      'java' + R + N + 'script:alert(1)',
      C1 + 'javascript:alert(1)',
      'javascript:alert(1)',
    ]) {
      const html = renderToString(sh('a', { href: payload }, 'x'));
      expect(html).not.toMatch(/script:/i);
    }
  });

  it('blocks control-char-obfuscated URIs in the streaming renderer too', async () => {
    const payload = 'java' + String.fromCharCode(0x09) + 'script:alert(1)';
    const chunks: string[] = [];
    for await (const chunk of renderToStream(sh('a', { href: payload }, 'x'))) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).not.toMatch(/script:/i);
  });

  it('drops event-handler and malformed attribute names (case-insensitive)', () => {
    const html = renderToString(
      sh('div', { OnClick: 'alert(1)', 'x onload': 'y', title: 'ok' }),
    );
    expect(html.toLowerCase()).not.toContain('onclick');
    expect(html).not.toContain('onload');
    expect(html).toContain('title="ok"');
  });
});
