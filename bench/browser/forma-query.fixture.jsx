import { createResource, h, mount } from "../../dist/index.js";

const container = document.querySelector("#app");
let dispose = () => {};

function reset() {
  dispose();
  dispose = () => {};
  container.replaceChildren();
}

function weatherResource(endpoint) {
  return createResource(
    () => true,
    (_source, { signal }) => fetch(endpoint, { signal }).then((response) => {
      if (!response.ok) throw new Error(`weather request failed: ${response.status}`);
      return response.json();
    }),
  );
}

function dataCard(id, resource) {
  return h(
    "article",
    { class: "bench-card data-card", "data-id": String(id) },
    h("h2", null, `Weather ${id}`),
    h(
      "output",
      {
        class: "bench-value",
        "data-ready": () => String(!resource.loading() && resource() !== undefined),
      },
      () => resource()?.temperature ?? "loading",
    ),
  );
}

function mountServerState(count, endpoint, mode) {
  reset();
  dispose = mount(() => {
    const shared = mode === "shared" ? weatherResource(endpoint) : null;
    const cards = Array.from({ length: count }, (_, id) =>
      dataCard(id, shared ?? weatherResource(endpoint))
    );
    return h("main", { id: "bench-grid" }, ...cards);
  }, container);
  return waitUntilReady(count);
}

function waitUntilReady(count) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + 5_000;
    const check = () => {
      const ready = container.querySelectorAll('[data-ready="true"]').length;
      if (ready === count) {
        resolve();
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(`only ${ready}/${count} Forma resources settled`));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

globalThis.__frameworkBench = {
  name: "forma-server-state",
  mountServerState,
  reset,
};
