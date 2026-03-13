/**
 * Forma DOM - SSR Reconcile Bridge
 *
 * Patches server-rendered (SSR) DOM to match client-rendered DOM in place,
 * avoiding a full teardown-and-rebuild. This gives a flash-free mount when
 * SSR content is already in the page.
 *
 * This is intentionally simple (positional, non-keyed) — real hydration
 * with marker-based element reuse is planned for Phase 3.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isText(node: Node): node is Text {
  return node.nodeType === Node.TEXT_NODE;
}

/**
 * Sync all attributes from `client` onto `ssr`, removing stale ones.
 */
function patchAttributes(ssr: Element, client: Element): void {
  // Remove attributes that are on SSR but not on client
  const ssrAttrs = ssr.attributes;
  for (let i = ssrAttrs.length - 1; i >= 0; i--) {
    const attr = ssrAttrs[i]!;
    if (!client.hasAttribute(attr.name)) {
      ssr.removeAttribute(attr.name);
    }
  }

  // Set / update attributes from client
  const clientAttrs = client.attributes;
  for (let i = 0; i < clientAttrs.length; i++) {
    const attr = clientAttrs[i]!;
    if (ssr.getAttribute(attr.name) !== attr.value) {
      ssr.setAttribute(attr.name, attr.value);
    }
  }
}

/**
 * Recursively patch children of `ssr` to match children of `client`.
 * Uses a simple positional (non-keyed) strategy.
 */
function patchChildren(ssr: Element, client: Element): void {
  const ssrChildren = Array.from(ssr.childNodes);
  const clientChildren = Array.from(client.childNodes);

  const max = Math.max(ssrChildren.length, clientChildren.length);

  for (let i = 0; i < max; i++) {
    const ssrChild = ssrChildren[i];
    const clientChild = clientChildren[i];

    if (!clientChild) {
      // Extra SSR node — remove it
      ssr.removeChild(ssrChild!);
      continue;
    }

    if (!ssrChild) {
      // Extra client node — append it
      ssr.appendChild(clientChild);
      continue;
    }

    // Both exist — try to patch
    if (isElement(ssrChild) && isElement(clientChild)) {
      if (ssrChild.tagName === clientChild.tagName) {
        patchNode(ssrChild, clientChild);
      } else {
        // Tag mismatch — replace entirely
        ssr.replaceChild(clientChild, ssrChild);
      }
    } else if (isText(ssrChild) && isText(clientChild)) {
      if (ssrChild.data !== clientChild.data) {
        ssrChild.data = clientChild.data;
      }
    } else {
      // Node type mismatch — replace
      ssr.replaceChild(clientChild, ssrChild);
    }
  }
}

/**
 * Patch an SSR element to match a client element in place.
 */
function patchNode(ssr: Element, client: Element): void {
  if (ssr.tagName !== client.tagName) {
    // Can't patch across tags — the caller should replace
    ssr.parentNode?.replaceChild(client, ssr);
    return;
  }

  patchAttributes(ssr, client);
  patchChildren(ssr, client);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reconcile SSR-rendered content inside `container` with the client-rendered
 * `clientRoot` node. If the SSR structure matches (same root tag), attributes
 * and children are patched in-place. Otherwise a full replacement is performed.
 *
 * After reconciliation, the `data-forma-ssr` attribute is removed from the
 * container so subsequent mounts use the normal path.
 */
export function reconcileSsr(container: Element, clientRoot: Node): void {
  const ssrChild = container.firstElementChild;

  if (!ssrChild || !isElement(clientRoot) || ssrChild.tagName !== (clientRoot as Element).tagName) {
    // Structure mismatch or empty SSR — full replace
    container.innerHTML = '';
    container.appendChild(clientRoot);
    container.removeAttribute('data-forma-ssr');
    return;
  }

  patchNode(ssrChild, clientRoot as Element);
  container.removeAttribute('data-forma-ssr');
}
