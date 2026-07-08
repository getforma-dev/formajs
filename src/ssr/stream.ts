/**
 * FormaJS SSR - Streaming Renderer
 *
 * Implements true chunked HTML streaming with out-of-order Suspense resolution.
 *
 * How it works:
 * 1. Yields shell HTML immediately (opening tags, head, static content)
 * 2. When a Suspense boundary is encountered:
 *    - Yields the fallback HTML with a placeholder: <div id="forma-s:N" style="display:contents">
 *    - Continues rendering siblings without blocking
 *    - When the async resource resolves, yields a swap script
 * 3. Suspense boundaries resolve independently in any order (out-of-order streaming)
 */

import { getSwapScript, getSwapTag } from './client-script.js';
import { escapeHtml, escapeAttr, isVNode, VOID_ELEMENTS, PROP_TO_ATTR, DANGEROUS_URI_ATTRS, DANGEROUS_URI_RE, type VNode } from './render.js';

// ---------------------------------------------------------------------------
// Suspense boundary tracking
// ---------------------------------------------------------------------------

interface PendingBoundary {
  id: string;
  promise: Promise<string>;
}

/** Per-render mutable state, scoped to a single renderToStreamNew call. */
interface StreamState {
  suspenseCounter: number;
  pendingBoundaries: PendingBoundary[];
}

// ---------------------------------------------------------------------------
// Synchronous render to buffer (for non-async content)
// ---------------------------------------------------------------------------

function renderSync(node: unknown, parts: string[]): void {
  if (node == null || node === true || node === false) return;
  if (typeof node === 'string') { parts.push(escapeHtml(node)); return; }
  if (typeof node === 'number') { parts.push(String(node)); return; }
  if (typeof node === 'function') { renderSync(node(), parts); return; }
  if (Array.isArray(node)) {
    for (const child of node) renderSync(child, parts);
    return;
  }
  if (isVNode(node)) {
    const { tag, props, children } = node;
    parts.push('<', tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (key.startsWith('on') || key === 'ref' || key === 'dangerouslySetInnerHTML') continue;
        const attrName = PROP_TO_ATTR[key] ?? key;
        const resolved = typeof value === 'function' ? value() : value;
        if (resolved === true) {
          parts.push(' ', attrName);
        } else if (resolved !== false && resolved != null) {
          if (DANGEROUS_URI_ATTRS.has(attrName) && typeof resolved === 'string' && DANGEROUS_URI_RE.test(resolved)) {
            continue; // skip dangerous URI
          }
          parts.push(' ', attrName, '="', escapeAttr(String(resolved)), '"');
        }
      }
    }
    if (VOID_ELEMENTS.has(tag)) { parts.push(' />'); return; }
    parts.push('>');
    if (props?.['dangerouslySetInnerHTML']) {
      const raw = props['dangerouslySetInnerHTML'];
      if (typeof raw !== 'object' || raw == null || !('__html' in raw) || typeof (raw as { __html: unknown }).__html !== 'string') {
        throw new TypeError('dangerouslySetInnerHTML must be { __html: string }');
      }
      parts.push((raw as { __html: string }).__html);
    } else {
      for (const child of children) renderSync(child, parts);
    }
    parts.push('</', tag, '>');
    return;
  }
  parts.push(escapeHtml(String(node)));
}

// ---------------------------------------------------------------------------
// Suspense VNode detection
// ---------------------------------------------------------------------------

/**
 * A Suspense boundary VNode has a special shape:
 * { tag: 'forma-suspense', props: { fallback: VNode }, children: [asyncChildren] }
 *
 * Or it can be created via:
 * shSuspense(fallbackVNode, () => asyncContent)
 */
export interface SuspenseVNode {
  tag: 'forma-suspense';
  props: { fallback: unknown };
  children: [() => Promise<unknown>];
}

function isSuspenseVNode(v: unknown): v is SuspenseVNode {
  return isVNode(v) && v.tag === 'forma-suspense';
}

/**
 * Create a server-side Suspense VNode for streaming SSR.
 */
export function shSuspense(fallback: unknown, asyncChildren: () => Promise<unknown>): SuspenseVNode {
  return {
    tag: 'forma-suspense',
    props: { fallback },
    children: [asyncChildren],
  };
}

// ---------------------------------------------------------------------------
// Streaming renderer
// ---------------------------------------------------------------------------

export interface StreamOptions {
  /** Script to bootstrap the client-side app (e.g. <script src="/app.js"></script>) */
  bootstrapScript?: string;
  /** Whether to inject the $FORMA_SWAP client script (default: true) */
  injectSwapScript?: boolean;
  /**
   * Max ms to wait for each Suspense boundary before giving up (its fallback
   * stays visible and no swap is emitted). Omit or `<= 0` to wait forever — a
   * never-settling resource would otherwise hang the stream and the HTTP
   * connection indefinitely.
   */
  suspenseTimeout?: number;
}

/** A Suspense boundary that did not settle within suspenseTimeout. */
const TIMED_OUT = Symbol('forma-suspense-timeout');

/** Resolve to TIMED_OUT if `p` does not settle within `ms` (no timeout if ms is unset/<=0). */
function raceTimeout<T>(p: Promise<T>, ms: number | undefined): Promise<T | typeof TIMED_OUT> {
  if (ms == null || ms <= 0) return p;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(TIMED_OUT), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Render a FormaJS virtual tree to a stream of HTML chunks.
 *
 * Yields HTML progressively:
 * - Static content is yielded immediately
 * - Suspense boundaries yield their fallback, then resolve later
 * - Resolved Suspense boundaries yield swap scripts
 *
 * Usage:
 * ```ts
 * import { renderToStream, shSuspense, sh } from '@getforma/core/ssr';
 *
 * const stream = renderToStream(
 *   sh('html', null,
 *     sh('body', null,
 *       sh('h1', null, 'Hello'),
 *       shSuspense(
 *         sh('div', null, 'Loading...'),
 *         async () => {
 *           const data = await fetchData();
 *           return sh('div', null, data.name);
 *         },
 *       ),
 *     ),
 *   ),
 * );
 *
 * for await (const chunk of stream) {
 *   response.write(chunk);
 * }
 * ```
 */
export async function* renderToStreamNew(
  node: unknown,
  options?: StreamOptions,
): AsyncGenerator<string> {
  // Per-render state — scoped to this generator invocation
  const state: StreamState = {
    suspenseCounter: 0,
    pendingBoundaries: [],
  };

  const injectSwap = options?.injectSwapScript !== false;

  // Inject the swap script first (if there could be Suspense boundaries)
  if (injectSwap) {
    yield getSwapScript();
  }

  // Render the main tree synchronously, collecting Suspense boundaries
  const mainParts: string[] = [];
  renderStreamNode(node, mainParts, state);
  yield mainParts.join('');

  // Yield bootstrap script if provided
  if (options?.bootstrapScript) {
    yield options.bootstrapScript;
  }

  // Wait for and yield all pending Suspense boundaries
  // Each resolves independently (out-of-order)
  const suspenseTimeout = options?.suspenseTimeout;
  while (state.pendingBoundaries.length > 0) {
    const pending = [...state.pendingBoundaries];
    state.pendingBoundaries = [];

    // Race all pending boundaries against the optional timeout — yield each as
    // it resolves. A timed-out boundary resolves to TIMED_OUT (no swap), so the
    // loop drains and the generator returns instead of hanging.
    const results = await Promise.allSettled(
      pending.map(async (boundary) => {
        const html = await raceTimeout(boundary.promise, suspenseTimeout);
        return { id: boundary.id, html };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.html !== TIMED_OUT) {
        yield getSwapTag(result.value.id, result.value.html as string);
      }
      // On timeout or rejection, the fallback stays visible (no swap).
    }
  }
}

/**
 * Render a node synchronously. If a Suspense boundary is encountered,
 * render the fallback inline and queue the async resolution.
 */
function renderStreamNode(node: unknown, parts: string[], state: StreamState): void {
  if (node == null || node === true || node === false) return;
  if (typeof node === 'string') { parts.push(escapeHtml(node)); return; }
  if (typeof node === 'number') { parts.push(String(node)); return; }
  if (typeof node === 'function') { renderStreamNode(node(), parts, state); return; }
  if (Array.isArray(node)) {
    for (const child of node) renderStreamNode(child, parts, state);
    return;
  }

  // Suspense boundary: render fallback, queue async resolution
  if (isSuspenseVNode(node)) {
    const id = `forma-s:${state.suspenseCounter++}`;
    const fallback = node.props.fallback;
    const asyncFn = node.children[0]!;

    // Render fallback inside a replaceable container
    parts.push(`<div id="${id}" style="display:contents">`);
    renderSync(fallback, parts);
    parts.push('</div>');

    // Queue the async resolution. Invoke asyncFn via Promise.resolve().then so a
    // SYNCHRONOUS throw becomes a rejection routed through allSettled (fallback
    // stays) instead of aborting the whole generator before the shell is flushed.
    // Render resolved content through the Suspense-aware path so a NESTED
    // forma-suspense inside it is detected and queued onto the shared state
    // (drained out-of-order), rather than emitted as a literal element.
    const promise = Promise.resolve().then(asyncFn).then((resolved: unknown) => {
      const resolvedParts: string[] = [];
      renderStreamNode(resolved, resolvedParts, state);
      return resolvedParts.join('');
    });
    state.pendingBoundaries.push({ id, promise });
    return;
  }

  // Regular VNode
  if (isVNode(node)) {
    const { tag, props, children } = node;
    parts.push('<', tag);
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (key === 'fallback') continue; // skip internal suspense props
        if (key.startsWith('on') || key === 'ref' || key === 'dangerouslySetInnerHTML') continue;
        const attrName = PROP_TO_ATTR[key] ?? key;
        const resolved = typeof value === 'function' ? value() : value;
        if (resolved === true) {
          parts.push(' ', attrName);
        } else if (resolved !== false && resolved != null) {
          if (DANGEROUS_URI_ATTRS.has(attrName) && typeof resolved === 'string' && DANGEROUS_URI_RE.test(resolved)) {
            continue; // skip dangerous URI
          }
          parts.push(' ', attrName, '="', escapeAttr(String(resolved)), '"');
        }
      }
    }
    if (VOID_ELEMENTS.has(tag)) { parts.push(' />'); return; }
    parts.push('>');
    if (props?.['dangerouslySetInnerHTML']) {
      const raw = props['dangerouslySetInnerHTML'];
      if (typeof raw !== 'object' || raw == null || !('__html' in raw) || typeof (raw as { __html: unknown }).__html !== 'string') {
        throw new TypeError('dangerouslySetInnerHTML must be { __html: string }');
      }
      parts.push((raw as { __html: string }).__html);
    } else {
      for (const child of children) renderStreamNode(child, parts, state);
    }
    parts.push('</', tag, '>');
    return;
  }

  parts.push(escapeHtml(String(node)));
}
