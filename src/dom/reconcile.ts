/**
 * Forma Reconciler — DOM diffing and patching engine.
 *
 * Replaces morphdom with a purpose-built reconciler that understands
 * Forma's directive system (data-forma-state, data-list, data-if, etc.).
 *
 * Usage:
 *   const rec = createReconciler({ mountScope, unmountScope, ... });
 *   rec(container, htmlString);
 *
 * Scope modes for data-forma-state elements matched by data-forma-id:
 *   PRESERVE — same data-module + same state shape → patch attrs, keep bindings
 *   RESET    — same data-module + different state shape → unmount, patch, remount
 *   REPLACE  — different data-module → remove old, insert new, mount fresh
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface ReconcilerConfig {
  mountScope: (el: Element) => void;
  unmountScope: (el: Element) => void;
  disconnectObserver: () => void;
  reconnectObserver: () => void;
  batch: (fn: () => void) => void;
}

type ScopeMode = 'PRESERVE' | 'RESET' | 'REPLACE';

// ── Attribute helpers ─────────────────────────────────────────────────

/** Check if an element has data-bind:X targeting a specific attribute */
function getBindTargets(el: Element): Set<string> {
  const targets = new Set<string>();
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const name = attrs[i]!.name;
    if (name.startsWith('data-bind:')) {
      targets.add(name.slice(10));
    }
  }
  return targets;
}

/** Check if an element owns its subtree (data-list or data-if) */
function ownsSubtree(el: Element): boolean {
  return el.hasAttribute('data-list') || el.hasAttribute('data-if');
}

// ── State shape comparison ────────────────────────────────────────────

function getStateKeys(json: string): string[] {
  try {
    const obj = JSON.parse(json);
    return Object.keys(obj).sort();
  } catch {
    return [];
  }
}

function sameShape(keysA: string[], keysB: string[]): boolean {
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
  }
  return true;
}

// ── Scope mode determination ──────────────────────────────────────────

function determineScopeMode(liveEl: Element, newEl: Element): ScopeMode {
  const liveModule = liveEl.getAttribute('data-module');
  const newModule = newEl.getAttribute('data-module');

  if (liveModule !== newModule) return 'REPLACE';

  // Compare state shape: use __formaInitialState (set at mount time) for the
  // live element, and the raw attribute for the new element.
  const liveInitialState = (liveEl as any).__formaInitialState as string | undefined;
  const liveStateJSON = liveInitialState ?? liveEl.getAttribute('data-forma-state') ?? '{}';
  const newStateJSON = newEl.getAttribute('data-forma-state') ?? '{}';

  const liveKeys = getStateKeys(liveStateJSON);
  const newKeys = getStateKeys(newStateJSON);

  if (sameShape(liveKeys, newKeys)) return 'PRESERVE';
  return 'RESET';
}

// ── HTML parsing ──────────────────────────────────────────────────────

/** Reused template element — avoids creating a new one per reconcile call. */
let _parseTemplate: HTMLTemplateElement | null = null;

function parseHTML(html: string): DocumentFragment {
  if (!_parseTemplate) _parseTemplate = document.createElement('template');
  _parseTemplate.innerHTML = html;
  // content is consumed (moved) by the caller, so template is empty after
  return _parseTemplate.content;
}

// ── Attribute patching ────────────────────────────────────────────────

function patchAttributes(liveEl: Element, newEl: Element): void {
  const bindTargets = getBindTargets(liveEl);
  const hasDataShow = liveEl.hasAttribute('data-show');
  const hasDataModel = liveEl.hasAttribute('data-model');

  // Check for class directives without Array.from allocation
  let liveHasClassDirectives = false;
  const liveAttrs = liveEl.attributes;
  for (let i = 0; i < liveAttrs.length; i++) {
    if (liveAttrs[i]!.name.startsWith('data-class:')) {
      liveHasClassDirectives = true;
      break;
    }
  }

  // Set/update attributes from newEl
  const newAttrs = newEl.attributes;
  for (let i = 0; i < newAttrs.length; i++) {
    const attr = newAttrs[i]!;
    // Skip directive-owned attributes
    if (attr.name === 'style' && hasDataShow) continue;
    if (attr.name === 'class' && liveHasClassDirectives) continue;
    if ((attr.name === 'value' || attr.name === 'checked') && hasDataModel) continue;
    if (bindTargets.has(attr.name)) continue;

    const liveVal = liveEl.getAttribute(attr.name);
    if (liveVal !== attr.value) {
      liveEl.setAttribute(attr.name, attr.value);
    }
  }

  // Remove attributes that are no longer present in newEl
  // Iterate backwards since removeAttribute shifts indices
  for (let i = liveAttrs.length - 1; i >= 0; i--) {
    const attr = liveAttrs[i]!;
    if (!newEl.hasAttribute(attr.name)) {
      if (attr.name === 'style' && hasDataShow) continue;
      if (attr.name === 'class' && liveHasClassDirectives) continue;
      if ((attr.name === 'value' || attr.name === 'checked') && hasDataModel) continue;
      if (bindTargets.has(attr.name)) continue;

      liveEl.removeAttribute(attr.name);
    }
  }
}

// ── Text node patching ────────────────────────────────────────────────

function patchTextNodes(liveEl: Element, newEl: Element): void {
  // data-text directive owns this element's text content — don't overwrite
  if (liveEl.hasAttribute('data-text')) return;

  const liveTexts: Text[] = [];
  const newTexts: { node: Text; index: number }[] = [];

  for (const child of Array.from(liveEl.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) liveTexts.push(child as Text);
  }
  for (let i = 0; i < newEl.childNodes.length; i++) {
    const child = newEl.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE) newTexts.push({ node: child as Text, index: i });
  }

  // Fast path: same count, just patch content
  if (liveTexts.length === newTexts.length) {
    for (let i = 0; i < liveTexts.length; i++) {
      if (liveTexts[i].textContent !== newTexts[i].node.textContent) {
        liveTexts[i].textContent = newTexts[i].node.textContent;
      }
    }
    return;
  }

  // Count mismatch: reuse live text nodes in order, insert/remove as needed
  const usedLive = new Set<Text>();
  let liveIdx = 0;

  for (const { node: newText, index: newChildIdx } of newTexts) {
    if (liveIdx < liveTexts.length) {
      // Reuse existing text node
      const liveText = liveTexts[liveIdx]!;
      liveIdx++;
      usedLive.add(liveText);
      if (liveText.textContent !== newText.textContent) {
        liveText.textContent = newText.textContent;
      }
    } else {
      // Insert new text node at correct position
      const ref = findTextInsertionRef(liveEl, newEl, newChildIdx);
      liveEl.insertBefore(document.createTextNode(newText.textContent ?? ''), ref);
    }
  }

  // Remove unused live text nodes
  for (const lt of liveTexts) {
    if (!usedLive.has(lt) && lt.parentNode === liveEl) {
      liveEl.removeChild(lt);
    }
  }
}

/** Find the insertion reference node for a text node being inserted into liveEl. */
function findTextInsertionRef(liveEl: Element, newEl: Element, newIdx: number): Node | null {
  for (let j = newIdx + 1; j < newEl.childNodes.length; j++) {
    const sibling = newEl.childNodes[j];
    if (sibling.nodeType === Node.ELEMENT_NODE) {
      const key = (sibling as Element).getAttribute('data-forma-id');
      if (key) {
        const match = liveEl.querySelector(`[data-forma-id="${CSS.escape(key)}"]`);
        if (match && match.parentElement === liveEl) return match;
      }
    }
  }
  return null;
}

// ── Recursive element diffing ─────────────────────────────────────────

function diffChildren(
  liveParent: Element,
  newParent: Element,
  config: ReconcilerConfig,
): void {
  // Skip directive-owned subtrees
  if (ownsSubtree(liveParent)) return;

  // Patch text nodes at this level
  patchTextNodes(liveParent, newParent);

  // Collect child elements (ignore text nodes for structural diff)
  const liveChildren = Array.from(liveParent.children);
  const newChildren = Array.from(newParent.children);

  // Build keyed maps for data-forma-id elements
  const liveKeyed = new Map<string, Element>();
  const liveUnkeyed: Element[] = [];
  for (const child of liveChildren) {
    if (child.hasAttribute('data-forma-leaving')) continue;
    const key = child.getAttribute('data-forma-id');
    if (key) {
      liveKeyed.set(key, child);
    } else {
      liveUnkeyed.push(child);
    }
  }

  let unkeyedIdx = 0;

  // Walk new children in order
  const usedLiveElements = new Set<Element>();

  for (const newChild of newChildren) {
    const key = newChild.getAttribute('data-forma-id');
    let liveMatch: Element | undefined;

    if (key) {
      liveMatch = liveKeyed.get(key);
    } else {
      // Match unkeyed elements by position and tag
      while (unkeyedIdx < liveUnkeyed.length) {
        const candidate = liveUnkeyed[unkeyedIdx];
        unkeyedIdx++;
        if (candidate.tagName === newChild.tagName && !usedLiveElements.has(candidate)) {
          liveMatch = candidate;
          break;
        }
      }
    }

    if (liveMatch) {
      usedLiveElements.add(liveMatch);

      // Check if this is a data-forma-state scope element
      if (liveMatch.hasAttribute('data-forma-state') && newChild.hasAttribute('data-forma-state')) {
        const mode = determineScopeMode(liveMatch, newChild);

        switch (mode) {
          case 'PRESERVE':
            // Patch attributes only, keep reactive bindings alive
            patchAttributes(liveMatch, newChild);
            // Recurse into non-directive-owned children
            diffChildren(liveMatch, newChild, config);
            break;

          case 'RESET':
            // Unmount old scope, patch DOM, mount fresh
            config.unmountScope(liveMatch);
            patchAttributes(liveMatch, newChild);
            // Replace inner content
            replaceInnerContent(liveMatch, newChild);
            config.mountScope(liveMatch);
            break;

          case 'REPLACE': {
            // Full element swap
            config.unmountScope(liveMatch);
            const replacement = newChild.cloneNode(true) as Element;
            liveParent.replaceChild(replacement, liveMatch);
            config.mountScope(replacement);
            usedLiveElements.delete(liveMatch);
            liveMatch = replacement;
            usedLiveElements.add(replacement);
            break;
          }
        }
      } else {
        // Non-scope element: patch attrs and recurse
        patchAttributes(liveMatch, newChild);
        diffChildren(liveMatch, newChild, config);
      }

      // Ensure element is in the correct position
      // Find where it should be relative to previousSibling
      ensurePosition(liveParent, liveMatch, newChild, newChildren);
    } else {
      // New element — insert it
      const clone = newChild.cloneNode(true) as Element;
      // Find insertion point
      const insertionRef = findInsertionPoint(liveParent, newChild, newChildren);
      liveParent.insertBefore(clone, insertionRef);
      usedLiveElements.add(clone);

      // Mount any scopes in the new element
      if (clone.hasAttribute('data-forma-state')) {
        config.mountScope(clone);
      }
      const nestedScopes = clone.querySelectorAll('[data-forma-state]');
      for (const nested of Array.from(nestedScopes)) {
        config.mountScope(nested);
      }
    }
  }

  // Remove live children that are no longer in new children
  for (const child of liveChildren) {
    if (!usedLiveElements.has(child)) {
      // Guard: element may already be detached (e.g. after REPLACE)
      if (child.parentElement !== liveParent) continue;
      // Guard: element is mid-leave transition — its transition will remove it
      if (child.hasAttribute('data-forma-leaving')) continue;
      // Unmount any scopes
      if (child.hasAttribute('data-forma-state')) {
        config.unmountScope(child);
      }
      const nestedScopes = child.querySelectorAll('[data-forma-state]');
      for (const nested of Array.from(nestedScopes)) {
        config.unmountScope(nested);
      }
      liveParent.removeChild(child);
    }
  }
}

/** Replace inner content of live element with content from new element */
function replaceInnerContent(liveEl: Element, newEl: Element): void {
  // Remove all children
  while (liveEl.firstChild) {
    liveEl.removeChild(liveEl.firstChild);
  }
  // Clone and append all children from new element
  for (const child of Array.from(newEl.childNodes)) {
    liveEl.appendChild(child.cloneNode(true));
  }
}

/** Ensure a live element is at the correct position */
function ensurePosition(
  parent: Element,
  liveEl: Element,
  _newEl: Element,
  newChildren: Element[],
): void {
  const newIdx = newChildren.indexOf(_newEl);
  const liveChildElements = Array.from(parent.children);
  const currentIdx = liveChildElements.indexOf(liveEl);

  if (currentIdx !== newIdx) {
    // Find the element that should come after this one
    const nextNewChild = newChildren[newIdx + 1];
    if (nextNewChild) {
      const nextKey = nextNewChild.getAttribute('data-forma-id');
      if (nextKey) {
        // Find this element in live DOM
        const nextLive = parent.querySelector(`[data-forma-id="${CSS.escape(nextKey)}"]`);
        if (nextLive && nextLive.parentElement === parent) {
          parent.insertBefore(liveEl, nextLive);
          return;
        }
      }
    }
    // Append to end
    parent.appendChild(liveEl);
  }
}

/** Find the correct insertion point for a new element */
function findInsertionPoint(
  parent: Element,
  newChild: Element,
  newChildren: Element[],
): Node | null {
  const newIdx = newChildren.indexOf(newChild);

  // Look for the next sibling in the new children that exists in the live DOM
  for (let i = newIdx + 1; i < newChildren.length; i++) {
    const key = newChildren[i].getAttribute('data-forma-id');
    if (key) {
      const existing = parent.querySelector(`[data-forma-id="${CSS.escape(key)}"]`);
      if (existing && existing.parentElement === parent) {
        return existing;
      }
    }
  }

  return null; // Append to end
}

// ── Factory ───────────────────────────────────────────────────────────

export function createReconciler(config: ReconcilerConfig) {
  /** Last HTML string that was successfully reconciled into this container.
   *  Used to skip reconciliation when the HTML hasn't changed. */
  let _lastHtml = '';

  return function reconcile(container: Element, html: string): void {
    const trimmed = html.trim();
    if (!trimmed) return;

    // Fast path: skip reconciliation entirely when HTML is identical
    if (trimmed === _lastHtml && container.hasChildNodes()) return;
    _lastHtml = trimmed;

    // Disconnect observer to prevent double-mount during patching
    config.disconnectObserver();

    try {
      // ── Fast path: empty container ──
      if (!container.hasChildNodes() || container.children.length === 0) {
        container.innerHTML = trimmed;

        // Mount all data-forma-state scopes
        config.batch(() => {
          const scopes = container.querySelectorAll('[data-forma-state]');
          for (const scope of Array.from(scopes)) {
            config.mountScope(scope);
          }
        });

        return;
      }

      // ── Parse new HTML into a DocumentFragment ──
      const fragment = parseHTML(trimmed);
      const templateContainer = document.createElement('div');
      templateContainer.appendChild(fragment);

      // ── Full-replacement fast path ──
      // When there is zero data-forma-id overlap between live and new children,
      // skip the diff entirely — dispose all live scopes, innerHTML, mount fresh.
      // This handles module-switch scenarios cleanly and avoids issues with
      // corrupted HTML confusing the diff.
      const liveKeys = new Set<string>();
      for (const child of Array.from(container.children)) {
        if (child.hasAttribute('data-forma-leaving')) continue;
        const key = child.getAttribute('data-forma-id');
        if (key) liveKeys.add(key);
      }
      let hasOverlap = false;
      if (liveKeys.size > 0) {
        for (const child of Array.from(templateContainer.children)) {
          const key = child.getAttribute('data-forma-id');
          if (key && liveKeys.has(key)) { hasOverlap = true; break; }
        }
      }

      if (liveKeys.size > 0 && !hasOverlap) {
        // Full replacement: unmount all live scopes, replace content, mount new
        config.batch(() => {
          const liveScopes = container.querySelectorAll('[data-forma-state]');
          for (const scope of Array.from(liveScopes)) {
            config.unmountScope(scope);
          }
          container.innerHTML = trimmed;
          const newScopes = container.querySelectorAll('[data-forma-state]');
          for (const scope of Array.from(newScopes)) {
            config.mountScope(scope);
          }
        });
        return;
      }

      // ── Diff and patch ──
      config.batch(() => {
        diffChildren(container, templateContainer, config);
      });
    } finally {
      // Always reconnect observer, even if an error occurred
      config.reconnectObserver();
    }
  };
}
