// Client-side WASM walker loader.
// Reads URLs from window.__FORMA_WASM__, lazy-loads WASM module + IR bytes,
// provides renderLocal() and renderIsland() for zero-server-trip re-renders.

declare global {
  interface Window {
    __FORMA_WASM__?: {
      loader: string;
      binary: string;
      ir: string;
    };
  }
}

interface WasmExports {
  render(ir_bytes: Uint8Array, slots_json: string): string;
  render_island(ir_bytes: Uint8Array, slots_json: string, island_id: number): string;
}

// Memoize the IN-FLIGHT promises (not the resolved values) so concurrent
// callers share one instantiation / fetch; the promise is cleared on failure so
// a later call retries instead of being stuck with a cached error.
let wasmPromise: Promise<WasmExports> | null = null;
const irPromises: Map<string, Promise<Uint8Array>> = new Map();

function ensureWasm(): Promise<WasmExports> {
  if (wasmPromise) return wasmPromise;

  const config = window.__FORMA_WASM__;
  if (!config) throw new Error('No __FORMA_WASM__ config'); // sync — not memoized

  wasmPromise = (async () => {
    // Dynamic import of wasm-pack generated loader
    const mod = await import(/* @vite-ignore */ config.loader);
    await mod.default(config.binary);
    return mod as unknown as WasmExports;
  })();
  wasmPromise.catch(() => { wasmPromise = null; }); // evict on failure so next call retries
  return wasmPromise;
}

function getIR(): Promise<Uint8Array> {
  const config = window.__FORMA_WASM__;
  if (!config) throw new Error('No __FORMA_WASM__ config'); // sync — not memoized

  const key = config.ir;
  const existing = irPromises.get(key);
  if (existing) return existing;

  const p = (async () => {
    const response = await fetch(key);
    if (!response.ok) {
      // Do NOT cache a 404/500 error page as IR bytes.
      throw new Error(`Failed to fetch IR: ${response.status} ${response.statusText}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  })();
  irPromises.set(key, p);
  p.catch(() => { irPromises.delete(key); }); // evict on failure so next call retries
  return p;
}

/** Full page render via WASM. */
export async function renderLocal(slotsJson: string): Promise<string> {
  const [wasm, ir] = await Promise.all([ensureWasm(), getIR()]);
  return wasm.render(ir, slotsJson);
}

/** Fragment render (single island) via WASM. */
export async function renderIsland(slotsJson: string, islandId: number): Promise<string> {
  const [wasm, ir] = await Promise.all([ensureWasm(), getIR()]);
  return wasm.render_island(ir, slotsJson, islandId);
}
