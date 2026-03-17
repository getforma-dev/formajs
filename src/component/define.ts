/**
 * Forma Component - Define
 *
 * Component definition system where the setup function runs ONCE.
 * Reactivity comes from signals, not re-rendering.
 * Backed by alien-signals via forma/reactive.
 */

import { reportError } from '../reactive/dev.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A teardown function that disposes effects and cleans up resources. */
export type CleanupFn = () => void;
/** A function that runs once to build the component's DOM tree. */
export type SetupFn = () => HTMLElement | DocumentFragment;

/** Definition object passed to {@link defineComponent}. */
export interface ComponentDef {
  /** The setup function that builds the component's DOM and reactive bindings. */
  setup: SetupFn;
  /** Optional debug name for devtools inspection. */
  name?: string;
}

// ---------------------------------------------------------------------------
// Lifecycle context stack
// ---------------------------------------------------------------------------

interface LifecycleContext {
  /** Dispose functions for all effects created during setup. */
  disposers: (() => void)[];
  /** Callbacks registered via onMount(). */
  mountCallbacks: (() => void | CleanupFn)[];
  /** Callbacks registered via onUnmount(). */
  unmountCallbacks: (() => void)[];
}

let currentLifecycleContext: LifecycleContext | null = null;
const lifecycleStack: (LifecycleContext | null)[] = [];

function pushLifecycleContext(ctx: LifecycleContext): void {
  lifecycleStack.push(currentLifecycleContext);
  currentLifecycleContext = ctx;
}

function popLifecycleContext(): void {
  currentLifecycleContext = lifecycleStack.pop() ?? null;
}

// ---------------------------------------------------------------------------
// Public API - Lifecycle hooks
// ---------------------------------------------------------------------------

/**
 * Register a callback that runs after the component's setup completes.
 * If the callback returns a function, that function is called on unmount.
 * Must be called inside a setup function.
 */
export function onMount(fn: () => void | CleanupFn): void {
  if (currentLifecycleContext === null) {
    throw new Error('onMount() must be called inside a component setup function');
  }
  currentLifecycleContext.mountCallbacks.push(fn);
}

/**
 * Register a callback that runs when the component is disposed.
 * Must be called inside a setup function.
 */
export function onUnmount(fn: () => void): void {
  if (currentLifecycleContext === null) {
    throw new Error('onUnmount() must be called inside a component setup function');
  }
  currentLifecycleContext.unmountCallbacks.push(fn);
}

// ---------------------------------------------------------------------------
// Internal: symbol for attaching dispose to DOM nodes
// ---------------------------------------------------------------------------

const DISPOSE_KEY = Symbol('forma:component:dispose');

interface DisposableNode {
  [DISPOSE_KEY]?: () => void;
}

// ---------------------------------------------------------------------------
// Public API - defineComponent
// ---------------------------------------------------------------------------

/**
 * Define a component from a setup function or definition object.
 * Returns a factory function that, when called, produces a DOM element
 * with attached lifecycle and disposal logic.
 *
 * The setup function runs ONCE per factory call. Reactivity is driven
 * by signals, not by re-running setup.
 */
export function defineComponent(
  setupOrDef: SetupFn | ComponentDef,
): () => HTMLElement | DocumentFragment {
  const setup: SetupFn =
    typeof setupOrDef === 'function' ? setupOrDef : setupOrDef.setup;
  const name: string | undefined =
    typeof setupOrDef === 'function' ? undefined : setupOrDef.name;

  return function componentFactory(): HTMLElement | DocumentFragment {
    // Create a fresh lifecycle context for this component instance
    const ctx: LifecycleContext = {
      disposers: [],
      mountCallbacks: [],
      unmountCallbacks: [],
    };

    // Push lifecycle context so onMount/onUnmount calls register here
    pushLifecycleContext(ctx);

    let dom: HTMLElement | DocumentFragment;
    try {
      dom = setup();
    } finally {
      popLifecycleContext();
    }

    // Build the dispose function that tears down the entire component
    const dispose = (): void => {
      // Run onUnmount callbacks
      for (const cb of ctx.unmountCallbacks) {
        try {
          cb();
        } catch (e) {
          reportError(e, 'onUnmount');
        }
      }

      // Dispose all effects
      for (const d of ctx.disposers) {
        try {
          d();
        } catch (e) {
          reportError(e, 'component disposer');
        }
      }

      // Clean up
      ctx.disposers.length = 0;
      ctx.mountCallbacks.length = 0;
      ctx.unmountCallbacks.length = 0;
    };

    // Attach dispose to the DOM node so callers can tear it down
    (dom as unknown as DisposableNode)[DISPOSE_KEY] = dispose;

    // Run mount callbacks (synchronously, after setup completes)
    // If a mount callback returns a cleanup, register it as an unmount callback
    for (const cb of ctx.mountCallbacks) {
      try {
        const cleanup = cb();
        if (typeof cleanup === 'function') {
          ctx.unmountCallbacks.push(cleanup);
        }
      } catch (e) {
        reportError(e, 'onMount');
      }
    }

    return dom;
  };
}

/**
 * Dispose a component that was created via defineComponent.
 * This runs all onUnmount callbacks and disposes all tracked effects.
 */
export function disposeComponent(dom: HTMLElement | DocumentFragment): void {
  const disposable = dom as unknown as DisposableNode;
  if (typeof disposable[DISPOSE_KEY] === 'function') {
    disposable[DISPOSE_KEY]();
    delete disposable[DISPOSE_KEY];
  }
}

/**
 * Track an effect disposal within the current component's lifecycle.
 * Call this inside a setup function to ensure effects are cleaned up
 * when the component is disposed.
 */
export function trackDisposer(dispose: () => void): void {
  if (currentLifecycleContext !== null) {
    currentLifecycleContext.disposers.push(dispose);
  }
}
