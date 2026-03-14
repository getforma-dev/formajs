// Void elements that don't have closing tags
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Map of prop names to HTML attribute names
export const PROP_TO_ATTR: Record<string, string> = {
  className: 'class',
  htmlFor: 'for',
  tabIndex: 'tabindex',
};

// Escape HTML entities
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Escape attribute values
export function escapeAttr(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export interface VNode {
  tag: string;
  props: Record<string, unknown> | null;
  children: unknown[];
}

/**
 * Server-side hyperscript — creates a virtual node instead of a DOM element.
 */
export function sh(tag: string, props?: Record<string, unknown> | null, ...children: unknown[]): VNode {
  return { tag, props: props ?? null, children };
}

/**
 * Render a FormaJS virtual tree to an HTML string.
 *
 * Uses an array buffer internally to avoid O(n^2) string concatenation
 * for large trees, then joins once at the end.
 *
 * Usage:
 * ```ts
 * import { renderToString, sh } from '@getforma/core/ssr';
 *
 * const html = renderToString(
 *   sh('div', { class: 'app' },
 *     sh('h1', null, 'Hello SSR!'),
 *     sh('p', null, () => count()),  // signal getters resolved synchronously
 *   )
 * );
 * ```
 */
export function renderToString(node: unknown): string {
  const parts: string[] = [];
  renderToBuffer(node, parts);
  return parts.join('');
}

/**
 * Internal: recursively render into a string array buffer.
 * Avoids O(n^2) string concatenation for large trees.
 */
function renderToBuffer(node: unknown, parts: string[]): void {
  // null/undefined/boolean → empty
  if (node == null || node === true || node === false) return;

  // String → escaped text
  if (typeof node === 'string') { parts.push(escapeHtml(node)); return; }

  // Number → stringified
  if (typeof node === 'number') { parts.push(String(node)); return; }

  // Function (signal getter) → resolve and render
  if (typeof node === 'function') { renderToBuffer(node(), parts); return; }

  // Array → render each
  if (Array.isArray(node)) {
    for (const child of node) renderToBuffer(child, parts);
    return;
  }

  // VNode
  if (isVNode(node)) {
    const { tag, props, children } = node;
    parts.push('<', tag);

    // Render props as attributes
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        // Skip event handlers, refs, and internal props
        if (key.startsWith('on') || key === 'ref' || key === 'dangerouslySetInnerHTML') continue;

        const attrName = PROP_TO_ATTR[key] ?? key;

        // Resolve reactive values
        const resolved = typeof value === 'function' ? value() : value;

        if (resolved === true) {
          parts.push(' ', attrName);
        } else if (resolved !== false && resolved != null) {
          parts.push(' ', attrName, '="', escapeAttr(String(resolved)), '"');
        }
      }
    }

    // Void elements
    if (VOID_ELEMENTS.has(tag)) { parts.push(' />'); return; }

    parts.push('>');

    // dangerouslySetInnerHTML
    if (props?.['dangerouslySetInnerHTML']) {
      parts.push((props['dangerouslySetInnerHTML'] as { __html: string }).__html);
    } else {
      // Render children
      for (const child of children) {
        renderToBuffer(child, parts);
      }
    }

    parts.push('</', tag, '>');
    return;
  }

  // Fallback: stringify
  parts.push(escapeHtml(String(node)));
}

export function isVNode(v: unknown): v is VNode {
  return v != null && typeof v === 'object' && 'tag' in v && 'children' in v;
}

// ---------------------------------------------------------------------------
// Hydration-aware rendering
// ---------------------------------------------------------------------------

/** Per-render hydration context — avoids shared module-level counter. */
interface HydrationContext {
  id: number;
}

/**
 * Render a FormaJS virtual tree to an HTML string with hydration markers.
 *
 * Like `renderToString`, but injects comment markers and `data-forma-h`
 * attributes so the client-side `hydrate()` function can adopt existing
 * DOM nodes without re-creating them.
 *
 * Each call creates its own hydration counter, so concurrent calls
 * (e.g. multiple SSR requests in the same process) produce independent,
 * non-overlapping hydration IDs.
 *
 * Marker types:
 * - `data-forma-h="N"` — element boundary (attribute on the element)
 * - `<!--forma-t:N-->` / `<!--/forma-t:N-->` — reactive text boundary
 * - `<!--forma-l:N-->` / `<!--/forma-l:N-->` — list boundary
 *
 * Usage:
 * ```ts
 * import { renderToStringWithHydration, sh } from '@getforma/core/ssr';
 *
 * const html = renderToStringWithHydration(
 *   sh('div', { class: 'app' },
 *     sh('h1', null, 'Hello SSR!'),
 *     sh('p', null, () => count()),
 *   )
 * );
 * ```
 */
export function renderToStringWithHydration(node: unknown): string {
  const ctx: HydrationContext = { id: 0 };
  const parts: string[] = [];
  renderToBufferHydrated(node, parts, ctx);
  return parts.join('');
}

/**
 * Internal: recursively render into a string array buffer with hydration markers.
 * The `ctx` object carries the hydration counter so concurrent renders are isolated.
 */
function renderToBufferHydrated(node: unknown, parts: string[], ctx: HydrationContext): void {
  // null/undefined/boolean → empty
  if (node == null || node === true || node === false) return;

  // String → escaped text
  if (typeof node === 'string') { parts.push(escapeHtml(node)); return; }

  // Number → stringified
  if (typeof node === 'number') { parts.push(String(node)); return; }

  // Function (signal getter / reactive text) → wrap with text markers
  if (typeof node === 'function') {
    const id = ctx.id++;
    parts.push(`<!--forma-t:${id}-->`);
    renderToBufferHydrated(node(), parts, ctx);
    parts.push(`<!--/forma-t:${id}-->`);
    return;
  }

  // Array → wrap with list markers
  if (Array.isArray(node)) {
    const id = ctx.id++;
    parts.push(`<!--forma-l:${id}-->`);
    for (const child of node) renderToBufferHydrated(child, parts, ctx);
    parts.push(`<!--/forma-l:${id}-->`);
    return;
  }

  // VNode
  if (isVNode(node)) {
    const id = ctx.id++;
    const { tag, props, children } = node;

    // Add hydration data-attribute to element
    parts.push('<', tag, ` data-forma-h="${id}"`);

    // Render props as attributes
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        // Skip event handlers, refs, and internal props
        if (key.startsWith('on') || key === 'ref' || key === 'dangerouslySetInnerHTML') continue;

        const attrName = PROP_TO_ATTR[key] ?? key;

        // Resolve reactive values
        const resolved = typeof value === 'function' ? value() : value;

        if (resolved === true) {
          parts.push(' ', attrName);
        } else if (resolved !== false && resolved != null) {
          parts.push(' ', attrName, '="', escapeAttr(String(resolved)), '"');
        }
      }
    }

    // Void elements
    if (VOID_ELEMENTS.has(tag)) { parts.push(' />'); return; }

    parts.push('>');

    // dangerouslySetInnerHTML
    if (props?.['dangerouslySetInnerHTML']) {
      parts.push((props['dangerouslySetInnerHTML'] as { __html: string }).__html);
    } else {
      // Render children
      for (const child of children) {
        renderToBufferHydrated(child, parts, ctx);
      }
    }

    parts.push('</', tag, '>');
    return;
  }

  // Fallback: stringify
  parts.push(escapeHtml(String(node)));
}

