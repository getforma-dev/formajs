// C1 (1.1.0): the removed skipCleanupInfra fast-path used to drop cleanups
// registered on runs after the first, and could cross-register an effect's
// cleanup onto a sibling's collector.
import { describe, it, expect } from 'vitest';
import { createSignal } from '../signal';
import { createEffect } from '../effect';
import { createRoot } from '../root';
import { onCleanup } from '../cleanup';

const COLON = String.fromCharCode(58);

describe('effect cleanup correctness (1.1.0)', () => {
  it('C1: cleanup returned on a LATER run still runs (no skipCleanupInfra latch)', () => {
    const order: string[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      createEffect(() => {
        const c = count();
        order.push('run' + COLON + c);
        if (c > 0) return () => { order.push('cleanup' + COLON + c); };
      });
      setCount(1);
      setCount(2);
      expect(order).toEqual(['run:0', 'run:1', 'cleanup:1', 'run:2']);
    });
  });

  it('C1: onCleanup on a LATER run still runs', () => {
    const order: string[] = [];
    createRoot(() => {
      const [count, setCount] = createSignal(0);
      createEffect(() => {
        const c = count();
        order.push('run' + COLON + c);
        if (c > 0) onCleanup(() => order.push('cleanup' + COLON + c));
      });
      setCount(1);
      setCount(2);
      expect(order).toEqual(['run:0', 'run:1', 'cleanup:1', 'run:2']);
    });
  });

  it('C1: fast-path effect onCleanup is not lost or cross-registered onto a sibling', () => {
    const order: string[] = [];
    createRoot(() => {
      const [a] = createSignal(0);
      const [b, setB] = createSignal(0);
      createEffect(() => {
        const av = a();
        order.push('A' + COLON + av);
        onCleanup(() => order.push('Aclean' + COLON + av));
      });
      let bCleanupCalled = false;
      createEffect(() => {
        const bv = b();
        order.push('B' + COLON + bv);
        if (bv > 0) onCleanup(() => { bCleanupCalled = true; order.push('Bclean' + COLON + bv); });
      });
      order.length = 0;
      setB(1);
      setB(2);
      expect(bCleanupCalled).toBe(true);
      expect(order).toEqual(['B:1', 'Bclean:1', 'B:2']);
      expect(order).not.toContain('Aclean:0');
    });
  });
});
