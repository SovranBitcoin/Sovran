/**
 * Generic leg-progress store factory: leg lifecycle + terminal states, and the
 * swap store built on it still carries its meta and drives `isSwapStatusActive`.
 */
/* eslint-disable import/first */

jest.mock('@/shared/lib/logger', () => ({
  __esModule: true,
  paymentLog: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  nostrLog: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { createLegProgressStore } from '@/shared/stores/runtime/legProgress';
import { isSwapStatusActive, useSwapStatusStore } from '@/shared/stores/runtime/swapStatusStore';

const stubLog = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };

describe('createLegProgressStore', () => {
  it('runs the full leg lifecycle', () => {
    const store = createLegProgressStore<{ kind: string }>({ name: 'test', log: stubLog });
    store.getState().start({ id: 'x', legs: [{ id: 'a' }, { id: 'b' }], meta: { kind: 'unit' } });

    expect(store.getState().active?.state).toBe('running');
    expect(store.getState().active?.legs.map((l) => l.status)).toEqual(['pending', 'pending']);

    store.getState().setActiveLeg('a');
    store.getState().setLegDone('a');
    store.getState().setLegFailed('b', 'boom');

    const legs = store.getState().active!.legs;
    expect(legs[0].status).toBe('done');
    expect(legs[1]).toMatchObject({ status: 'failed', errorMessage: 'boom' });

    store.getState().complete();
    expect(store.getState().active?.state).toBe('done');

    store.getState().clear();
    expect(store.getState().active).toBeNull();
  });

  it('fail() sets a terminal failed state with the message', () => {
    const store = createLegProgressStore<Record<string, never>>({ name: 't', log: stubLog });
    store.getState().start({ id: 'x', legs: [{ id: 'a' }], meta: {} });
    store.getState().fail('nope');
    expect(store.getState().active).toMatchObject({ state: 'failed', errorMessage: 'nope' });
  });

  it('cancel() sets a terminal cancelled state', () => {
    const store = createLegProgressStore<Record<string, never>>({ name: 't', log: stubLog });
    store.getState().start({ id: 'x', legs: [{ id: 'a' }], meta: {} });
    store.getState().cancel();
    expect(store.getState().active?.state).toBe('cancelled');
  });
});

describe('swap store parity (migrated onto the factory)', () => {
  beforeEach(() => useSwapStatusStore.getState().clear());

  it('carries swap meta and reports active only while running', () => {
    useSwapStatusStore
      .getState()
      .start({ id: 's1', legs: [{ id: 'l1' }], meta: { unit: 'sat', groupId: 'g' } });

    expect(isSwapStatusActive()).toBe(true);
    expect(useSwapStatusStore.getState().active?.meta).toEqual({ unit: 'sat', groupId: 'g' });

    useSwapStatusStore.getState().setLegDone('l1');
    useSwapStatusStore.getState().complete();

    expect(isSwapStatusActive()).toBe(false);
    expect(useSwapStatusStore.getState().active?.state).toBe('done');
  });
});
