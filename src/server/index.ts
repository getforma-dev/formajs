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
