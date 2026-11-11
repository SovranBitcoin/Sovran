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

  it('drops a failed leg’s error once it succeeds on a retry', () => {
    const store = createLegProgressStore<Record<string, never>>({ name: 't', log: stubLog });
    store.getState().start({ id: 'x', legs: [{ id: 'a' }], meta: {} });
    store.getState().setLegFailed('a', 'mint offline');
    store.getState().setLegDone('a');
    expect(store.getState().active?.legs[0]).toEqual({ id: 'a', status: 'done' });
  });

  it('keeps a leg that is done or skipped as it is', () => {
    const store = createLegProgressStore<Record<string, never>>({ name: 't', log: stubLog });
    store.getState().start({ id: 'x', legs: [{ id: 'a' }, { id: 'b' }], meta: {} });
    store.getState().setLegDone('a');
    store.getState().setLegSkipped('b');
    store.getState().setLegFailed('a', 'late');
    store.getState().setActiveLeg('b');
    expect(store.getState().active?.legs.map((l) => l.status)).toEqual(['done', 'skipped']);
  });

  it('ends a run once: a final state is not replaced by another', () => {
    const store = createLegProgressStore<Record<string, never>>({ name: 't', log: stubLog });
    store.getState().start({ id: 'x', legs: [{ id: 'a' }], meta: {} });
    store.getState().cancel();
    store.getState().complete();
    store.getState().fail('late');
    expect(store.getState().active).toMatchObject({ state: 'cancelled' });
    expect(store.getState().active?.errorMessage).toBeUndefined();
  });

  it('reopens an ended run for a retry, without its old message, and ends it again', () => {
    const store = createLegProgressStore<Record<string, never>>({ name: 't', log: stubLog });
    store.getState().start({ id: 'x', legs: [{ id: 'a' }], meta: {} });
    store.getState().setLegFailed('a', 'mint offline');
    store.getState().fail('mint offline');

    store.getState().resume();
    expect(store.getState().active).toMatchObject({ state: 'running', errorMessage: undefined });
    store.getState().setLegDone('a');
    store.getState().complete();

    expect(store.getState().active).toMatchObject({ state: 'done', legs: [{ status: 'done' }] });
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
