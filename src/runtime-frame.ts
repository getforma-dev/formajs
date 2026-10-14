/**
 * The preview frame's runtime (FORMA-128; decision brief DR-14 tier (c), L-12,
 * L-33, L-44; v2 7.4's preview path, SR32).
 *
 * Content nobody reviewed, such as a module a model has just generated,
 * renders only in a document with an opaque origin and no network:
 * forma-server's `PageResponse::frame` (FORMA-125) serves it with
 * `sandbox allow-scripts` (no `allow-same-origin`), `connect-src 'none'` and
 * `frame-ancestors` the application's origin, and writes this runtime into it
 * inline, so the frame fetches nothing. The document is one element,
 * `<div id="forma-frame">`, and this script.
 *
 * Built as `dist/formajs-frame.global.js`: one classic, self-contained script
 * (no `import`, no `</script`, no `<!--`, no source map comment), the same
 * bytes from the same sources, so a policy can allow it by its SHA-256 hash,
 * and it creates no script of its own. It never mounts the page's
 * `data-forma-state` on load and never watches `body`.
 *
 * The protocol, of which the host (the application's page and bridge, L-12,
 * L-33) is the other half:
 *
 * 1. At its first load the host posts one message to the frame's window that
 *    carries exactly one `MessagePort`:
 *    `iframe.contentWindow.postMessage('forma-frame', '*', [channel.port2])`
 *    (`'*'` because the frame's origin is opaque; the transferred port is what
 *    makes the channel private). The frame takes the first such message whose
 *    source is its parent, then stops listening on its window. Anything else
 *    posted to the window, before or after, is ignored.
 * 2. On the port the host sends only the module:
 *    `{ type: 'module', html: string }`. The first renders it into
 *    `#forma-frame` with `mountMarkup(root, trustedHtml(html), { tier:
 *    'unreviewed' })`, no grants (minted, so the frame's policy may require
 *    Trusted Types): a `data-fetch` is refused before any request (and
 *    `connect-src 'none'` would refuse it again), `$el` stops at the root, and
 *    `click()` is refused. Each later one updates it, reconciled.
 * 3. The frame sends only three messages on the port:
 *    `{ type: 'ready' }` once it holds the port; `{ type: 'resize', height }`,
 *    the document's height in whole CSS pixels, when it changes; and
 *    `{ type: 'error', code, message }` (`message` at most 500 characters) for
 *    a message it refused (`FRAME_E_MESSAGE`), a module it could not render
 *    (`FRAME_E_RENDER`), and each diagnostic the runtime raised for the
 *    module, with its own code (`FORMA_E_GRANT_FETCH`, `FORMA_E_UNRESOLVED`,
 *    …); a module's own `$dispatch('formajs:diagnostic', …)` is not one. A
 *    diagnostic's message still quotes the module's expression, so its text
 *    is the module's: the host checks each message against its schema,
 *    treats its text as untrusted, and acts on none in the application's
 *    session.
 *
 * Verified by: src/__tests__/runtime-frame.test.ts > "takes one port from its parent, renders each module in tier (c) and answers only ready, resize and error"
 * Verified by: src/__tests__/runtime-frame.test.ts > "ignores a port from any window but its parent, and every port after the first"
 * Verified by: src/__tests__/runtime-frame.test.ts > "refuses every message but the module, and changes nothing"
 */
import { mountMarkup, trustedHtml, type MountHandle } from './runtime';

declare const __FORMA_FRAME_BUILD__: boolean | undefined;

/** The one element of the frame document, which the module renders into. */
export const FRAME_ROOT_ID = 'forma-frame';

/** What the frame sends its host, and nothing else. */
export type FrameMessage =
  | { type: 'ready' }
  | { type: 'resize'; height: number }
  | { type: 'error'; code: string; message: string };

/** The longest `message` the frame sends. */
const MAX_MESSAGE = 500;

/** The part of a window the frame runtime uses. */
type FrameWindow = Pick<Window, 'document' | 'parent' | 'addEventListener' | 'removeEventListener'>;

/**
 * Wait for the host's port on `win` and serve the protocol above. The frame
 * build calls it once, on its own window; a test may call it on another.
 */
export function connectFrame(win: FrameWindow): void {
  const doc = win.document;
  let port: MessagePort | null = null;
  let mounted: MountHandle | null = null;
  let height = -1;

  const send = (message: FrameMessage): void => {
    port?.postMessage(message);
  };
  const fail = (code: string, message: string): void => {
    send({ type: 'error', code, message: message.slice(0, MAX_MESSAGE) });
  };
  const measure = (): void => {
    const next = Math.ceil(doc.documentElement.getBoundingClientRect().height);
    if (next !== height) {
      height = next;
      send({ type: 'resize', height });
    }
  };

  const render = (html: string): void => {
    const root = doc.getElementById(FRAME_ROOT_ID);
    try {
      if (!root) throw new Error(`the frame document has no #${FRAME_ROOT_ID}`);
      // The frame vouches for the module only as content for this document,
      // an opaque origin with no network, which is what it exists to render:
      // so it is minted as trusted markup, and the frame's policy may require
      // Trusted Types (the reconciler parses it through forma-runtime).
      const markup = trustedHtml(html);
      if (mounted) mounted.update(markup);
      else mounted = mountMarkup(root, markup, { tier: 'unreviewed', config: { name: 'preview' } });
    } catch (err) {
      fail('FRAME_E_RENDER', err instanceof Error ? err.message : String(err));
    }
    measure();
  };

  const onPort = (event: MessageEvent): void => {
    const data = event.data as Record<string, unknown> | null;
    if (
      typeof data === 'object' && data !== null
      && Object.keys(data).length === 2 && data.type === 'module' && typeof data.html === 'string'
    ) {
      render(data.html);
    } else {
      fail('FRAME_E_MESSAGE', 'the frame accepts only { type: "module", html: string }');
    }
  };

  const onWindow = (event: MessageEvent): void => {
    if (event.source !== win.parent || win.parent === (win as unknown) || event.ports.length !== 1) return;
    win.removeEventListener('message', onWindow);
    port = event.ports[0]!;
    port.onmessage = onPort;
    send({ type: 'ready' });
    height = -1;
    measure();
  };
  win.addEventListener('message', onWindow);

  // The module's own diagnostics (an expression not evaluated, a grant
  // denied) reach the host as errors, once each, as they are dispatched. The
  // runtime dispatches them on the window itself; one that started at an
  // element is a module's `$dispatch('formajs:diagnostic', …)` and is not
  // forwarded.
  win.addEventListener('formajs:diagnostic', (event) => {
    if (event.target !== event.currentTarget) return;
    const detail = (event as CustomEvent<{ code?: unknown; reason?: unknown; expr?: unknown }>).detail;
    fail(String(detail?.code), `${String(detail?.reason)}: ${String(detail?.expr)}`);
  });

  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(doc.documentElement);
}

if (typeof __FORMA_FRAME_BUILD__ === 'boolean' && __FORMA_FRAME_BUILD__ && typeof window !== 'undefined') {
  connectFrame(window);
}
