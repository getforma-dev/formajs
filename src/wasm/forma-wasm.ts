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

let wasmModule: WasmExports | null = null;
let irCache: Map<string, Uint8Array> = new Map();

async function ensureWasm(): Promise<WasmExports> {
  if (wasmModule) return wasmModule;

  const config = window.__FORMA_WASM__;
  if (!config) throw new Error('No __FORMA_WASM__ config');

  // Dynamic import of wasm-pack generated loader
  const mod = await import(/* @vite-ignore */ config.loader);
  await mod.default(config.binary);
  wasmModule = mod as unknown as WasmExports;
  return wasmModule;
}

async function getIR(): Promise<Uint8Array> {
  const config = window.__FORMA_WASM__;
  if (!config) throw new Error('No __FORMA_WASM__ config');

  const cached = irCache.get(config.ir);
  if (cached) return cached;

  const response = await fetch(config.ir);
  const bytes = new Uint8Array(await response.arrayBuffer());
  irCache.set(config.ir, bytes);
  return bytes;
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
