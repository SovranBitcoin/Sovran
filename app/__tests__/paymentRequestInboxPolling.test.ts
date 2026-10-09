/** @jest-environment node */
import type { AppStateStatus } from 'react-native';
import type { Plugin } from '@cashu/coco-core/plugin';
import { createPaymentRequestNostrTransportPlugin } from '@/shared/lib/cashu/paymentRequestNostrTransport';

type PluginContext = Parameters<NonNullable<Plugin['onInit']>>[0];
type ReceiveService = PluginContext['services']['paymentRequestReceiveService'];
type Handler = Parameters<ReceiveService['registerTransportHandler']>[0];
type Envelope = { id: string; kind: number; pubkey: string; content: string; createdAtSec: number };
type InboxRequest = { timeoutMs?: number; signal?: AbortSignal; since?: number };

const POLL_INTERVAL_MS = 15_000;
const TWO_DAYS_SEC = 2 * 24 * 60 * 60;

const mockUnwrap = jest.fn();
jest.mock('@/shared/lib/nostr/giftWrapCache', () => ({
  giftWrapCache: {
    unwrap: (...args: unknown[]) => mockUnwrap(...args),
    cache: { hydrate: async () => undefined },
  },
}));

function createAppState(initial: AppStateStatus = 'active') {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const appState = {
    currentState: initial,
    addEventListener: (_type: 'change', listener: (state: AppStateStatus) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    appState,
    listenerCount: () => listeners.size,
    set(state: AppStateStatus) {
      appState.currentState = state;
      for (const listener of [...listeners]) listener(state);
    },
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

async function advance(ms: number) {
  jest.advanceTimersByTime(ms);
  await settle();
}

function wrap(id: string, createdAtSec: number): Envelope {
  return {
    id: id.repeat(64),
    kind: 1059,
    pubkey: 'b'.repeat(64),
    content: 'wrapped',
    createdAtSec,
  };
}

async function setup(options: { initial?: AppStateStatus; honourSince?: boolean } = {}) {
  const app = createAppState(options.initial);
  let inbox: Envelope[] = [];
  const getDmEnvelopes = jest.fn(async (_request: InboxRequest) => ({
    match: (ok: (value: { envelopes: Envelope[] }) => unknown) => {
      const since = _request.since;
      return ok({
        envelopes:
          options.honourSince && since !== undefined
            ? inbox.filter((envelope) => envelope.createdAtSec >= since)
            : inbox,
      });
    },
  }));
  const subscribeDmEnvelopes = jest.fn(() => jest.fn());
  const ingestPayload = jest.fn(
    async (_content: string, _meta: { transportMessageId: string }) => ({
      attempt: { state: 'finalized' },
    })
  );
  let handler: Handler | undefined;
  const layer = { getDmEnvelopes, subscribeDmEnvelopes };
  let signerKey = new Uint8Array(32).fill(1);
  const plugin = createPaymentRequestNostrTransportPlugin({
    getSignerKey: () => signerKey,
    loadDataLayer: async () => layer as never,
    appState: app.appState,
  });
  const context = {
    services: {
      paymentRequestReceiveService: {
        ingestPayload,
        recoverPendingAttempts: jest.fn(async () => undefined),
        registerTransportHandler: (value: Handler) => {
          handler = value;
          return jest.fn();
        },
      },
    },
  };
  const dispose = await plugin.onInit?.(context as never);
  return {
    app,
    getDmEnvelopes,
    subscribeDmEnvelopes,
    ingestPayload,
    switchProfile: () => {
      signerKey = new Uint8Array(32).fill(2);
    },
    setInbox: (envelopes: Envelope[]) => {
      inbox = envelopes;
    },
    activate: async (id = 'request') => {
      const operation = { id };
      await handler?.activate?.(operation as never);
      await settle();
    },
    dispose: () => (typeof dispose === 'function' ? dispose() : undefined),
  };
}

describe('payment-request inbox poll', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUnwrap.mockReset();
    mockUnwrap.mockReturnValue({
      content: '{"id":"r","unit":"sat","mint":"https://mint.example","proofs":[]}',
      senderPubkey: 'c'.repeat(64),
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('polls on activation and then once per cadence in the foreground', async () => {
    const t = await setup();
    await t.activate();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);

    await advance(POLL_INTERVAL_MS - 1);
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(2);
    await advance(POLL_INTERVAL_MS);
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(3);
    await t.dispose();
  });

  it('does not poll while backgrounded and polls at once on return, at the same cadence', async () => {
    const t = await setup();
    await t.activate();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);

    t.app.set('background');
    await advance(POLL_INTERVAL_MS * 10);
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);

    t.app.set('active');
    await settle();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(2);

    await advance(POLL_INTERVAL_MS - 1);
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(3);
    await t.dispose();
  });

  it('keeps polling while inactive, and repeated signals start nothing twice', async () => {
    const t = await setup();
    await t.activate();
    await t.activate('second-request');
    t.app.set('inactive');
    t.app.set('active');
    t.app.set('active');
    await settle();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);
    expect(t.subscribeDmEnvelopes).toHaveBeenCalledTimes(1);

    t.app.set('background');
    t.app.set('background');
    t.app.set('active');
    t.app.set('active');
    await settle();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(2);

    // One timer, not two: one cadence adds exactly one poll.
    await advance(POLL_INTERVAL_MS);
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(3);
    await t.dispose();
  });

  it('waits for the foreground when a request is activated in the background', async () => {
    const t = await setup({ initial: 'background' });
    await t.activate();
    await advance(POLL_INTERVAL_MS * 4);
    expect(t.getDmEnvelopes).not.toHaveBeenCalled();

    t.app.set('active');
    await settle();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);
    await t.dispose();
  });

  it('runs a fresh poll on return when one from before the background is still in flight', async () => {
    const t = await setup();
    let release: (() => void) | undefined;
    t.getDmEnvelopes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ match: (ok) => ok({ envelopes: [] }) });
        })
    );
    await t.activate();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);

    t.app.set('background');
    t.app.set('active');
    await settle();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);

    release?.();
    await settle();
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(2);
    await t.dispose();
  });

  it('stops polling and listening once disposed', async () => {
    const t = await setup();
    await t.activate();
    await t.dispose();
    expect(t.app.listenerCount()).toBe(0);
    t.app.set('background');
    t.app.set('active');
    await advance(POLL_INTERVAL_MS * 4);
    expect(t.getDmEnvelopes).toHaveBeenCalledTimes(1);
  });

  it('bounds each read below the cadence', async () => {
    const t = await setup();
    let signal: AbortSignal | undefined;
    t.getDmEnvelopes.mockImplementationOnce((request) => {
      signal = request.signal;
      return new Promise(() => {});
    });
    await t.activate();

    const request = t.getDmEnvelopes.mock.calls[0][0];
    expect(request.timeoutMs).toBeLessThan(POLL_INTERVAL_MS);
    expect(signal?.aborted).toBe(false);
    await advance(POLL_INTERVAL_MS - 1);
    expect(signal?.aborted).toBe(true);
    await t.dispose();
  });

  it('ingests a wrap dated before the newest one already seen', async () => {
    // NIP-59 randomises a gift wrap's created_at up to two days into the past,
    // so a wrap that arrives later can carry an older timestamp. Whatever
    // bounds this read must never drop it on its date.
    const t = await setup();
    const nowSec = 1_800_000_000;
    const newest = wrap('a', nowSec);
    t.setInbox([newest]);
    await t.activate();
    expect(t.ingestPayload).toHaveBeenCalledTimes(1);

    const arrivedLaterDatedEarlier = wrap('d', nowSec - TWO_DAYS_SEC + 60);
    t.setInbox([newest, arrivedLaterDatedEarlier]);
    await advance(POLL_INTERVAL_MS);

    expect(t.ingestPayload).toHaveBeenCalledTimes(2);
    expect(t.ingestPayload.mock.calls[1][1].transportMessageId).toBe(arrivedLaterDatedEarlier.id);

    // And the wrap already claimed is not claimed again on later ticks.
    await advance(POLL_INTERVAL_MS);
    expect(t.ingestPayload).toHaveBeenCalledTimes(2);
    await t.dispose();
  });
  it.each([false, true])(
    'deduplicates overlap pages when the server honours since: %s',
    async (honourSince) => {
      const t = await setup({ honourSince });
      const newest = wrap('a', 1_800_000_000);
      const historic = wrap('b', 1_799_000_000);
      t.setInbox([newest, historic]);
      await t.activate();
      expect(t.getDmEnvelopes.mock.calls[0][0]).not.toHaveProperty('since');
      expect(mockUnwrap).toHaveBeenCalledTimes(2);
      expect(t.ingestPayload).toHaveBeenCalledTimes(2);
      await advance(POLL_INTERVAL_MS);
      expect(t.getDmEnvelopes.mock.calls[1][0].since).toBe(1_799_827_200);
      expect(mockUnwrap).toHaveBeenCalledTimes(2);
      expect(t.ingestPayload).toHaveBeenCalledTimes(2);

      // The lower bound is inclusive, and arrival order need not match event time.
      const late = wrap('d', 1_799_827_200);
      t.setInbox([newest, historic, late]);
      await advance(POLL_INTERVAL_MS);
      expect(t.ingestPayload.mock.calls.map((call) => call[1].transportMessageId)).toEqual([
        newest.id,
        historic.id,
        late.id,
      ]);
      expect(mockUnwrap).toHaveBeenCalledTimes(3);
      await t.dispose();
    }
  );

  it('retains processed ids beyond 1000 wraps and does not advance the cursor with time', async () => {
    const t = await setup();
    t.setInbox(
      Array.from({ length: 1001 }, (_, i) => ({
        ...wrap('a', 1_800_000_000),
        id: i.toString(16).padStart(64, '0'),
      }))
    );
    await t.activate();
    // Drain the sequential unwrap/ingest loop before advancing the poll timer.
    for (let i = 0; i < 1001; i++) await settle();
    expect(mockUnwrap).toHaveBeenCalledTimes(1001);
    await advance(POLL_INTERVAL_MS);
    for (let i = 0; i < 1001; i++) await settle();
    expect(mockUnwrap).toHaveBeenCalledTimes(1001);
    expect(t.ingestPayload).toHaveBeenCalledTimes(1001);
    expect(t.getDmEnvelopes.mock.calls[1][0].since).toBe(1_799_827_200);
    await t.dispose();
  });

  it('starts without a cursor after restart and profile switch', async () => {
    const newest = wrap('a', 1_800_000_000);
    const first = await setup();
    first.setInbox([newest]);
    await first.activate();
    await advance(POLL_INTERVAL_MS);
    expect(first.getDmEnvelopes.mock.calls[1][0].since).toBe(1_799_827_200);
    await first.dispose();

    const next = await setup();
    next.setInbox([newest]);
    await next.activate();
    expect(next.getDmEnvelopes.mock.calls[0][0]).not.toHaveProperty('since');
    next.switchProfile();
    await advance(POLL_INTERVAL_MS);
    expect(next.getDmEnvelopes.mock.calls[1][0]).not.toHaveProperty('since');
    expect(next.ingestPayload).toHaveBeenCalledTimes(2);
    await next.dispose();
  });
});
