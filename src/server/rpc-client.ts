/**
 * FormaJS Server - RPC Client
 *
 * Provides the client-side stub function that replaces "use server" function
 * bodies after compilation. Each call becomes a fetch POST to the server endpoint.
 */

/**
 * Create an RPC stub function for a server function.
 * This replaces the original function body on the client side.
 *
 * @param endpoint - The RPC endpoint path (e.g. "/rpc/createTodo_a1b2c3")
 * @returns An async function that sends args to the server and returns the result
 */
export function $$serverFunction<T extends (...args: unknown[]) => Promise<unknown>>(
  endpoint: string,
): T {
  const rpcFn = async (...args: unknown[]): Promise<unknown> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forma-RPC': '1',
      },
      body: JSON.stringify({ args }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server function failed (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // If the response includes revalidation data (single-flight mutations),
    // return it alongside the result
    if (result && typeof result === 'object' && '__revalidate' in result) {
      // Dispatch a custom event so createAction can pick up the revalidation data
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('forma:revalidate', {
          detail: result.__revalidate,
        }));
      }
      return result.data;
    }

    return result;
  };

  return rpcFn as T;
}
