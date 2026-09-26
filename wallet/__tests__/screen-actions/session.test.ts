import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createScreenActionSession,
  type ScreenActionsBridge,
} from '../../src/screen-actions';
import { createSubscriptionBus } from '../../src/subscriptions';
import type { ColadaSubscriptionEvent } from '../../src';

afterEach(() => vi.useRealTimers());

function subscribeMappedUpdates(
  bus: ReturnType<typeof createSubscriptionBus>,
  types: ColadaSubscriptionEvent['type'][],
  map: (event: ColadaSubscriptionEvent) => Record<string, unknown> | null,
) {
  const bridge: ScreenActionsBridge = {
    subscribeEntryUpdates: (_screenType, callback) =>
      bus.subscribe({ type: types }, (event) => {
        const update = map(event);
        if (update) callback(update);
      }),
  };
  return bridge;
}

describe('createScreenActionSession', () => {
  it.each([1_000, 30 * 24 * 60 * 60 * 1000])('refreshes a locked send at its reclaim boundary after %i ms', (delayMs) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const session = createScreenActionSession({
      screenType: 'sendToken',
      handlers: {},
      entrySeed: {
        id: 'locked-send', operationId: 'locked-send', type: 'send', state: 'pending',
        token: { proofs: [] },
        metadata: {
          lockType: 'p2pk', lockPubkey: `02${'ab'.repeat(32)}`,
          lockLocktime: String((Date.now() + delayMs) / 1000),
          lockRefundKeys: JSON.stringify([`02${'cd'.repeat(32)}`]),
        },
      },
    });
    const changed = vi.fn();
    session.subscribe(changed);
    expect(session.inspect().actions.cancel.available).toBe(false);
    vi.advanceTimersByTime(delayMs + 60_001);
    expect(session.inspect().actions.cancel.available).toBe(true);
    expect(changed).toHaveBeenCalled();
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending lock boundary when disposed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
    const session = createScreenActionSession({
      screenType: 'sendToken', handlers: {},
      entrySeed: {
        id: 'locked-send', operationId: 'locked-send', type: 'send', state: 'pending',
        token: { proofs: [] },
        metadata: {
          lockType: 'p2pk', lockPubkey: `02${'ab'.repeat(32)}`,
          lockLocktime: '1800000100',
          lockRefundKeys: JSON.stringify([`02${'cd'.repeat(32)}`]),
        },
      },
    });
    expect(vi.getTimerCount()).toBe(1);
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes an entry from subscription-driven updates without React', () => {
    const bus = createSubscriptionBus();
    const bridge = subscribeMappedUpdates(bus, ['history.updated'], (event) =>
      event.type === 'history.updated'
        ? (event.entry as Record<string, unknown>)
        : null,
    );
    const session = createScreenActionSession({
      screenType: 'sendToken',
      handlers: {},
      entrySeed: { id: 'send-1', type: 'send', state: 'pending' },
      subscriptionBus: bus,
      bridge,
    });

    bus.publish({
      type: 'history.updated',
      entry: { id: 'send-1', type: 'send', state: 'complete' },
      historyType: 'send',
      entryId: 'send-1',
    });

    expect(session.inspect().entry).toMatchObject({
      id: 'send-1',
      state: 'complete',
    });
    session.dispose();
  });

  it('refreshes source labels when screen actions change', () => {
    const bus = createSubscriptionBus();
    let source = 'Clipboard';
    let notified = 0;
    const session = createScreenActionSession({
      screenType: 'sendToken',
      handlers: {},
      entrySeed: { id: 'send-1', type: 'send', state: 'pending' },
      subscriptionBus: bus,
      bridge: {
        getSourceLabel: () => source,
      },
    });
    session.subscribe(() => {
      notified += 1;
    });

    expect(session.inspect().source).toBe('Clipboard');

    source = 'QR Code';
    bus.publish({ type: 'screenActions.changed', reason: 'scanHistory' });

    expect(notified).toBeGreaterThan(0);
    expect(session.inspect().source).toBe('QR Code');
    session.dispose();
  });

  it('applies mint info enrichment updates through the session bridge', () => {
    const bus = createSubscriptionBus();
    const bridge: ScreenActionsBridge = {
      ...subscribeMappedUpdates(bus, ['mintInfo.enrichmentChanged'], (event) =>
        event.type === 'mintInfo.enrichmentChanged'
          ? { _mintEnrichment: true, mintUrl: event.mintUrl }
          : null,
      ),
      shouldApplyEntryUpdate: (current, updated) =>
        Boolean(current?.mintUrl && updated._mintEnrichment),
      mergeEntryUpdate: (current) => ({
        ...(current ?? {}),
        auditScore: 4.5,
        reviewCount: 12,
      }),
    };
    const session = createScreenActionSession({
      screenType: 'mintInfo',
      handlers: {},
      entrySeed: { mintUrl: 'https://mint.example' },
      subscriptionBus: bus,
      bridge,
    });

    bus.publish({
      type: 'mintInfo.enrichmentChanged',
      mintUrl: 'https://mint.example',
    });

    expect(session.inspect().entry).toMatchObject({
      auditScore: 4.5,
      reviewCount: 12,
    });
    session.dispose();
  });

  it('adds mint selector items from subscription events', () => {
    const bus = createSubscriptionBus();
    const bridge: ScreenActionsBridge = {
      ...subscribeMappedUpdates(bus, ['mintSelector.itemAdded'], (event) =>
        event.type === 'mintSelector.itemAdded'
          ? { _mintItemAdded: true, _newMintItem: event.item }
          : null,
      ),
      shouldApplyEntryUpdate: (current, updated) =>
        Array.isArray(current?.items) && Boolean(updated._mintItemAdded),
      mergeEntryUpdate: (current, updated) => ({
        ...(current ?? {}),
        items: [
          ...((current?.items as Record<string, unknown>[] | undefined) ?? []),
          updated._newMintItem as Record<string, unknown>,
        ],
      }),
    };
    const session = createScreenActionSession({
      screenType: 'mintSelector',
      handlers: {},
      entrySeed: { items: [] },
      subscriptionBus: bus,
      bridge,
    });

    bus.publish({
      type: 'mintSelector.itemAdded',
      mintUrl: 'https://mint.example',
      item: { mintUrl: 'https://mint.example', displayName: 'Example Mint' },
    });

    expect(session.inspect().entry).toMatchObject({
      items: [{ mintUrl: 'https://mint.example', displayName: 'Example Mint' }],
    });
    session.dispose();
  });

  it('parses a JSON seed string into the entry', () => {
    const session = createScreenActionSession({
      screenType: 'sendToken',
      handlers: {},
      entrySeed: JSON.stringify({ id: 'send-1', type: 'send' }),
    });
    expect(session.inspect().error).toBeNull();
    expect(session.inspect().entry).toMatchObject({ id: 'send-1' });
    session.dispose();
  });

  it.each(['not json', '"a string"', '[1,2]', 'null'])(
    'rejects a seed that is not a JSON object (%s)',
    (seed) => {
      const session = createScreenActionSession({
        screenType: 'sendToken',
        handlers: {},
        entrySeed: seed,
      });
      expect(session.inspect().error).toBe(
        'Invalid transaction data. Please try again.',
      );
      session.dispose();
    },
  );
});
