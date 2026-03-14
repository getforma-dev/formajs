import { describe, it, expect, vi } from 'vitest';
import { createBus } from '../bus';

describe('createBus', () => {
  it('creates a bus with on, once, emit, off, clear methods', () => {
    const bus = createBus();
    expect(typeof bus.on).toBe('function');
    expect(typeof bus.once).toBe('function');
    expect(typeof bus.emit).toBe('function');
    expect(typeof bus.off).toBe('function');
    expect(typeof bus.clear).toBe('function');
  });
});

describe('on / emit', () => {
  it('handler receives emitted payload', () => {
    const bus = createBus<{ msg: string }>();
    const spy = vi.fn();
    bus.on('msg', spy);
    bus.emit('msg', 'hello');
    expect(spy).toHaveBeenCalledWith('hello');
  });

  it('handler fires for every emit', () => {
    const bus = createBus<{ tick: number }>();
    const spy = vi.fn();
    bus.on('tick', spy);

    bus.emit('tick', 1);
    bus.emit('tick', 2);
    bus.emit('tick', 3);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenNthCalledWith(1, 1);
    expect(spy).toHaveBeenNthCalledWith(2, 2);
    expect(spy).toHaveBeenNthCalledWith(3, 3);
  });

  it('multiple handlers on same event', () => {
    const bus = createBus<{ x: number }>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('x', a);
    bus.on('x', b);
    bus.emit('x', 42);
    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it('handlers for different events are independent', () => {
    const bus = createBus<{ a: string; b: number }>();
    const aSpy = vi.fn();
    const bSpy = vi.fn();
    bus.on('a', aSpy);
    bus.on('b', bSpy);

    bus.emit('a', 'hello');
    expect(aSpy).toHaveBeenCalledTimes(1);
    expect(bSpy).not.toHaveBeenCalled();
  });

  it('emit with no listeners is a no-op', () => {
    const bus = createBus<{ x: number }>();
    expect(() => bus.emit('x', 1)).not.toThrow();
  });

  it('handler errors are caught and logged', () => {
    const bus = createBus<{ x: number }>();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const goodHandler = vi.fn();

    bus.on('x', () => { throw new Error('boom'); });
    bus.on('x', goodHandler);

    bus.emit('x', 1);
    expect(goodHandler).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('on returns unsubscribe', () => {
  it('unsubscribe stops handler from firing', () => {
    const bus = createBus<{ x: number }>();
    const spy = vi.fn();
    const unsub = bus.on('x', spy);

    bus.emit('x', 1);
    expect(spy).toHaveBeenCalledTimes(1);

    unsub();
    bus.emit('x', 2);
    expect(spy).toHaveBeenCalledTimes(1); // still 1
  });
});

describe('off', () => {
  it('removes a specific handler', () => {
    const bus = createBus<{ x: number }>();
    const spy = vi.fn();
    bus.on('x', spy);
    bus.off('x', spy);
    bus.emit('x', 1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('off on non-existent handler is a no-op', () => {
    const bus = createBus<{ x: number }>();
    expect(() => bus.off('x', () => {})).not.toThrow();
  });
});

describe('once', () => {
  it('handler fires exactly once', () => {
    const bus = createBus<{ x: number }>();
    const spy = vi.fn();
    bus.once('x', spy);

    bus.emit('x', 1);
    bus.emit('x', 2);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(1);
  });

  it('once returns unsubscribe that works before emit', () => {
    const bus = createBus<{ x: number }>();
    const spy = vi.fn();
    const unsub = bus.once('x', spy);

    unsub();
    bus.emit('x', 1);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('clear', () => {
  it('removes all handlers', () => {
    const bus = createBus<{ a: string; b: number }>();
    const aSpy = vi.fn();
    const bSpy = vi.fn();
    bus.on('a', aSpy);
    bus.on('b', bSpy);

    bus.clear();
    bus.emit('a', 'x');
    bus.emit('b', 1);
    expect(aSpy).not.toHaveBeenCalled();
    expect(bSpy).not.toHaveBeenCalled();
  });
});
