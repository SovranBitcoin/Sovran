import { describe, expect, it, vi } from 'vitest';

import { createSubscriptionBus, matchesSubscriptionFilter } from '../../src/subscriptions';

describe('subscription bus', () => {
  it('delivers matching filtered events and ignores non-matching events', () => {
    const bus = createSubscriptionBus();
    const listener = vi.fn();

    bus.subscribe({ type: 'history.updated', historyType: 'mint', quoteId: 'q1' }, listener);
    bus.publish({
      type: 'history.updated',
      historyType: 'send',
      quoteId: 'q1',
      entry: {},
    });
    bus.publish({
      type: 'history.updated',
      historyType: 'mint',
      quoteId: 'q2',
      entry: {},
    });
    bus.publish({
      type: 'history.updated',
      historyType: 'mint',
      quoteId: 'q1',
      entry: { quoteId: 'q1' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: 'history.updated',
      historyType: 'mint',
      quoteId: 'q1',
      entry: { quoteId: 'q1' },
    });
  });

  it('supports subscribeAll and unsubscribe', () => {
    const bus = createSubscriptionBus();
    const all = vi.fn();
    const filtered = vi.fn();

    const unsubscribeAll = bus.subscribeAll(all);
    const unsubscribeFiltered = bus.subscribe({ type: ['melt.updated', 'mint.updated'] }, filtered);

    bus.publish({ type: 'melt.updated', operationId: 'm1', entry: {} });
    unsubscribeFiltered();
    bus.publish({ type: 'mint.updated', operationId: 'q1', entry: {} });
    unsubscribeAll();
    bus.publish({ type: 'screenActions.changed', reason: 'settings' });

    expect(all).toHaveBeenCalledTimes(2);
    expect(filtered).toHaveBeenCalledTimes(1);
  });

  it('matches filters by event type arrays and optional identity fields', () => {
    expect(
      matchesSubscriptionFilter(
        { type: ['history.updated', 'mint.updated'], operationId: 'op1' },
        { type: 'mint.updated', operationId: 'op1', entry: {} },
      ),
    ).toBe(true);
    expect(
      matchesSubscriptionFilter(
        { type: ['history.updated', 'mint.updated'], operationId: 'op1' },
        { type: 'melt.updated', operationId: 'op1', entry: {} },
      ),
    ).toBe(false);
  });
});
