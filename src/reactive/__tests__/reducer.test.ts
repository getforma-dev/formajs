import { describe, it, expect, vi } from 'vitest';
import { createReducer } from '../reducer';
import { createEffect } from '../effect';
import { createRoot } from '../root';

type CounterAction = { type: 'INCREMENT' } | { type: 'DECREMENT' } | { type: 'RESET' };

function counterReducer(state: number, action: CounterAction): number {
  switch (action.type) {
    case 'INCREMENT': return state + 1;
    case 'DECREMENT': return state - 1;
    case 'RESET': return 0;
  }
}

describe('createReducer', () => {
  it('returns [state, dispatch] tuple', () => {
    const result = createReducer(counterReducer, 0);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe('function');
    expect(typeof result[1]).toBe('function');
  });

  it('state() returns initial state', () => {
    const [state] = createReducer(counterReducer, 0);
    expect(state()).toBe(0);
  });

  it('dispatch(action) updates state via reducer function', () => {
    const [state, dispatch] = createReducer(counterReducer, 0);
    dispatch({ type: 'INCREMENT' });
    expect(state()).toBe(1);
  });

  it('state getter is reactive — createEffect reacts to dispatch', () => {
    const log: number[] = [];
    createRoot(() => {
      const [state, dispatch] = createReducer(counterReducer, 0);

      createEffect(() => {
        log.push(state());
      });

      expect(log).toEqual([0]);

      dispatch({ type: 'INCREMENT' });
      expect(log).toEqual([0, 1]);

      dispatch({ type: 'INCREMENT' });
      expect(log).toEqual([0, 1, 2]);
    });
  });

  it('multiple dispatches in sequence accumulate correctly', () => {
    const [state, dispatch] = createReducer(counterReducer, 0);

    dispatch({ type: 'INCREMENT' });
    dispatch({ type: 'INCREMENT' });
    dispatch({ type: 'INCREMENT' });
    dispatch({ type: 'INCREMENT' });
    dispatch({ type: 'INCREMENT' });

    expect(state()).toBe(5);

    dispatch({ type: 'DECREMENT' });
    dispatch({ type: 'DECREMENT' });

    expect(state()).toBe(3);
  });

  it('reducer receives both current state and action', () => {
    const spy = vi.fn((state: number, action: CounterAction) => {
      switch (action.type) {
        case 'INCREMENT': return state + 1;
        case 'DECREMENT': return state - 1;
        case 'RESET': return 0;
      }
    });

    const [, dispatch] = createReducer(spy, 10);

    dispatch({ type: 'INCREMENT' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(10, { type: 'INCREMENT' });

    dispatch({ type: 'DECREMENT' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(11, { type: 'DECREMENT' });
  });

  it('complex state (objects) works with the reducer pattern', () => {
    type TodoAction =
      | { type: 'ADD'; text: string }
      | { type: 'TOGGLE'; index: number }
      | { type: 'CLEAR_COMPLETED' };

    interface Todo {
      text: string;
      done: boolean;
    }

    function todoReducer(state: Todo[], action: TodoAction): Todo[] {
      switch (action.type) {
        case 'ADD':
          return [...state, { text: action.text, done: false }];
        case 'TOGGLE':
          return state.map((todo, i) =>
            i === action.index ? { ...todo, done: !todo.done } : todo,
          );
        case 'CLEAR_COMPLETED':
          return state.filter((todo) => !todo.done);
      }
    }

    const [todos, dispatch] = createReducer(todoReducer, [] as Todo[]);

    expect(todos()).toEqual([]);

    dispatch({ type: 'ADD', text: 'Write tests' });
    expect(todos()).toEqual([{ text: 'Write tests', done: false }]);

    dispatch({ type: 'ADD', text: 'Run tests' });
    expect(todos()).toEqual([
      { text: 'Write tests', done: false },
      { text: 'Run tests', done: false },
    ]);

    dispatch({ type: 'TOGGLE', index: 0 });
    expect(todos()).toEqual([
      { text: 'Write tests', done: true },
      { text: 'Run tests', done: false },
    ]);

    dispatch({ type: 'CLEAR_COMPLETED' });
    expect(todos()).toEqual([{ text: 'Run tests', done: false }]);
  });

  it('typical counter pattern: INCREMENT/DECREMENT actions', () => {
    const [count, dispatch] = createReducer(counterReducer, 0);

    expect(count()).toBe(0);

    dispatch({ type: 'INCREMENT' });
    expect(count()).toBe(1);

    dispatch({ type: 'INCREMENT' });
    expect(count()).toBe(2);

    dispatch({ type: 'DECREMENT' });
    expect(count()).toBe(1);

    dispatch({ type: 'DECREMENT' });
    expect(count()).toBe(0);

    dispatch({ type: 'DECREMENT' });
    expect(count()).toBe(-1);

    dispatch({ type: 'RESET' });
    expect(count()).toBe(0);
  });
});
