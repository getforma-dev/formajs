/**
 * Forma Component
 *
 * Component definition and dependency injection for the Forma framework.
 * Zero dependencies -- native browser APIs only.
 */

export {
  defineComponent,
  disposeComponent,
  trackDisposer,
  onMount,
  onUnmount,
} from './define.js';

export {
  createContext,
  provide,
  inject,
  unprovide,
  type Context,
} from './context.js';
