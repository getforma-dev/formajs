import { createSignal, h, Fragment, mount } from '@getforma/core';

const [count, setCount] = createSignal(0);

function Counter() {
  return (
    <div style="font-family: system-ui; padding: 2rem;">
      <h1>FormaJS Counter (JSX)</h1>
      <p>{() => `Count: ${count()}`}</p>
      <button onClick={() => setCount(count() + 1)}>Increment</button>
      <button onClick={() => setCount(0)} style="margin-left: 8px;">Reset</button>
    </div>
  );
}

mount(() => <Counter />, '#app');
