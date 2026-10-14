import { sourceIsDev, warnDeprecated } from '../deprecated.js';

// Action (optimistic UI)
export { createAction, type ActionOptions, type Action } from './action.js';

// Mutation (single-flight)
export {
  registerResource, unregisterResource, applyRevalidation,
  enableAutoRevalidation, withRevalidation,
  type MutationResponse,
} from './mutation.js';

// RPC client
export { $$serverFunction } from './rpc-client.js';

// RPC handler (server-side)
export {
  registerServerFunction, getServerFunction, getRegisteredEndpoints,
  handleRPC, createRPCMiddleware, setRPCGuard,
  type RPCRequest, type RPCResponse, type ServerFunction,
  type RPCGuard, type RPCContext, type HandleRPCOptions,
} from './rpc-handler.js';

declare const __FORMA_DEV_BUILD__: boolean | undefined;

// Deprecated, removed in 3.0.0 (DR-22). The first load of this entry in a
// development build logs FORMA_W_DEPRECATED_SERVER once. The condition is
// `__DEV__`'s (src/reactive/dev.ts, with `sourceIsDev()` for its fallback),
// written out so the build folds it in this file: every published artifact is
// built with the flag `false`, so the build drops the call and its import, and
// no published file carries the warning.
// Verified by: src/__tests__/deprecated-entries.test.ts > "a production build of each deprecated entry carries no warning"
if ((typeof __FORMA_DEV_BUILD__ === 'boolean' && __FORMA_DEV_BUILD__)
  || (typeof __FORMA_DEV_BUILD__ !== 'boolean' && sourceIsDev())) {
  warnDeprecated('FORMA_W_DEPRECATED_SERVER');
}
