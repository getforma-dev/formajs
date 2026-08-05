/**
 * Proves the two claims src/reactive/dev.ts makes about itself:
 *
 *   1. `__DEV__` is fixed at BUILD time in dist, not derived from NODE_ENV at
 *      runtime — the defect that shipped dev warnings to any production process
 *      that left NODE_ENV unset.
 *   2. Two copies of the module graph in one process are detected and reported.
 *
 * Claim 1 is checked by bundling the real source with the real build defines
 * (imported from scripts/build-defines.mjs, the same module tsup.config.ts
 * reads) and inspecting/executing the output. That is fast enough to belong in
 * the unit suite; the whole-dist equivalent is scripts/verify-dist.mjs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { PROD_DEFINE, RAW_SOURCE_DEV_GLOBAL } from '../../../scripts/build-defines.mjs';

const ROOT = process.cwd();
const DEV_MODULE = resolve(ROOT, 'src/reactive/dev.ts');

/**
 * Bundle dev.ts the way tsup does, optionally without the production define.
 * `platform: 'node'` matches tsup's default and is required for the negative
 * case: esbuild's browser platform folds `process.env.NODE_ENV` away by itself,
 * which would make the raw-source assertion below pass for the wrong reason.
 */
async function bundleDevModule(define: Record<string, string>): Promise<string> {
  const result = await build({
    entryPoints: [DEV_MODULE],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    minifySyntax: true,
    define,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

describe('__DEV__ build-time resolution', () => {
  it('resolves __DEV__ at build time and drops the NODE_ENV fallback', async () => {
    const code = await bundleDevModule({ ...PROD_DEFINE });

    // The declaration is a literal, not a call.
    expect(code).toMatch(/\b(?:var|let|const)\s+__DEV__\s*=\s*(?:false|!1)\b/);
    // The whole runtime-detection fallback is gone: no NODE_ENV read, and no
    // trace of the raw-source opt-in global that only appears inside it.
    expect(code).not.toContain('NODE_ENV');
    expect(code).not.toContain(RAW_SOURCE_DEV_GLOBAL);
  });

  it('evaluates to false in a built artifact even when NODE_ENV is unset', async () => {
    const code = await bundleDevModule({ ...PROD_DEFINE });
    const encoded = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;

    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      const mod = (await import(/* @vite-ignore */ encoded)) as { __DEV__: boolean };
      expect(mod.__DEV__).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('still honours NODE_ENV when nothing replaced the build flag', async () => {
    // Raw-source consumers (this repo's own vitest run) must keep dev warnings.
    const code = await bundleDevModule({});
    expect(code).toContain('NODE_ENV');
    expect(code).not.toMatch(/\b(?:var|let|const)\s+__DEV__\s*=\s*(?:false|!1)\s*[,;]/);
  });
});

// ---------------------------------------------------------------------------

const INSTANCE_KEY = Symbol.for('@getforma/core#instances');
type InstanceHost = Record<symbol, { count: number; warned: boolean } | undefined>;

describe('duplicate-instance detection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete (globalThis as unknown as InstanceHost)[INSTANCE_KEY];
  });

  it('stays silent for the single copy every normal consumer loads', async () => {
    delete (globalThis as unknown as InstanceHost)[INSTANCE_KEY];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.resetModules();
    await import('../dev.js');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns once when a second copy of the module graph registers', async () => {
    // Simulates the shipped topologies that really do this: mixing `import`
    // and `require` of @getforma/core, or loading the root entry alongside
    // runtime-hardened, which bundles its own private copy of the core.
    const host = globalThis as unknown as InstanceHost;
    delete host[INSTANCE_KEY];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.resetModules();
    await import('../dev.js');
    expect(host[INSTANCE_KEY]?.count).toBe(1);
    expect(warn).not.toHaveBeenCalled();

    vi.resetModules();
    await import('../dev.js');
    expect(host[INSTANCE_KEY]?.count).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Duplicate @getforma/core instance detected');

    // A third copy does not re-warn.
    vi.resetModules();
    await import('../dev.js');
    expect(host[INSTANCE_KEY]?.count).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
