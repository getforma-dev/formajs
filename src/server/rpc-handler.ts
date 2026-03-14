/**
 * FormaJS Server - RPC Handler
 *
 * Server-side registry and request handler for "use server" functions.
 * Framework-agnostic — works with any Node.js HTTP server, Express, Hono, etc.
 */

type ServerFunction = (...args: unknown[]) => Promise<unknown>;

/** Registry of server functions by endpoint path. */
const registry = new Map<string, ServerFunction>();

/**
 * Register a server function at a specific endpoint.
 * Called by the server-side compiled output.
 */
export function registerServerFunction(endpoint: string, fn: ServerFunction): void {
  registry.set(endpoint, fn);
}

/**
 * Get a registered server function by endpoint.
 */
export function getServerFunction(endpoint: string): ServerFunction | undefined {
  return registry.get(endpoint);
}

/**
 * Get all registered server function endpoints.
 */
export function getRegisteredEndpoints(): string[] {
  return [...registry.keys()];
}

export interface RPCRequest {
  args: unknown[];
}

export interface RPCResponse {
  data?: unknown;
  error?: string;
  __revalidate?: Record<string, unknown>;
}

/**
 * Handle an incoming RPC request.
 * Call this from your HTTP server's request handler.
 *
 * Usage with any HTTP framework:
 * ```ts
 * import { handleRPC } from 'forma/server/rpc-handler';
 *
 * // Express example:
 * app.post('/rpc/:endpoint', async (req, res) => {
 *   const result = await handleRPC(req.path, req.body);
 *   res.json(result);
 * });
 *
 * // Hono example:
 * app.post('/rpc/*', async (c) => {
 *   const body = await c.req.json();
 *   const result = await handleRPC(c.req.path, body);
 *   return c.json(result);
 * });
 * ```
 *
 * @param endpoint - The full endpoint path (e.g. "/rpc/createTodo_a1b2c3")
 * @param body - The parsed request body containing { args: [...] }
 * @param revalidateData - Optional revalidation data to include in the response
 *                         (for single-flight mutations)
 */
/** "Crash Barrier": block prototype pollution attacks via endpoint names. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export async function handleRPC(
  endpoint: string,
  body: RPCRequest,
  revalidateData?: Record<string, unknown>,
): Promise<RPCResponse> {
  // Security: prevent prototype pollution via crafted endpoint names
  const endpointName = endpoint.split('/').pop() ?? '';
  if (FORBIDDEN_KEYS.has(endpointName)) {
    return { error: 'Forbidden endpoint name' };
  }

  const fn = registry.get(endpoint);
  if (!fn) {
    return { error: `Unknown server function: ${endpoint}` };
  }

  try {
    const result = await fn(...body.args);

    if (revalidateData) {
      return { data: result, __revalidate: revalidateData };
    }

    return { data: result };
  } catch (err) {
    // Don't leak internal error details to clients
    const isDev = typeof process !== 'undefined'
      && process.env?.NODE_ENV === 'development';
    const message = isDev && err instanceof Error
      ? err.message
      : 'Internal server error';
    return { error: message };
  }
}

/**
 * Create a middleware-style handler for use with Express-like frameworks.
 *
 * ```ts
 * import { createRPCMiddleware } from 'forma/server/rpc-handler';
 * app.use('/rpc', createRPCMiddleware());
 * ```
 */
export function createRPCMiddleware() {
  return async (req: { url: string; method: string; body?: unknown }, res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } }) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const body = req.body as RPCRequest;
    if (!body || !Array.isArray(body.args)) {
      res.status(400).json({ error: 'Invalid RPC request: missing args array' });
      return;
    }

    const result = await handleRPC(req.url, body);
    if (result.error) {
      res.status(500).json(result);
    } else {
      res.json(result);
    }
  };
}
