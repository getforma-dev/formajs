/**
 * Forma DOM - Portal
 *
 * Renders children into a different DOM container than the parent.
 * Useful for modals, tooltips, dropdowns that need to escape overflow.
 *
 * SolidJS equivalent: <Portal mount={}>
 */

import { createEffect } from 'forma/reactive';

/**
 * Render content into an external DOM container.
 *
 * ```ts
 * const modal = createPortal(
 *   () => h('div', { class: 'modal' }, 'Modal content'),
 *   document.body,
 * );
 * ```
 *
 * Returns a comment node placeholder. The actual content is rendered
 * into the target container. Cleanup removes content from target.
 */
export function createPortal(
  children: () => Node,
  target?: Element | string,
): Comment {
  const placeholder = document.createComment('forma-portal');

  const resolvedTarget = typeof target === 'string'
    ? document.querySelector(target)
    : (target ?? document.body);

  if (!resolvedTarget) {
    throw new Error(`createPortal: target not found: ${target}`);
  }

  let mountedNode: Node | null = null;
  const removeMountedNode = () => {
    if (mountedNode && mountedNode.parentNode === resolvedTarget) {
      resolvedTarget.removeChild(mountedNode);
    }
    mountedNode = null;
  };

  createEffect(() => {
    const node = children();

    mountedNode = node;
    resolvedTarget.appendChild(node);

    // The ONE place the previous node is detached. `createEffect` runs this
    // cleanup before every re-run and once on dispose, which covers both the
    // re-render case (the target must hold exactly one node, never a stack of
    // them) and teardown. The body used to call `removeMountedNode()` a second
    // time up front; that call could be deleted with the suite green, because
    // by the time the body runs the cleanup has already detached the old node.
    // Verified by: src/dom/__tests__/branch-depth.test.ts > "removes the previous node on every re-render, three times over"
    return () => {
      removeMountedNode();
    };
  });

  return placeholder;
}
