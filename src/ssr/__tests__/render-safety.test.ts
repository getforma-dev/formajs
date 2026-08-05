/**
 * SSR emission safety.
 *
 * Regression suite for:
 * - `ssr-tag-name-not-validated`: prop NAMES were validated but `node.tag` was
 *   interpolated verbatim, so a tag taken from data could inject an attribute
 *   or close the tag.
 * - `svg-data-url-needs-context-aware-check`: the scheme allowlist let
 *   `data:image/svg+xml` through every sink, including navigable ones.
 * - `url-attrs-missing-object-data`: `<object data>` was not scheme-checked.
 * - `srcdoc-raw-html-sink`: srcdoc is emitted, but escaping does not make it safe.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToString, renderAttr, sh } from '../render.js';
import { renderToStream } from '../stream.js';

const SVG_PAYLOAD = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>';

async function stream(node: unknown): Promise<string> {
  const chunks: string[] = [];
  for await (const chunk of renderToStream(node, { injectSwapScript: false })) {
    chunks.push(chunk);
  }
  return chunks.join('');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('tag name validation', () => {
  it('drops a VNode whose tag would inject an attribute', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToString(sh('div onload=alert(1)', null, 'x'));
    expect(html).toBe('');
    expect(html).not.toContain('onload');
  });

  it('drops a VNode whose tag would close the tag', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToString(sh('div><script>alert(1)</script', null, 'x'));
    expect(html).toBe('');
    expect(html).not.toContain('<script');
  });

  it('warns in dev when a node is skipped for an unsafe tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderToString(sh('div onload=x', null));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsafe tag name'));
  });

  it('renders ordinary, SVG and custom-element tags unchanged', () => {
    expect(renderToString(sh('div', null, 'a'))).toBe('<div>a</div>');
    expect(renderToString(sh('feGaussianBlur', { stdDeviation: '2' }))).toBe('<feGaussianBlur stdDeviation="2"></feGaussianBlur>');
    expect(renderToString(sh('my-widget', null, 'a'))).toBe('<my-widget>a</my-widget>');
  });

  it('the streaming renderer drops a VNode with an unsafe tag name', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = await stream(sh('main', null, sh('div onload=alert(1)', null, 'x'), 'kept'));
    expect(html).not.toContain('onload');
    expect(html).toContain('kept');
  });
});

describe('context-aware data:image/svg+xml', () => {
  it('keeps data:image/svg+xml on an img but drops it on an iframe', () => {
    expect(renderToString(sh('img', { src: SVG_PAYLOAD }))).toContain('src="data:image/svg+xml');
    expect(renderToString(sh('iframe', { src: SVG_PAYLOAD }))).not.toContain('data:image/svg+xml');
  });

  it('drops data:image/svg+xml from every navigable sink', () => {
    expect(renderToString(sh('a', { href: SVG_PAYLOAD }, 'x'))).not.toContain('data:image/svg+xml');
    expect(renderToString(sh('object', { data: SVG_PAYLOAD }))).not.toContain('data:image/svg+xml');
    expect(renderToString(sh('embed', { src: SVG_PAYLOAD }))).not.toContain('data:image/svg+xml');
    expect(renderToString(sh('use', { 'xlink:href': SVG_PAYLOAD }))).not.toContain('data:image/svg+xml');
    expect(renderToString(sh('form', { action: SVG_PAYLOAD }))).not.toContain('data:image/svg+xml');
  });

  it('keeps it on the other image-context sinks', () => {
    expect(renderToString(sh('video', { poster: SVG_PAYLOAD }))).toContain('poster="data:image/svg+xml');
    expect(renderToString(sh('body', { background: SVG_PAYLOAD }))).toContain('background="data:image/svg+xml');
  });

  it('renderAttr with no tag falls back to the strict interpretation', () => {
    expect(renderAttr('src', SVG_PAYLOAD)).toBeNull();
    expect(renderAttr('src', SVG_PAYLOAD, 'img')).not.toBeNull();
  });

  it('the streaming renderer applies the same tag context', async () => {
    expect(await stream(sh('img', { src: SVG_PAYLOAD }))).toContain('data:image/svg+xml');
    expect(await stream(sh('iframe', { src: SVG_PAYLOAD }))).not.toContain('data:image/svg+xml');
  });
});

describe('object data attribute', () => {
  it('drops javascript: and data:text/html from object data', () => {
    expect(renderToString(sh('object', { data: 'javascript:alert(1)' }))).not.toContain('javascript:');
    expect(renderToString(sh('object', { data: 'data:text/html,<script>alert(1)</script>' }))).not.toContain('data:text/html');
  });

  it('keeps a legitimate object data URL', () => {
    expect(renderToString(sh('object', { data: '/report.pdf' }))).toContain('data="/report.pdf"');
  });
});

describe('srcdoc', () => {
  it('warns in dev that srcdoc is a raw-HTML sink but still emits it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const html = renderToString(sh('iframe', { sandbox: '', srcdoc: '<p>trusted</p>' }));
    // Blocking it would break legitimate sandboxed iframes, so it is emitted…
    expect(html).toContain('srcdoc="&lt;p&gt;trusted&lt;/p&gt;"');
    // …but escaping does not neutralize it: the browser decodes and parses it.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('raw-HTML sink'));
  });
});
