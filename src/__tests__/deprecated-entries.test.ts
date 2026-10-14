/**
 * The three entry points 2.x deprecates and 3.0.0 removes (FORMA-131; v2's
 * DR-22 to DR-24): `./server`, `./wasm` and `./ssr`.
 *
 * Each logs one warning, with a stable code, the first time it is loaded in a
 * development build, and a production build of it is what it was before: the
 * warning, its helper and the helper's import are folded away. The first half
 * imports the source, as this repo's suite and a consumer compiling core from
 * source do; the second half runs the real tsup configs, as
 * build-artifacts.test.ts does, because the folding is the build's, not the
 * source's. scripts/verify-dist.mjs checks the published files themselves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build, type Options } from 'tsup';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import rawConfig from '../../tsup.config';
import { parseImportSpecifiers } from '../../scripts/check-size.mjs';
import { RAW_SOURCE_DEV_GLOBAL } from '../../scripts/build-defines.mjs';
import { DEPRECATIONS, type DeprecationCode } from '../deprecated';

const LOGGED = Symbol.for('@getforma/core#deprecations');
const INSTANCES = Symbol.for('@getforma/core#instances');
type Host = Record<symbol, unknown>;

/** Each deprecated subpath: its source entry, its tsup entry, its code, and what replaces it. */
const ENTRIES: ReadonlyArray<{
  subpath: string;
  load: () => Promise<unknown>;
  tsupEntry: string;
  code: DeprecationCode;
  replacement: string;
}> = [
  {
    subpath: './server',
    load: () => import('../server/index'),
    tsupEntry: 'server',
    code: 'FORMA_W_DEPRECATED_SERVER',
    replacement: "a route in your application's Rust server",
  },
  {
    subpath: './wasm',
    load: () => import('../wasm/forma-wasm'),
    tsupEntry: 'wasm',
    code: 'FORMA_W_DEPRECATED_WASM',
    replacement: 'with h()',
  },
  {
    subpath: './ssr',
    load: () => import('../ssr/index'),
    tsupEntry: 'ssr/index',
    code: 'FORMA_W_DEPRECATED_SSR',
    replacement: 'the Rust walker',
  },
];

/** The console.warn calls that carry `code`. */
function callsWith(warn: { mock: { calls: unknown[][] } }, code: string): string[] {
  return warn.mock.calls.map((args) => String(args[0])).filter((m) => m.includes(code));
}

describe('the deprecated entries in a development build (source)', () => {
  let previousEnv: string | undefined;

  beforeEach(() => {
    previousEnv = process.env.NODE_ENV;
    delete (globalThis as Host)[LOGGED];
    vi.resetModules();
  });

  afterEach(() => {
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
    delete (globalThis as Host)[LOGGED];
    delete (globalThis as Host)[INSTANCES];
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each(ENTRIES)('$subpath logs its deprecation once in development, with its code', async (entry) => {
    process.env.NODE_ENV = 'development';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await entry.load();
    await entry.load();
    // A second copy of the module (a reset, a development server's reload)
    // stays quiet too: the codes already logged live on globalThis.
    vi.resetModules();
    await entry.load();

    const logged = callsWith(warn, entry.code);
    expect(logged).toEqual([`[forma] ${entry.code}: ${DEPRECATIONS[entry.code]}`]);
    expect(logged[0]).toContain(`@getforma/core/${entry.subpath.slice(2)}`);
    expect(logged[0]).toContain('removed in 3.0.0');
    expect(logged[0]).toContain(entry.replacement);
    // Loading one entry says nothing about the other two.
    for (const other of ENTRIES) {
      if (other !== entry) expect(callsWith(warn, other.code)).toEqual([]);
    }
  });

  it.each(ENTRIES)('$subpath stays quiet when NODE_ENV is production', async (entry) => {
    process.env.NODE_ENV = 'production';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await entry.load();

    expect(callsWith(warn, 'FORMA_W_DEPRECATED')).toEqual([]);
  });

  it('decides a development build as __DEV__ does, under every NODE_ENV', async () => {
    // sourceIsDev() restates dev.ts's isDev() rather than importing dev.ts
    // (whose import would ship in dist/wasm.js for its side effect), so this
    // pins the two together. Importing dev.ts again registers another
    // instance, hence the silenced warn and the cleanup above.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const env of ['development', 'test', 'production', '', undefined]) {
      if (env === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = env;
      vi.resetModules();
      const { __DEV__ } = await import('../reactive/dev');
      const { sourceIsDev } = await import('../deprecated');
      expect(sourceIsDev(), `NODE_ENV=${String(env)}`).toBe(__DEV__);
    }
  });
});

// ---------------------------------------------------------------------------

const configs = rawConfig as Options[];

/**
 * Run the real tsup config that emits the deprecated entries, narrowed to
 * them, into a private temp dir, and return each entry's ESM output. The same
 * narrowing as build-artifacts.test.ts's `buildEntry`; one build for all
 * three keeps the suite's CPU down, and keeps the config's code splitting, so
 * a module two entries kept would show up as an import of a shared chunk.
 */
async function buildEntries(overrides: Options = {}): Promise<Record<string, string>> {
  const names = ENTRIES.map((e) => e.tsupEntry);
  const base = configs.find((c) => names.every((n) => Object.keys(c.entry as Record<string, string>).includes(n)));
  if (!base) throw new Error(`no tsup config emits ${names.join(', ')}`);
  const entry = Object.fromEntries(names.map((n) => [n, (base.entry as Record<string, string>)[n]]));
  const outDir = mkdtempSync(join(tmpdir(), 'forma-deprecated-'));
  try {
    await build({
      ...base,
      config: false,
      entry,
      format: ['esm'],
      dts: false,
      sourcemap: false,
      silent: true,
      outDir,
      ...overrides,
    });
    return Object.fromEntries(names.map((n) => [n, readFileSync(join(outDir, `${n}.js`), 'utf8')]));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe('the deprecated entries in a production build (the real tsup config)', () => {
  it('a production build of each deprecated entry carries no warning', { timeout: 120_000 }, async () => {
    const built = await buildEntries();
    for (const entry of ENTRIES) {
      const code = built[entry.tsupEntry]!;
      expect(code, entry.subpath).not.toContain('FORMA_W_DEPRECATED');
      expect(code, entry.subpath).not.toContain('warnDeprecated');
      expect(code, entry.subpath).not.toContain('sourceIsDev');
      // The raw-source fallback's opt-in global: what verify-dist checks for.
      expect(code, entry.subpath).not.toContain(RAW_SOURCE_DEV_GLOBAL);
      // The entry's own code is there: the build did not drop everything.
      expect(code, entry.subpath).toMatch(/\bexport\s*\{/);
    }
    // The wasm entry loads nothing of core's. Importing dev.ts for `__DEV__`
    // would bring its duplicate-instance registration with it: an import of
    // core's reactive chunk in dist/wasm.js.
    expect(parseImportSpecifiers(built.wasm!)).toEqual([]);
    expect(built.wasm).not.toContain('Duplicate @getforma/core instance');
  });

  it('a build without the production flag keeps the warning', { timeout: 120_000 }, async () => {
    // The control for the test above: the same config with nothing replacing
    // `__FORMA_DEV_BUILD__` is a build of the source's own behaviour.
    const built = await buildEntries({ define: {} });
    for (const entry of ENTRIES) {
      const code = built[entry.tsupEntry]!;
      expect(code, entry.subpath).toContain(entry.code);
      expect(code, entry.subpath).toContain('sourceIsDev');
    }
  });
});
