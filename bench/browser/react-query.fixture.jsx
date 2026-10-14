import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

const container = document.querySelector("#app");
let root = null;

function reset() {
  if (root) {
    flushSync(() => root.unmount());
    root = null;
  }
  container.replaceChildren();
}

function DataCard({ id, endpoint }) {
  const query = useQuery({
    queryKey: ["browser-benchmark", "weather"],
    queryFn: ({ signal }) => fetch(endpoint, { signal }).then((response) => {
      if (!response.ok) throw new Error(`weather request failed: ${response.status}`);
      return response.json();
    }),
    retry: false,
    staleTime: 60_000,
  });
  return (
    <article className="bench-card data-card" data-id={id}>
      <h2>Weather {id}</h2>
      <output className="bench-value" data-ready={query.isSuccess}>
        {query.data?.temperature ?? "loading"}
      </output>
    </article>
  );
}

function QueryApp({ count, endpoint, client }) {
  return (
    <QueryClientProvider client={client}>
      <main id="bench-grid">
        {Array.from({ length: count }, (_, id) => (
          <DataCard id={id} endpoint={endpoint} key={id} />
        ))}
      </main>
    </QueryClientProvider>
  );
}

function mountServerState(count, endpoint) {
  reset();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  root = createRoot(container);
  flushSync(() => root.render(<QueryApp count={count} endpoint={endpoint} client={client} />));
  return waitUntilReady(count);
}

function waitUntilReady(count) {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + 5_000;
    const check = () => {
      if (container.querySelectorAll('[data-ready="true"]').length === count) {
        resolve();
        return;
      }
      if (performance.now() >= deadline) {
        reject(new Error(`only ${container.querySelectorAll('[data-ready="true"]').length}/${count} React Query observers settled`));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

globalThis.__frameworkBench = {
  name: "react-compiler-tanstack-query",
  mountServerState,
  reset,
};
