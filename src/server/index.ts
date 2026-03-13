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
  handleRPC, createRPCMiddleware,
  type RPCRequest, type RPCResponse,
} from './rpc-handler.js';
