/**
 * Packaging-surface contract tests.
 *
 * These read package.json / the CI workflow / installed devDependency metadata
 * and assert the properties the 2026-08 hardening audit found broken. They need
 * no build, so they run on a fresh checkout; the artifact-level counterparts
 * live in scripts/verify-dist.mjs, which `npm run build` enforces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

/** Subpath keys of `exports`, excluding the root and the package.json escape. */
function subpathKeys(): string[] {
  return Object.keys(pkg.exports).filter((k) => k !== '.' && k !== './package.json');
}

describe('exports map', () => {
  it('exposes ./package.json so scaffolders and bundler probes can read it', () => {
    // ERR_PACKAGE_PATH_NOT_EXPORTED otherwise — hit by Vite plugin detection
    // and by `require('@getforma/core/package.json')` in create-forma-app.
    expect(pkg.exports['./package.json']).toBe('./package.json');
  });

  it('gives every import/require condition a types entry', () => {
    for (const key of subpathKeys()) {
      const entry = pkg.exports[key];
      for (const condition of ['import', 'require'] as const) {
        expect(entry[condition], `${key}.${condition}`).toBeDefined();
        expect(entry[condition].types, `${key}.${condition}.types`).toMatch(/^\.\/dist\/.+\.d\.[cm]?ts$/);
      }
    }
  });

  it('resolves every require condition to a .cjs file', () => {
    // Under "type": "module" a .js file is ESM; requiring it fails in Node and
    // several bundlers. attw reports this as CJSResolvesToESM.
    for (const key of subpathKeys()) {
      expect(pkg.exports[key].require.default, key).toMatch(/\.cjs$/);
    }
  });

  it('gives every subpath a typesVersions fallback so node10 resolution works', () => {
    // TypeScript's `node`/`node10` moduleResolution ignores `exports`; without
    // this map every subpath reported "Resolution failed" under attw.
    const map = pkg.typesVersions['*'];
    for (const key of subpathKeys()) {
      const bare = key.replace(/^\.\//, '');
      expect(map[bare], `typesVersions["*"]["${bare}"]`).toBeDefined();
      expect(map[bare][0]).toMatch(/^dist\/.+\.d\.ts$/);
    }
  });

  it('does not route the classic-script CDN bundles through the module resolver', () => {
    // The IIFE bundles declare `var FormaRuntime = …`, which is module-scoped
    // under both ESM and CJS: importing one runs the runtime without ever
    // defining the global it exists to define. They are URL-only artifacts.
    for (const key of Object.keys(pkg.exports)) {
      expect(JSON.stringify(pkg.exports[key])).not.toMatch(/global\.js/);
    }
  });
});

describe('repository metadata', () => {
  it('uses a full git URL so npm records provenance correctly', () => {
    expect(pkg.repository.url).toMatch(/^git\+https:\/\//);
  });
});

// ---------------------------------------------------------------------------
// Node version floors
// ---------------------------------------------------------------------------

/** Lowest version a `>=`/`^`/`~`/bare range accepts, as [major, minor, patch]. */
export function rangeFloor(range: string): [number, number, number] {
  const disjuncts = range.split('||').map((s) => s.trim());
  const floors = disjuncts.map((d) => {
    const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(d);
    if (!m) return [0, 0, 0] as [number, number, number];
    return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] as [number, number, number];
  });
  return floors.reduce((lo, f) => (compare(f, lo) < 0 ? f : lo));
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

describe('engines', () => {
  it('rangeFloor takes the lowest disjunct of a multi-branch range', () => {
    expect(rangeFloor('^20.19.0 || >=22.12.0')).toEqual([20, 19, 0]);
    expect(rangeFloor('>=18')).toEqual([18, 0, 0]);
    expect(rangeFloor('>=20.19.0')).toEqual([20, 19, 0]);
  });

  it('the engines floor is a version CI actually runs', () => {
    // engines said >=18 while the matrix was 20/22/24 and the dev toolchain
    // could not even install on 18 — an untested promise. The floor's major
    // must be the lowest major the matrix executes.
    const ci = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const matrix = /node-version:\s*\[([^\]]+)\]/.exec(ci);
    expect(matrix, 'node-version matrix in ci.yml').not.toBeNull();
    const majors = matrix![1].split(',').map((s) => Number(s.trim()));
    expect(rangeFloor(pkg.engines.node)[0]).toBe(Math.min(...majors));
  });

  it('declares a dev floor no installed devDependency undercuts', () => {
    // `npm ci` EBADENGINE-warns when the dev toolchain needs more than the repo
    // declares. devEngines records the real floor instead of leaving
    // contributors to discover it from warnings.
    const declared = rangeFloor(pkg.devEngines.runtime.version);
    expect(pkg.devEngines.runtime.name).toBe('node');

    let strictest: [number, number, number] = [0, 0, 0];
    let strictestDep = '(none)';
    for (const dep of Object.keys(pkg.devDependencies)) {
      const manifest = resolve(ROOT, 'node_modules', dep, 'package.json');
      if (!existsSync(manifest)) continue;
      const range = JSON.parse(readFileSync(manifest, 'utf8')).engines?.node;
      if (!range) continue;
      const floor = rangeFloor(range);
      if (compare(floor, strictest) > 0) {
        strictest = floor;
        strictestDep = `${dep} (${range})`;
      }
    }
    expect(
      compare(declared, strictest),
      `devEngines floor ${pkg.devEngines.runtime.version} is below ${strictestDep}`
    ).toBeGreaterThanOrEqual(0);
  });
});
