/**
 * FORMA-028: one budget per task, not per binding.
 *
 * FORMA-004's budgets bound one evaluation: one binding, or one handler run.
 * A widget with ten bindings at the allocation cap therefore ran ten budgets
 * in one task, 382 ms at 4x CPU throttling (formajs#14, review 5513640827).
 * Now every evaluation in a task counts on from what the evaluations before it
 * in that task spent. A binding refused only because the task's budget was
 * already spent re-runs in the next task, where it starts first, and is not
 * reported; a binding over the budget on its own is reported as before.
 *
 * Each test starts on a fresh task (`beforeEach` lets the runtime's timer run),
 * and `settle` runs the retry ticks the runtime schedules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as runtime from '../runtime';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

async function settle(ticks = 40): Promise<void> {
  for (let i = 0; i < ticks; i++) await tick();
}

/** An expression that spends `units` of the 250,000-unit allocation budget and answers `units - 10`. */
const spending = (units: number): string => `Array.from({length: ${units - 10}}).length`;

describe('the task budget (FORMA-028)', () => {
  let container: HTMLDivElement;

  beforeEach(async () => {
    await tick();
    runtime.clearDiagnostics();
    runtime.setDiagnostics(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    runtime.unmount(container);
    container.remove();
    await settle(2);
    runtime.clearDiagnostics();
    vi.restoreAllMocks();
  });

  const texts = (): string[] => [...container.querySelectorAll('[data-out]')].map((e) => e.textContent ?? '');
  const codes = (): string[] => runtime.getDiagnostics().map((d) => d.code ?? '');

  it('ten bindings at the cap spend one budget per task and all of them render', async () => {
    // Each binding spends 200,000 units; one task holds one of them.
    const ps = Array.from({ length: 10 }, () => `<p data-out data-text="{${spending(200_000)}}">server</p>`).join('');
    container.innerHTML = `<div data-forma-state='{}'>${ps}</div>`;
    runtime.mount(container);
    expect(texts().filter((t) => t === '199990')).toHaveLength(1);
    expect(texts().filter((t) => t === 'server')).toHaveLength(9);
    await tick();
    expect(texts().filter((t) => t === '199990')).toHaveLength(2);
    await settle();
    expect(texts()).toEqual(Array(10).fill('199990'));
    // Deferred, never refused: nothing was reported and nothing is marked.
    expect(codes()).toEqual([]);
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(0);
  });

  it('the step budget is spent per task too', async () => {
    // Each binding takes about 72,000 of the 100,000 steps: one per task.
    const steps = 'Array.from({length: 12000}).map((x, i) => i).filter(i => i % 2).length';
    const ps = Array.from({ length: 4 }, () => `<p data-out data-text="{${steps}}">server</p>`).join('');
    container.innerHTML = `<div data-forma-state='{}'>${ps}</div>`;
    runtime.mount(container);
    expect(texts()).toEqual(['6000', 'server', 'server', 'server']);
    await settle();
    expect(texts()).toEqual(Array(4).fill('6000'));
    expect(codes()).toEqual([]);
  });

  it('a binding over the budget on its own is reported, not retried', async () => {
    container.innerHTML = `<div data-forma-state='{}'>
      <p data-out data-text="{${spending(300_000)}}">server</p>
      <p data-out data-text="{${spending(200_000)}}">server</p>
      <p data-out data-text="{${spending(300_010)}}">server</p>
    </div>`;
    runtime.mount(container);
    // The first is refused in a task it started: reported at once. Its refused
    // charge never ran, so the second fits; the third is deferred, then refused
    // in the next task, which it starts.
    expect(texts()).toEqual(['server', '199990', 'server']);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    await settle();
    expect(texts()).toEqual(['server', '199990', 'server']);
    expect(codes()).toEqual(['FORMA_E_BUDGET', 'FORMA_E_BUDGET']);
    expect(container.querySelectorAll('[data-forma-expr-error]')).toHaveLength(2);
  });

  it('a chain of computeds spends one budget between them', async () => {
    // `b` spends 150,000 units and then reads `a`, which spends 150,000 more.
    // With a budget each (2.0.3), the binding answered in one task that spent
    // both; now `a` is refused inside `b`, evaluated alone in the next task,
    // and the binding answers from its cached value.
    container.innerHTML = `<div data-forma-state='{}'
        data-computed="a = ${spending(150_000)}; b = ${spending(150_000)} + a">
      <p data-out data-text="{b}">server</p>
    </div>`;
    runtime.mount(container);
    expect(texts()).toEqual(['server']);
    await settle();
    expect(texts()).toEqual(['299980']);
    expect(codes()).toEqual([]);
  });

  it('a computed refused inside a heavy reader is evaluated again on its own', async () => {
    // The reader spends 200,000 before it reads `a` (100,000), so `a` is
    // refused there. Its failure is not cached as an answer: another reader
    // of `a` alone renders, and so does the heavy reader, in later tasks.
    container.innerHTML = `<div data-forma-state='{}' data-computed="a = ${spending(100_000)}">
      <p data-out data-text="{${spending(200_000)} + a}">server</p>
      <p data-out data-text="{a}">server</p>
    </div>`;
    runtime.mount(container);
    expect(texts()).toEqual(['server', 'server']);
    await settle();
    expect(texts()).toEqual(['299980', '99990']);
    expect(codes()).toEqual([]);
  });

  it('the handlers one event reaches share one budget', async () => {
    // A click bubbles through two handlers that each spend 150,000 units. In
    // one task they cannot both run: the outer is refused and reported (a
    // handler cannot be retried). The next click is a new task.
    container.innerHTML = `<div data-forma-state='{"inner": 0, "outer": 0}'>
      <div id="outer" data-on:click="{outer = ${spending(150_000)}}">
        <button id="inner" data-on:click="{inner = ${spending(150_000)}}">go</button>
      </div>
      <p data-out data-text="{inner + '/' + outer}">server</p>
    </div>`;
    runtime.mount(container);
    expect(texts()).toEqual(['0/0']);
    await tick();
    (container.querySelector('#inner') as HTMLElement).click();
    expect(runtime.getScopes()[0]!.values.inner!.value).toBe(149_990);
    expect(runtime.getScopes()[0]!.values.outer!.value).toBe(0);
    expect(codes()).toEqual(['FORMA_E_BUDGET']);
    expect(container.querySelector('#outer')!.getAttribute('data-forma-handler-error')).toBe('unsupported');
    // Two-sided: the outer handler alone, on its own event, runs.
    (container.querySelector('#outer') as HTMLElement).click();
    expect(runtime.getScopes()[0]!.values.outer!.value).toBe(149_990);
    await settle();
    expect(texts()).toEqual(['149990/149990']);
  });

  it('a handler leaves its bindings what it did not spend', async () => {
    // The handler spends 200,000 units; the binding it updates needs 100,000
    // more, so it renders in the next task instead of in the click's.
    container.innerHTML = `<div data-forma-state='{"n": 0}'>
      <button id="go" data-on:click="{n = ${spending(200_000)}}">go</button>
      <p data-out data-text="{n === 0 ? 'none' : ${spending(100_000)} + n}">server</p>
    </div>`;
    runtime.mount(container);
    expect(texts()).toEqual(['none']);
    await tick();
    (container.querySelector('#go') as HTMLElement).click();
    expect(texts()).toEqual(['none']);
    await settle();
    expect(texts()).toEqual(['299980']);
    expect(codes()).toEqual([]);
  });

  it('a binding a keystroke updates starts on a fresh budget', async () => {
    // Input is scheduled ahead of timers, so a keystroke can run before the
    // timer that zeroes the meter. The search it updates spends 200,000 units:
    // if the previous keystroke's spending were still counted, it would be
    // deferred to the next task instead of answering this one.
    container.innerHTML = `<div data-forma-state='{"q": ""}'>
      <input id="q" data-model="{q}">
      <p data-out data-text="{${spending(200_000)} + q.length}">server</p>
    </div>`;
    runtime.mount(container);
    await tick();
    const input = container.querySelector('#q') as HTMLInputElement;
    for (const text of ['a', 'ab', 'abc']) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      expect(texts()).toEqual([String(199_990 + text.length)]);
    }
    expect(codes()).toEqual([]);
  });

  it("a data-list's rows share the task's budget", async () => {
    // Ten rows, each binding spending 100,000 units: two rows a task.
    container.innerHTML = `<div data-forma-state='{"rows": [0,1,2,3,4,5,6,7,8,9]}'>
      <ul data-list="{rows}"><li data-out data-text="{${spending(100_000)} + item}">row</li></ul>
    </div>`;
    runtime.mount(container);
    expect(texts().filter((t) => t !== 'row')).toHaveLength(2);
    await settle();
    expect(texts()).toEqual(Array.from({ length: 10 }, (_, i) => String(99_990 + i)));
    expect(codes()).toEqual([]);
  });
});
