import React, { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const container = document.querySelector("#app");
let root = null;
let widgetSetters = new Map();
let setRows = null;

function reset() {
  if (root) {
    flushSync(() => root.unmount());
    root = null;
  }
  widgetSetters = new Map();
  setRows = null;
  container.replaceChildren();
}

function Card({ id }) {
  const [value, setValue] = useState(0);
  useLayoutEffect(() => {
    widgetSetters.set(id, setValue);
    return () => {
      widgetSetters.delete(id);
    };
  }, [id]);
  return (
    <article className="bench-card" data-id={id}>
      <h2>Widget {id}</h2>
      <output className="bench-value">{value}</output>
      <span className="bench-static">stable</span>
    </article>
  );
}

function WidgetApp({ count }) {
  return (
    <main id="bench-grid">
      {Array.from({ length: count }, (_, id) => <Card key={id} id={id} />)}
    </main>
  );
}

function mountWidgets(count) {
  reset();
  root = createRoot(container);
  flushSync(() => root.render(<WidgetApp count={count} />));
}

function updateOne(index, value) {
  flushSync(() => widgetSetters.get(index)?.(value));
}

function updateAll(value) {
  flushSync(() => {
    for (const setValue of widgetSetters.values()) setValue(value);
  });
}

function updateOneMany(index, startValue, repetitions) {
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    updateOne(index, startValue + iteration);
  }
}

function updateAllMany(startValue, repetitions) {
  for (let iteration = 0; iteration < repetitions; iteration += 1) {
    updateAll(startValue + iteration);
  }
}

function ListApp({ count }) {
  const [rows, updateRows] = useState(() =>
    Array.from({ length: count }, (_, id) => ({ id, label: `Row ${id}` }))
  );
  useLayoutEffect(() => {
    setRows = updateRows;
    return () => {
      setRows = null;
    };
  }, [updateRows]);
  return (
    <main id="bench-list">
      {rows.map((row) => (
        <article className="bench-row" data-id={row.id} key={row.id}>
          <span>{row.label}</span>
        </article>
      ))}
    </main>
  );
}

function mountList(count) {
  reset();
  root = createRoot(container);
  flushSync(() => root.render(<ListApp count={count} />));
}

function reverseList() {
  flushSync(() => setRows?.((current) => current.slice().reverse()));
}

function reverseListMany(repetitions) {
  for (let iteration = 0; iteration < repetitions; iteration += 1) reverseList();
}

globalThis.__frameworkBench = {
  name: "react-compiler",
  mountWidgets,
  updateOne,
  updateAll,
  updateOneMany,
  updateAllMany,
  mountList,
  reverseList,
  reverseListMany,
  reset,
};
