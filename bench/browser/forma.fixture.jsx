import {
  batch,
  createList,
  createSignal,
  h,
  mount,
} from "../../dist/index.js";

const container = document.querySelector("#app");
let dispose = () => {};
let widgetSetters = [];
let setRows = null;

function reset() {
  dispose();
  dispose = () => {};
  widgetSetters = [];
  setRows = null;
  container.replaceChildren();
}

function card(id, value) {
  return h(
    "article",
    { class: "bench-card", "data-id": String(id) },
    h("h2", null, `Widget ${id}`),
    h("output", { class: "bench-value" }, () => String(value())),
    h("span", { class: "bench-static" }, "stable"),
  );
}

function mountWidgets(count) {
  reset();
  const signals = Array.from({ length: count }, (_, index) => {
    const [value, setValue] = createSignal(0);
    widgetSetters[index] = setValue;
    return value;
  });
  dispose = mount(
    () => h("main", { id: "bench-grid" }, ...signals.map((value, id) => card(id, value))),
    container,
  );
}

function updateOne(index, value) {
  widgetSetters[index]?.(value);
}

function updateAll(value) {
  batch(() => {
    for (const setValue of widgetSetters) setValue(value);
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

function rowElement(row) {
  return h(
    "article",
    { class: "bench-row", "data-id": String(row.id) },
    h("span", null, row.label),
  );
}

function mountList(count) {
  reset();
  const initial = Array.from({ length: count }, (_, id) => ({ id, label: `Row ${id}` }));
  const [rows, updateRows] = createSignal(initial);
  setRows = updateRows;
  dispose = mount(
    () => h("main", { id: "bench-list" }, createList(rows, (row) => row.id, rowElement)),
    container,
  );
  // createList establishes its effect before the fragment has a live parent.
  // A new array identity performs the first real reconciliation after mount.
  setRows(initial.slice());
}

function reverseList() {
  setRows?.((current) => current.slice().reverse());
}

function reverseListMany(repetitions) {
  for (let iteration = 0; iteration < repetitions; iteration += 1) reverseList();
}

globalThis.__frameworkBench = {
  name: "forma",
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
