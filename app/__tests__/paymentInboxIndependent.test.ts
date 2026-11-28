/**
 * @jest-environment node
 *
 * Audit D16: switching the relay tier off in Settings → Network must not stop
 * ecash messages and payment-request replies arriving. The switch is about
 * where profiles and contacts load from ("Ask relays directly when the cache
 * can't answer"); payment ingress has its own inbox that ignores it.
 *
 * The real tier config, data-layer builder, payment inbox and relay connection
 * run over a fake WebSocket; the settings store's tier switches are the input.
 */
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';

type Frame = unknown[];

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  sent: Frame[] = [];
  constructor(public url: string) {
    FakeSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }
  send(raw: string) {
    this.sent.push(JSON.parse(raw) as Frame);
  }
  close() {}
  emit(frame: Frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const mockSettings = { primalTierEnabled: true, relayTierEnabled: true, primalHostsDisabled: [] };
jest.mock('@/shared/stores/global/settingsStore', () => ({
  useSettingsStore: Object.assign((select: (s: typeof mockSettings) => unknown) => select(mockSettings), {
    getState: () => mockSettings,
  }),
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  paymentLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/stores/global/profileStore', () => {
  const useProfileStore = { getState: () => ({ getActiveProfile: () => ({ pubkey: 'a'.repeat(64) }) }) };
  return {
    useProfileStore,
    ...jest
      .requireActual<typeof import('./helpers/profileStoreMock')>('./helpers/profileStoreMock')
      .activeAccountReaders(() => useProfileStore.getState()),
  };
});
jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';
import { DEFAULT_RELAYS } from '@/shared/lib/nostr/outbox/defaults';
import { getPaymentInbox } from '@/shared/lib/nostr/paymentInbox';
import { PAYMENT_RELAYS } from '@/shared/lib/nostr/sendDirectMessage';
import {
  fetchDmEnvelopes,
  subscribeDmEnvelopesLive,
} from '@/features/payments/data/dmEnvelopeClient';

const VIEWER = 'b'.repeat(64);
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
});
beforeEach(() => {
  // Sockets open on a microtask; only the clock is faked.
  jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
  FakeSocket.instances = [];
  mockSettings.primalTierEnabled = true;
  mockSettings.relayTierEnabled = true;
});
afterEach(async () => {
  // The relay connection is shared and outlives a test: let its idle sockets
  // close so the next test sees the ones it opens.
  await jest.advanceTimersByTimeAsync(60_000);
  jest.useRealTimers();
});

const giftWrap = () =>
  finalizeEvent(
    { kind: 1059, created_at: Math.floor(Date.now() / 1000) - 60, tags: [['p', VIEWER]], content: 'cipher' },
    generateSecretKey()
  );

describe('payment ingress with the relay tier switched off', () => {
  it('the social layer drops its relay tier, and with both tiers off there is no social layer at all', () => {
    mockSettings.relayTierEnabled = false;
    const social = buildNostrDataLayer();
    expect(social).not.toBeNull();
    let delivered = 0;
    social!.subscribeDmEnvelopes({ viewerPubkey: VIEWER }, () => (delivered += 1));
    // This is what payment ingress used to be given: a subscription that does nothing.
    expect(FakeSocket.instances).toHaveLength(0);
    expect(delivered).toBe(0);

    mockSettings.primalTierEnabled = false;
    expect(buildNostrDataLayer()).toBeNull();
  });

  it.each([
    ['relay tier off', { primalTierEnabled: true, relayTierEnabled: false }],
    ['every tier off', { primalTierEnabled: false, relayTierEnabled: false }],
  ])('a gift wrap still arrives live (%s)', async (_name, tiers) => {
    Object.assign(mockSettings, tiers);
    const pages: string[][] = [];
    const stop = subscribeDmEnvelopesLive(VIEWER, (page) => pages.push(page.envelopes.map((e) => e.id)));
    await flush();
    // One socket per payment relay, each asked for the viewer's wraps.
    expect(FakeSocket.instances.map((socket) => socket.url).sort()).toEqual([...DEFAULT_RELAYS].sort());
    const socket = FakeSocket.instances[0]!;
    const req = socket.sent.find((frame) => frame[0] === 'REQ')!;
    expect(req[2]).toEqual({ kinds: [4, 1059], '#p': [VIEWER] });
    const wrap = giftWrap();
    socket.emit(['EVENT', req[1], wrap]);
    expect(pages).toEqual([[wrap.id]]);
    stop();
  });

  it('the inbox read still reaches the relays (relay tier off)', async () => {
    mockSettings.relayTierEnabled = false;
    const wrap = giftWrap();
    const reading = fetchDmEnvelopes({ viewer: VIEWER });
    await flush();
    for (const socket of FakeSocket.instances) {
      const req = socket.sent.find((frame) => frame[0] === 'REQ')!;
      socket.emit(['EVENT', req[1], wrap]);
      socket.emit(['EOSE', req[1]]);
    }
    await jest.advanceTimersByTimeAsync(100);
    const page = await reading;
    expect(page.envelopes.map((envelope) => envelope.id)).toEqual([wrap.id]);
  });

  it('listens on the relays a payment request tells the payer to deliver to', () => {
    // The request's nprofile advertises PAYMENT_RELAYS.slice(0, 3).
    expect(PAYMENT_RELAYS.slice(0, 3).every((relay) => DEFAULT_RELAYS.includes(relay))).toBe(true);
    expect(getPaymentInbox()).not.toBeNull();
  });

  it('shares its sockets with the social relay tier rather than opening a second set', async () => {
    const stop = subscribeDmEnvelopesLive(VIEWER, () => {});
    await flush();
    const before = FakeSocket.instances.length;
    void buildNostrDataLayer()!.getProfiles({ pubkeys: ['c'.repeat(64)], refresh: true });
    await flush();
    const relaySockets = (list: FakeSocket[]) =>
      list.filter((socket) => DEFAULT_RELAYS.includes(socket.url)).length;
    expect(before).toBe(DEFAULT_RELAYS.length);
    // The profile read went out on the sockets the inbox already holds.
    expect(relaySockets(FakeSocket.instances)).toBe(DEFAULT_RELAYS.length);
    expect(
      FakeSocket.instances
        .filter((socket) => DEFAULT_RELAYS.includes(socket.url))
        .every((socket) => socket.sent.filter((frame) => frame[0] === 'REQ').length === 2)
    ).toBe(true);
    stop();
  });
});
