/**
 * SSR Streaming — dangerouslySetInnerHTML validation tests.
 *
 * Phase 1 / H1: ensures stream.ts validates the shape of
 * dangerouslySetInnerHTML the same way render.ts does.
 */
import { describe, it, expect } from 'vitest';
import { renderToStream } from '../index';

// Helper: collect all chunks from an async iterable into a string
async function collectStream(stream: AsyncIterable<string>): Promise<string> {
  let result = '';
  for await (const chunk of stream) {
    result += chunk;
  }
  return result;
}

describe('renderToStream dangerouslySetInnerHTML validation', () => {
  it('renders valid { __html: string } correctly', async () => {
    const vnode = { tag: 'div', props: { dangerouslySetInnerHTML: { __html: '<b>bold</b>' } }, children: [] };
    const html = await collectStream(renderToStream(vnode));
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<div>');
  });

  it('throws TypeError for non-object dangerouslySetInnerHTML', async () => {
    const vnode = { tag: 'div', props: { dangerouslySetInnerHTML: 'not an object' }, children: [] };
    await expect(collectStream(renderToStream(vnode))).rejects.toThrow(TypeError);
    await expect(collectStream(renderToStream(vnode))).rejects.toThrow('dangerouslySetInnerHTML must be { __html: string }');
  });

  it('treats null dangerouslySetInnerHTML as falsy — renders children normally', async () => {
    const vnode = { tag: 'div', props: { dangerouslySetInnerHTML: null }, children: ['hello'] };
    // null is falsy so the props?.['dangerouslySetInnerHTML'] check skips it
    const html = await collectStream(renderToStream(vnode));
    expect(html).toContain('<div>');
    expect(html).toContain('hello');
  });

  it('throws TypeError for missing __html key', async () => {
    const vnode = { tag: 'div', props: { dangerouslySetInnerHTML: { notHtml: 'test' } }, children: [] };
    await expect(collectStream(renderToStream(vnode))).rejects.toThrow(TypeError);
  });

  it('throws TypeError for non-string __html value', async () => {
    const vnode = { tag: 'div', props: { dangerouslySetInnerHTML: { __html: 42 } }, children: [] };
    await expect(collectStream(renderToStream(vnode))).rejects.toThrow(TypeError);
  });

  it('throws TypeError for undefined __html value', async () => {
    const vnode = { tag: 'div', props: { dangerouslySetInnerHTML: { __html: undefined } }, children: [] };
    await expect(collectStream(renderToStream(vnode))).rejects.toThrow(TypeError);
  });
});
