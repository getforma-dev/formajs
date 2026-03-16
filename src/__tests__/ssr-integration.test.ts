import { describe, expect, it } from 'vitest';
import {
  renderToStream,
  renderToString,
  renderToStringWithHydration,
  sh,
  shSuspense,
  ssrSignal,
} from '../ssr';

describe('ssr integration', () => {
  it('renders vnode trees and signal getters to string', () => {
    const [count] = ssrSignal(3);
    const html = renderToString(
      sh('div', { className: 'card' }, 'Count: ', () => count()),
    );

    expect(html).toBe('<div class="card">Count: 3</div>');
  });

  it('injects hydration markers in hydration render mode', () => {
    const html = renderToStringWithHydration(
      sh('section', null, sh('h1', null, 'Title'), () => 'dynamic'),
    );

    expect(html).toContain('data-forma-h="');
    expect(html).toContain('<!--forma-t:');
  });

  it('concurrent renders produce independent hydration IDs', () => {
    const html1 = renderToStringWithHydration(
      sh('div', null, sh('span', null, 'A'), sh('span', null, 'B')),
    );
    const html2 = renderToStringWithHydration(
      sh('div', null, sh('p', null, 'X'), sh('p', null, 'Y')),
    );

    // Both should start their hydration IDs at 0 (independent counters)
    expect(html1).toContain('data-forma-h="0"');
    expect(html2).toContain('data-forma-h="0"');

    // Both should have sequential IDs for children
    expect(html1).toContain('data-forma-h="1"');
    expect(html1).toContain('data-forma-h="2"');
    expect(html2).toContain('data-forma-h="1"');
    expect(html2).toContain('data-forma-h="2"');
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

  it('SSR hydration throws TypeError for invalid dangerouslySetInnerHTML', () => {
    expect(() => {
      renderToStringWithHydration(sh('div', { dangerouslySetInnerHTML: 42 }));
    }).toThrow(TypeError);
    expect(() => {
      renderToStringWithHydration(sh('div', { dangerouslySetInnerHTML: { __html: false } }));
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
});
