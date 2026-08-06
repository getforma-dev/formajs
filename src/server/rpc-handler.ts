/**
 * FormaJS Server - RPC Handler
 *
 * Server-side registry and request handler for "use server" functions.
 * Framework-agnostic — works with any Node.js HTTP server, Express, Hono, etc.
 */

export type ServerFunction = (...args: unknown[]) => Promise<unknown>;

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
  /** Suggested HTTP status for the middleware to map (error paths only). Not sent in the body. */
  status?: number;
  __revalidate?: Record<string, unknown>;
}

/** Context passed to an {@link RPCGuard} (the request and its headers, if available). */
export interface RPCContext {
  req?: unknown;
  headers?: Record<string, string | undefined>;
}

/**
 * Authorization guard for RPC calls. Return false (or a rejected/false promise)
 * to deny the call with 403. handleRPC performs NO authentication by itself —
 * install a guard to authenticate/authorize.
 */
export type RPCGuard = (endpoint: string, args: unknown[], ctx: RPCContext) => boolean | Promise<boolean>;

let globalGuard: RPCGuard | undefined;

/** Install (or clear) a process-global RPC authorization guard. */
export function setRPCGuard(fn: RPCGuard | undefined): void {
  globalGuard = fn;
}

/** Options for {@link handleRPC}. */
export interface HandleRPCOptions {
  /** Per-call guard; overrides the global guard when provided. */
  authorize?: RPCGuard;
  /** Context forwarded to the guard. */
  context?: RPCContext;
}

/** Keys that enable prototype-pollution; stripped from RPC args before invocation. */
const FORBIDDEN_ARG_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Delete prototype-pollution keys at every depth of parsed RPC arguments
 * (mutating, in place).
 *
 * Iterative with an explicit stack, not recursive: the body is fully
 * attacker-controlled and this runs before any authorization guard, so a
 * per-level recursion let a ~120 KB deeply nested body exhaust the call stack —
 * and the RangeError escaped as an unhandled rejection. Depth now costs heap,
 * not stack. The WeakSet keeps the walk finite if a body arrives with shared or
 * cyclic references (JSON.parse cannot produce them; an upstream body parser
 * can).
 *
 * Verified by: src/server/__tests__/rpc-deep-strip.test.ts > "strips forbidden keys at a depth that overflows a recursive walk"
 * Verified by: src/server/__tests__/rpc-deep-strip.test.ts > "terminates on a cyclic argument graph"
 */
function deepStripForbidden<T>(value: T): T {
  const stack: unknown[] = [value];
  const seen = new WeakSet<object>();

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const key of FORBIDDEN_ARG_KEYS) {
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        // Guard the delete: it throws on a frozen/sealed (non-configurable) prop.
        const desc = Object.getOwnPropertyDescriptor(current, key);
        if (desc?.configurable) delete (current as Record<string, unknown>)[key];
      }
    }

    for (const k of Object.keys(current as Record<string, unknown>)) {
      stack.push((current as Record<string, unknown>)[k]);
    }
  }

  return value;
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
  options?: HandleRPCOptions,
): Promise<RPCResponse> {
  // Security: prevent prototype pollution via crafted endpoint names
  const endpointName = endpoint.split('/').pop() ?? '';
  if (FORBIDDEN_KEYS.has(endpointName)) {
    return { error: 'Forbidden endpoint name', status: 403 };
  }

  // Enforce the args-array contract on the direct path too (not just middleware).
  if (!body || !Array.isArray(body.args)) {
    return { error: 'Invalid RPC request: missing args array', status: 400 };
  }

  const fn = registry.get(endpoint);
  if (!fn) {
    return { error: `Unknown server function: ${endpoint}`, status: 404 };
  }

  // Strip prototype-pollution keys from client-controlled args before invocation.
  // Copying and walking untrusted input can still throw (a hostile getter or
  // Proxy in a body some upstream parser produced), and this runs before the
  // authorization guard, so failure degrades to 400 instead of escaping into the
  // caller's await.
  // Verified by: src/server/__tests__/rpc-deep-strip.test.ts > "rejects args that throw while being read instead of propagating"
  let args: unknown[];
  try {
    args = deepStripForbidden([...body.args]);
  } catch {
    return { error: 'Invalid RPC request: unreadable args', status: 400 };
  }

  // Authorization is the deployment's responsibility — run any installed guard.
  // A guard that throws or rejects is treated as a denial (fail-closed): return
  // 403 without leaking the guard's error to the client.
  const guard = options?.authorize ?? globalGuard;
  if (guard) {
    let ok: boolean;
    try {
      ok = !!(await guard(endpoint, args, options?.context ?? {}));
    } catch {
      return { error: 'Forbidden', status: 403 };
    }
    if (!ok) return { error: 'Forbidden', status: 403 };
  }

  try {
    const result = await fn(...args);

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
    return { error: message, status: 500 };
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
export function createRPCMiddleware(opts?: { guard?: RPCGuard }) {
  return async (
    req: { url: string; method: string; path?: string; body?: unknown; headers?: Record<string, string | undefined> },
    res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } },
  ) => {
    try {
      await handleRPCRequest(req, res, opts);
    } catch (err) {
      // Last-resort barrier. This function is awaited by the host framework, so
      // anything that throws here becomes an unhandled promise rejection, which
      // terminates the process under Node's default --unhandled-rejections=throw.
      // Every request path degrades to a 500 instead; details stay server-side.
      // Verified by: src/server/__tests__/rpc-deep-strip.test.ts > "degrades to 500 instead of rejecting when request handling throws"
      const isDev = typeof process !== 'undefined'
        && process.env?.NODE_ENV === 'development';
      if (isDev) console.error('[forma] RPC middleware error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

/** The middleware body, wrapped by {@link createRPCMiddleware}'s error barrier. */
async function handleRPCRequest(
  req: { url: string; method: string; path?: string; body?: unknown; headers?: Record<string, string | undefined> },
  res: { json: (data: unknown) => void; status: (code: number) => { json: (data: unknown) => void } },
  opts?: { guard?: RPCGuard },
): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // CSRF mitigation: require the custom header (which forces a CORS preflight
  // and cannot be set by a cross-site HTML form) and a JSON content type.
  const h = req.headers ?? {};
  if (h['x-forma-rpc'] !== '1') {
    res.status(403).json({ error: 'Missing X-Forma-RPC header' });
    return;
  }
  const ct = String(h['content-type'] ?? '');
  if (!ct.includes('application/json')) {
    res.status(415).json({ error: 'Unsupported Media Type' });
    return;
  }

  const body = req.body as RPCRequest;
  if (!body || !Array.isArray(body.args)) {
    res.status(400).json({ error: 'Invalid RPC request: missing args array' });
    return;
  }

  // Resolve the endpoint path without the query string.
  const path = req.path ?? req.url.split('?')[0]!;
  const result = await handleRPC(path, body, undefined, {
    authorize: opts?.guard,
    context: { req, headers: h },
  });
  if (result.error) {
    res.status(result.status ?? 500).json({ error: result.error });
  } else {
    // Do not leak the internal `status` discriminator into the success body.
    const { status: _status, ...rest } = result;
    res.json(rest);
  }
}
