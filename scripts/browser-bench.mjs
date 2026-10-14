import { transformAsync } from "@babel/core";
import { chromium, firefox, webkit } from "@playwright/test";
import reactCompiler from "babel-plugin-react-compiler";
import { build } from "esbuild";
import { createServer } from "node:http";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = path.join(root, "bench", "browser");
const resultJsonPath = path.join(root, "docs", "browser-framework-results.json");
const resultMarkdownPath = path.join(root, "docs", "browser-framework-results.md");
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "forma-browser-bench-"));

const options = parseArguments(process.argv.slice(2));
let server;
const activeBrowsers = [];

try {
  const buildResult = await buildFixtures(temporaryDirectory);
  const broker = createBrokerState();
  const started = await startServer(buildResult.assets, broker);
  server = started.server;
  const browserTypes = { chromium, firefox, webkit };
  const browserReports = {};
  for (const browserName of options.browserNames) {
    const browser = await browserTypes[browserName].launch({ headless: true });
    activeBrowsers.push(browser);
    browserReports[browserName] = await runBrowserBenchmark({
      browser,
      browserName,
      origin: started.origin,
      broker,
      options,
    });
    await browser.close();
    activeBrowsers.splice(activeBrowsers.indexOf(browser), 1);
  }

  const report = {
    schema_version: 2,
    recorded_at: new Date().toISOString(),
    methodology: {
      browsers: options.browserNames,
      production_builds: true,
      cross_origin_isolated: true,
      react_compiler_verified: buildResult.compilerVerified,
      runs: options.runs,
      warmups: options.warmups,
      mount_counts: options.mountCounts,
      update_count: options.updateCount,
      list_count: options.listCount,
      server_state_count: options.serverStateCount,
      notes: [
        "Every framework runs in its own warmed browser page without CPU-sharing workers.",
        "script_ms ends when synchronous DOM work or asynchronous server-state settlement completes.",
        "settled_ms includes two requestAnimationFrame boundaries.",
        "React state mutations use flushSync so the measured interval includes commit work.",
        "Server-state provider executions are broker simulations; browser request counts are real HTTP ingress.",
      ],
    },
    environment: environmentMetadata(),
    versions: dependencyVersions(),
    bundles: buildResult.bundles,
    browsers: browserReports,
  };

  process.stdout.write(`${renderConsoleSummary(report)}\n`);
  if (options.writeResults) {
    await writeFile(resultJsonPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resultMarkdownPath, renderMarkdown(report));
    process.stdout.write(`Wrote ${path.relative(root, resultJsonPath)}\n`);
    process.stdout.write(`Wrote ${path.relative(root, resultMarkdownPath)}\n`);
  } else {
    process.stdout.write("Quick wiring checks do not overwrite recorded evidence.\n");
  }
} finally {
  await Promise.all(activeBrowsers.map((browser) => browser.close()));
  await new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function parseArguments(arguments_) {
  const quick = arguments_.includes("--quick");
  const valueAfter = (name, fallback) => {
    const index = arguments_.indexOf(name);
    if (index < 0) return fallback;
    const parsed = Number.parseInt(arguments_[index + 1] ?? "", 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new Error(`${name} must be an integer between 1 and 100`);
    }
    return parsed;
  };
  const requestedBrowser = (() => {
    const index = arguments_.indexOf("--browser");
    return index < 0 ? null : arguments_[index + 1];
  })();
  const allowedBrowsers = ["chromium", "firefox", "webkit"];
  if (requestedBrowser && requestedBrowser !== "all" && !allowedBrowsers.includes(requestedBrowser)) {
    throw new Error("--browser must be chromium, firefox, webkit, or all");
  }
  return {
    runs: valueAfter("--runs", quick ? 3 : 12),
    warmups: valueAfter("--warmups", quick ? 1 : 3),
    mountCounts: quick ? [1, 50] : [1, 50, 100, 500],
    updateCount: quick ? 100 : 500,
    listCount: quick ? 100 : 1_000,
    serverStateCount: 50,
    writeResults: !quick,
    browserNames: requestedBrowser && requestedBrowser !== "all"
      ? [requestedBrowser]
      : quick && !requestedBrowser
        ? ["chromium"]
        : allowedBrowsers,
  };
}

async function buildFixtures(outputDirectory) {
  const definitions = {
    "forma.js": { entry: "forma.fixture.jsx", react: false },
    "forma-query.js": { entry: "forma-query.fixture.jsx", react: false },
    "react.js": { entry: "react.fixture.jsx", react: true },
    "react-query.js": { entry: "react-query.fixture.jsx", react: true },
  };
  const assets = new Map();
  let compilerVerified = true;

  for (const [outputName, definition] of Object.entries(definitions)) {
    const inputPath = path.join(fixtureDirectory, definition.entry);
    const outputPath = path.join(outputDirectory, outputName);
    let contents = await readFile(inputPath, "utf8");
    if (definition.react) {
      const transformed = await transformAsync(contents, {
        filename: inputPath,
        babelrc: false,
        configFile: false,
        sourceType: "module",
        parserOpts: { plugins: ["jsx"] },
        plugins: [reactCompiler],
      });
      if (!transformed?.code) throw new Error(`React Compiler emitted no code for ${inputPath}`);
      contents = transformed.code;
      const verified = contents.includes("react/compiler-runtime") ||
        contents.includes("react.memo_cache_sentinel");
      compilerVerified &&= verified;
      if (!verified) {
        throw new Error(`React Compiler did not transform ${definition.entry}`);
      }
    }
    await build({
      stdin: {
        contents,
        loader: "jsx",
        resolveDir: fixtureDirectory,
        sourcefile: inputPath,
      },
      outfile: outputPath,
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      target: ["es2022"],
      define: {
        "process.env.NODE_ENV": JSON.stringify("production"),
        __FORMA_DEV_BUILD__: "false",
      },
      logLevel: "silent",
    });
    assets.set(outputName, await readFile(outputPath));
  }

  const bundles = {};
  for (const [name, bytes] of assets) {
    bundles[name] = {
      raw_bytes: bytes.byteLength,
      gzip_bytes: gzipSync(bytes, { level: 9 }).byteLength,
      brotli_bytes: brotliCompressSync(bytes).byteLength,
    };
  }
  return { assets, bundles, compilerVerified };
}

function createBrokerState() {
  return {
    ingress: 0,
    providerExecutions: 0,
    cache: null,
    inflight: null,
    reset() {
      this.ingress = 0;
      this.providerExecutions = 0;
      this.cache = null;
      this.inflight = null;
    },
    snapshot() {
      return {
        browser_requests: this.ingress,
        provider_executions: this.providerExecutions,
      };
    },
  };
}

async function brokerWeather(broker) {
  broker.ingress += 1;
  if (broker.cache) return broker.cache;
  if (!broker.inflight) {
    broker.providerExecutions += 1;
    broker.inflight = new Promise((resolve) => {
      setTimeout(() => resolve({ temperature: "72°F", location: "New York" }), 20);
    }).then((payload) => {
      broker.cache = payload;
      broker.inflight = null;
      return payload;
    });
  }
  return broker.inflight;
}

async function startServer(assets, broker) {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
*{box-sizing:border-box}html,body{margin:0}#app{contain:layout style}.bench-card,.bench-row{display:block;border:1px solid #333;padding:4px}.bench-card h2{display:inline;margin:0 8px 0 0;font:12px sans-serif}.bench-static,.bench-value{font:12px monospace}.bench-row{height:24px}
</style></head><body><div id="app"></div><script type="module" src="/assets/__BUNDLE__"></script></body></html>`;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/api/broker/weather") {
        const payload = await brokerWeather(broker);
        sendJson(response, 200, payload);
        return;
      }
      if (url.pathname === "/__bench/stats") {
        sendJson(response, 200, broker.snapshot());
        return;
      }
      if (url.pathname.startsWith("/assets/")) {
        const name = path.basename(url.pathname);
        const asset = assets.get(name);
        if (!asset) {
          response.writeHead(404).end("not found");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "text/javascript; charset=utf-8",
          "Cache-Control": "no-store",
        });
        response.end(asset);
        return;
      }
      const bundle = url.searchParams.get("bundle");
      if (!bundle || !assets.has(bundle)) {
        response.writeHead(400).end("missing bundle");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp",
      });
      response.end(html.replace("__BUNDLE__", bundle));
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("benchmark server did not bind");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(value));
}

async function runBrowserBenchmark({ browser, browserName, origin, broker, options }) {
  const formaPage = await openFixture(browser, origin, "forma.js");
  const reactPage = await openFixture(browser, origin, "react.js");
  const formaQueryPage = await openFixture(browser, origin, "forma-query.js");
  const queryPage = await openFixture(browser, origin, "react-query.js");
  try {
    const runtime = { forma: {}, react_compiler: {} };
    for (const [framework, page] of [["forma", formaPage], ["react_compiler", reactPage]]) {
      for (const count of options.mountCounts) {
        runtime[framework][`mount_${count}`] = await sampleOperation({
          page,
          operation: "mountWidgets",
          argumentsForRun: () => [count],
          resetBeforeEach: true,
          ...options,
        });
      }
      await resetPage(page);
      await page.evaluate((count) => globalThis.__frameworkBench.mountWidgets(count), options.updateCount);
      runtime[framework][`update_one_of_${options.updateCount}`] = await sampleOperation({
        page,
        operation: "updateOneMany",
        argumentsForRun: (run) => [Math.floor(options.updateCount / 2), (run + 1) * 10_000, 5_000],
        normalizeBy: 5_000,
        ...options,
      });
      runtime[framework][`update_all_${options.updateCount}`] = await sampleOperation({
        page,
        operation: "updateAllMany",
        argumentsForRun: (run) => [(run + 1) * 1_000_000, 20],
        normalizeBy: 20,
        ...options,
      });
      await resetPage(page);
      await page.evaluate((count) => globalThis.__frameworkBench.mountList(count), options.listCount);
      runtime[framework][`reverse_${options.listCount}`] = await sampleOperation({
        page,
        operation: "reverseListMany",
        argumentsForRun: () => [10],
        normalizeBy: 10,
        ...options,
      });
      if (browserName === "chromium") {
        runtime[framework][`memory_${options.updateCount}`] = await measureMemory(
          page,
          options.updateCount,
        );
      }
    }

    const serverState = {};
    serverState.forma_isolated = await sampleServerState({
      page: formaQueryPage,
      broker,
      count: options.serverStateCount,
      mode: "isolated",
      ...options,
    });
    serverState.forma_shared = await sampleServerState({
      page: formaQueryPage,
      broker,
      count: options.serverStateCount,
      mode: "shared",
      ...options,
    });
    serverState.react_query = await sampleServerState({
      page: queryPage,
      broker,
      count: options.serverStateCount,
      mode: null,
      ...options,
    });

    return {
      version: await browser.version(),
      runtime,
      server_state: serverState,
    };
  } finally {
    await Promise.all([
      formaPage.close(),
      reactPage.close(),
      formaQueryPage.close(),
      queryPage.close(),
    ]);
  }
}

async function openFixture(browser, origin, bundle) {
  const page = await browser.newPage();
  await page.goto(`${origin}/?bundle=${encodeURIComponent(bundle)}`, { waitUntil: "load" });
  await page.waitForFunction(() => Boolean(globalThis.__frameworkBench));
  if (!await page.evaluate(() => globalThis.crossOriginIsolated)) {
    throw new Error("benchmark fixture is not cross-origin isolated; high-resolution timing is unavailable");
  }
  return page;
}

async function resetPage(page) {
  await page.evaluate(async () => {
    globalThis.__frameworkBench.reset();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function sampleOperation({
  page,
  operation,
  argumentsForRun,
  runs,
  warmups,
  resetBeforeEach = false,
  normalizeBy = 1,
}) {
  const samples = [];
  for (let run = -warmups; run < runs; run += 1) {
    if (resetBeforeEach) await resetPage(page);
    const sample = await measureOperation(page, operation, argumentsForRun(run + warmups));
    if (normalizeBy > 1) normalizeRepeatedSample(sample, normalizeBy);
    if (run >= 0) samples.push(sample);
  }
  return summarizeSamples(samples);
}

function normalizeRepeatedSample(sample, repetitions) {
  sample.script_ms /= repetitions;
  sample.mutations.attributes /= repetitions;
  sample.mutations.character_data /= repetitions;
  sample.mutations.added_nodes /= repetitions;
  sample.mutations.removed_nodes /= repetitions;
  sample.repetitions = repetitions;
}

async function measureOperation(page, operation, args) {
  return page.evaluate(async ({ operation, args }) => {
    const target = document.querySelector("#app");
    const records = [];
    const observer = new MutationObserver((next) => records.push(...next));
    observer.observe(target, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const start = performance.now();
    const result = globalThis.__frameworkBench[operation](...args);
    if (result && typeof result.then === "function") await result;
    const scriptEnd = performance.now();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const settledEnd = performance.now();
    observer.disconnect();
    const mutationCounts = { attributes: 0, character_data: 0, added_nodes: 0, removed_nodes: 0 };
    for (const record of records) {
      if (record.type === "attributes") mutationCounts.attributes += 1;
      if (record.type === "characterData") mutationCounts.character_data += 1;
      if (record.type === "childList") {
        mutationCounts.added_nodes += record.addedNodes.length;
        mutationCounts.removed_nodes += record.removedNodes.length;
      }
    }
    return {
      script_ms: scriptEnd - start,
      settled_ms: settledEnd - start,
      mutations: mutationCounts,
      dom_nodes: target.querySelectorAll("*").length,
    };
  }, { operation, args });
}

async function sampleServerState({ page, broker, count, mode, runs, warmups }) {
  const samples = [];
  for (let run = -warmups; run < runs; run += 1) {
    broker.reset();
    await resetPage(page);
    const args = mode === null
      ? [count, "/api/broker/weather"]
      : [count, "/api/broker/weather", mode];
    const sample = await measureOperation(page, "mountServerState", args);
    Object.assign(sample, broker.snapshot());
    if (run >= 0) samples.push(sample);
  }
  return summarizeSamples(samples, ["browser_requests", "provider_executions"]);
}

async function measureMemory(page, count) {
  await resetPage(page);
  const session = await page.context().newCDPSession(page);
  await session.send("HeapProfiler.collectGarbage");
  const baseline = await session.send("Runtime.getHeapUsage");
  await page.evaluate((value) => globalThis.__frameworkBench.mountWidgets(value), count);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await session.send("HeapProfiler.collectGarbage");
  const mounted = await session.send("Runtime.getHeapUsage");
  await session.detach();
  return {
    baseline_used_bytes: baseline.usedSize,
    mounted_used_bytes: mounted.usedSize,
    retained_delta_bytes: Math.max(0, mounted.usedSize - baseline.usedSize),
    dom_nodes: await page.locator("#app *").count(),
  };
}

function summarizeSamples(samples, scalarFields = []) {
  const metric = (selector) => summarizeNumbers(samples.map(selector));
  const result = {
    script_ms: metric((sample) => sample.script_ms),
    settled_ms: metric((sample) => sample.settled_ms),
    mutations: {
      attributes: metric((sample) => sample.mutations.attributes),
      character_data: metric((sample) => sample.mutations.character_data),
      added_nodes: metric((sample) => sample.mutations.added_nodes),
      removed_nodes: metric((sample) => sample.mutations.removed_nodes),
    },
    dom_nodes: metric((sample) => sample.dom_nodes),
    samples,
  };
  for (const field of scalarFields) result[field] = metric((sample) => sample[field]);
  return result;
}

function summarizeNumbers(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  const median = percentile(sorted, 0.5);
  const minimum = sorted[0] ?? 0;
  const maximum = sorted.at(-1) ?? 0;
  return {
    median,
    p95: percentile(sorted, 0.95),
    min: minimum,
    max: maximum,
    spread_percent: minimum === 0 ? 0 : ((maximum - minimum) / minimum) * 100,
  };
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function environmentMetadata() {
  const git = (arguments_) => {
    try {
      return execFileSync("git", arguments_, { cwd: root, encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  };
  return {
    node: process.version,
    platform: process.platform,
    release: os.release(),
    architecture: process.arch,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logical_cpus: os.cpus().length,
    memory_bytes: os.totalmem(),
    git_commit: git(["rev-parse", "HEAD"]),
    git_branch: git(["branch", "--show-current"]),
    git_dirty: git(["status", "--porcelain"]).length > 0,
  };
}

function dependencyVersions() {
  const ownPackage = JSON.parse(execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(require('./package.json').version))"], { cwd: root, encoding: "utf8" }));
  return {
    forma: ownPackage,
    react: readPackageVersion("react"),
    react_dom: readPackageVersion("react-dom"),
    tanstack_query: readPackageVersion("@tanstack/react-query"),
    react_compiler: readPackageVersion("babel-plugin-react-compiler"),
  };
}

function readPackageVersion(name) {
  const packageJson = execFileSync(
    process.execPath,
    ["-e", `process.stdout.write(JSON.stringify(require(${JSON.stringify(`${name}/package.json`)}).version))`],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(packageJson);
}

function renderMarkdown(report) {
  const memoryKey = `memory_${report.methodology.update_count}`;
  const runtimeSections = Object.entries(report.browsers).map(([browserName, browserReport]) => {
    const forma = browserReport.runtime.forma;
    const react = browserReport.runtime.react_compiler;
    const rows = Object.keys(forma).filter((key) => key !== memoryKey);
    const runtimeRows = rows.map((key) => {
      const left = forma[key];
      const right = react[key];
      const ratio = right.script_ms.median / Math.max(left.script_ms.median, Number.EPSILON);
      return `| ${labelForScenario(key)} | ${formatMs(left.script_ms.median)} / ${formatMs(left.script_ms.p95)} | ${formatMs(right.script_ms.median)} / ${formatMs(right.script_ms.p95)} | ${ratio.toFixed(2)}× |`;
    }).join("\n");
    return `### ${formatBrowserName(browserName)} ${browserReport.version}

| Scenario | Forma median / p95 | React Compiler median / p95 | React ÷ Forma |
|---|---:|---:|---:|
${runtimeRows}`;
  }).join("\n\n");
  const stateRows = Object.entries(report.browsers).flatMap(([browserName, browserReport]) =>
    Object.entries(browserReport.server_state).map(([name, value]) =>
      `| ${formatBrowserName(browserName)} | ${name.replaceAll("_", " ")} | ${formatMs(value.script_ms.median)} | ${formatNumber(value.browser_requests.median)} | ${formatNumber(value.provider_executions.median)} |`
    )
  ).join("\n");
  const chromium = report.browsers.chromium;
  const memorySection = chromium?.runtime.forma[memoryKey]
    ? renderMemorySection(chromium, memoryKey, report.methodology.update_count)
    : "";
  const browserVersions = Object.entries(report.browsers)
    .map(([name, value]) => `${formatBrowserName(name)} ${value.version}`)
    .join("; ");
  return `# Browser framework comparison

Recorded ${report.recorded_at} from commit \`${report.environment.git_commit.slice(0, 12)}\`${report.environment.git_dirty ? " with uncommitted benchmark changes" : ""}.

## Scope

This is local developer benchmark infrastructure. It is not application code, a production endpoint, or content shipped in the FormaJS package.

Production FormaJS ${report.versions.forma} is compared with React ${report.versions.react} and the stable React Compiler ${report.versions.react_compiler}. React Compiler output was verified before the run. TanStack Query ${report.versions.tanstack_query} appears only in the server-state lane.

These results describe this machine and the recorded browser builds, not a universal framework ranking. A ratio above 1.00 means React took longer in this capture. Believe a difference only when it is larger than the recorded sample spread in the adjacent JSON.

## Runtime work

${runtimeSections}

The update cases use identical visible DOM. React updates are wrapped in \`flushSync\`, so the measured interval contains render and commit instead of timing only the state enqueue. Forma uses a signal write, with \`batch()\` for the broad update. This is a synchronous committed-update lane; it does not measure React transitions or concurrent batching.

${memorySection}

## Server-state fan-out (${report.methodology.server_state_count} consumers)

| Browser | Mode | Settle median | Browser requests | Provider executions |
|---|---|---:|---:|---:|
${stateRows}

- **Forma isolated** models one resource per widget, like independent declarative \`data-fetch\` hosts. The simulated broker coalesces provider work, but browser ingress remains per widget.
- **Forma shared** hoists one Forma resource and lets every widget observe it.
- **React Query** lets every component declare the same query key; Query shares the browser request automatically.

This lane intentionally reports both browser requests and provider executions. Crediting the server broker's coalescing to the FormaJS renderer would be misleading.

## Production bundle payload

| Fixture | Raw | gzip | Brotli |
|---|---:|---:|---:|
${Object.entries(report.bundles).map(([name, value]) => `| ${name} | ${formatBytes(value.raw_bytes)} | ${formatBytes(value.gzip_bytes)} | ${formatBytes(value.brotli_bytes)} |`).join("\n")}

The server-state payload is kept out of both ordinary runtime fixtures. Forma imports its public package entry; production tree shaking applies to both sides.

## Method

- ${report.methodology.runs} recorded samples after ${report.methodology.warmups} warmups.
- ${browserVersions}; ${report.environment.platform} ${report.environment.architecture}; ${report.environment.cpu}.
- Each runtime owns a separate warmed page. No benchmark workers share a CPU.
- Every fixture is cross-origin isolated so its browser exposes high-resolution timers.
- \`script_ms\` includes synchronous update work; server-state operations include async settlement.
- \`settled_ms\` in the JSON additionally includes two animation-frame boundaries.
- Repeated update and reorder lanes normalize \`script_ms\` and mutation counts per operation; \`settled_ms\` describes the whole repeated batch.
- Mutation counts, raw samples, p95, min/max, and run-to-run spread remain in [browser-framework-results.json](browser-framework-results.json).

## Boundaries still required before a public universal claim

1. Repeat the matrix on representative Windows, Linux, Intel Mac, and lower-power hardware. Playwright WebKit is a WebKit engine build, not a claim about a particular Safari release.
2. Add equivalent SSR hydration and streaming fixtures.
3. Add high-frequency telemetry, nested context, forms, and error-boundary cases.
4. Run an established third-party framework benchmark in addition to the product-shaped fixtures.
5. Keep React, React Compiler, TanStack Query, and Forma versions pinned in every published capture.
`;
}

function renderConsoleSummary(report) {
  const [browserName, browserReport] = report.browsers.chromium
    ? ["chromium", report.browsers.chromium]
    : Object.entries(report.browsers)[0];
  const update = `update_one_of_${report.methodology.update_count}`;
  const forma = browserReport.runtime.forma[update].script_ms.median;
  const react = browserReport.runtime.react_compiler[update].script_ms.median;
  return [
    "Browser framework comparison complete.",
    `${formatBrowserName(browserName)} single update among ${report.methodology.update_count}: Forma ${formatMs(forma)}, React Compiler ${formatMs(react)}.`,
    `Server fan-out: Forma isolated ${formatNumber(browserReport.server_state.forma_isolated.browser_requests.median)} browser requests, Forma shared ${formatNumber(browserReport.server_state.forma_shared.browser_requests.median)}, React Query ${formatNumber(browserReport.server_state.react_query.browser_requests.median)}.`,
  ].join("\n");
}

function renderMemorySection(browserReport, memoryKey, updateCount) {
  const formaMemory = browserReport.runtime.forma[memoryKey];
  const reactMemory = browserReport.runtime.react_compiler[memoryKey];
  return `## Chromium retained heap after ${updateCount} widgets

| Runtime | Retained delta | DOM nodes |
|---|---:|---:|
| Forma | ${formatBytes(formaMemory.retained_delta_bytes)} | ${formatNumber(formaMemory.dom_nodes)} |
| React Compiler | ${formatBytes(reactMemory.retained_delta_bytes)} | ${formatNumber(reactMemory.dom_nodes)} |

Chromium garbage collection is requested before both heap readings. The delta includes each runtime's live state graph for the mounted fixture.`;
}

function formatBrowserName(value) {
  if (value === "webkit") return "WebKit";
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function labelForScenario(value) {
  if (value.startsWith("mount_")) return `Mount ${value.slice(6)} widgets`;
  if (value.startsWith("update_one_of_")) return `Committed update 1 of ${value.slice(14)} widgets`;
  if (value.startsWith("update_all_")) return `Committed update all ${value.slice(11)} widgets`;
  if (value.startsWith("reverse_")) return `Reverse ${value.slice(8)} keyed rows`;
  return value;
}

function formatMs(value) {
  if (value < 0.01) return `${(value * 1_000).toFixed(2)} µs`;
  return `${value < 1 ? value.toFixed(3) : value.toFixed(2)} ms`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatBytes(value) {
  if (value < 1_024) return `${value} B`;
  return `${(value / 1_024).toFixed(1)} KiB`;
}
