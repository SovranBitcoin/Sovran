/**
 * @jest-environment node
 *
 * Characterization of the BitChat BLE direct-message store: how threads are
 * appended per peer, how native delivery statuses move a sent message, and
 * what a saved history looks like after a restart. The real store, its
 * profile-scoped storage and persist wiring run over an in-memory
 * AsyncStorage; nothing native is involved.
 */

import {
  useBitchatDmMessagesStore,
  type BleDmMessage,
} from '@/features/bitchat/stores/bitchatDmMessages';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { signalMigrationsComplete } from '@/shared/lib/cashu/profileScopedStorage';

const mockAsync = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async (key: string) => mockAsync.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockAsync.set(key, value),
    removeItem: async (key: string) => void mockAsync.delete(key),
    getAllKeys: async () => [...mockAsync.keys()],
  };
  return { __esModule: true, default: storage, ...storage };
});
jest.mock('@sovranbitcoin/schemas', () => ({
  ...jest.requireActual('@sovranbitcoin/schemas'),
  loggableIssues: () => [],
}));

const PEER_A = '0123456789abcdef';
const PEER_B = 'fedcba9876543210';
const PUBKEY = 'c'.repeat(64);

const store = () => useBitchatDmMessagesStore.getState();

type Incoming = Parameters<ReturnType<typeof store>['appendIncoming']>[0];
type StatusEvent = Parameters<ReturnType<typeof store>['applyDeliveryStatus']>[0];

function incoming(id: string, timestamp: number, peerID = PEER_A): Incoming {
  const event: Incoming = {
    id,
    peerID,
    content: `hi ${id}`,
    sender: 'anon1234',
    timestamp,
    isOwn: false,
  };
  return event;
}

function outgoing(id: string, timestamp: number): BleDmMessage {
  return {
    id,
    content: `out ${id}`,
    sender: 'me',
    senderId: 'me',
    timestamp,
    isPrivate: true,
    isOwn: true,
    isPending: true,
    deliveryStatus: 'sending',
  };
}

function status(messageID: string, s: StatusEvent['status'], reason?: string) {
  const event: StatusEvent = { messageID, status: s, ...(reason ? { reason } : {}) };
  store().applyDeliveryStatus(event);
}

const thread = (peer = PEER_A) => store().byPeer[peer] ?? [];

async function settle() {
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/** Save, forget the in-memory threads, and load what was saved, as a relaunch does. */
async function relaunch() {
  await settle();
  const key = [...mockAsync.keys()].find((k) => k.startsWith('bitchat-dm-messages-store'))!;
  const blob = mockAsync.get(key)!;
  useBitchatDmMessagesStore.setState({ byPeer: {} });
  await settle();
  mockAsync.set(key, blob);
  await useBitchatDmMessagesStore.persist.rehydrate();
  await settle();
  return { key, blob };
}

// The module-load reads ran before the in-memory disk existed; one good read
// of each store lets them save again, as after a normal launch.
beforeAll(async () => {
  // As at launch, once the migrations have run.
  signalMigrationsComplete();
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [{ accountIndex: 0, pubkey: PUBKEY, addedAt: 1 }],
  });
  await useProfileStore.persist.rehydrate();
  useProfileStore.setState({
    activeAccountIndex: 0,
    profiles: [{ accountIndex: 0, pubkey: PUBKEY, addedAt: 1 }],
  });
  await useBitchatDmMessagesStore.persist.rehydrate();
  await settle();
});

beforeEach(async () => {
  useBitchatDmMessagesStore.setState({ byPeer: {} });
  await settle();
});

describe('threads', () => {
  it('keeps inbound messages per peer, in timestamp order, skipping a repeated id', () => {
    store().appendIncoming(incoming('m2', 200));
    store().appendIncoming(incoming('m1', 100));
    store().appendIncoming(incoming('m2', 200));
    store().appendIncoming(incoming('b1', 150, PEER_B));

    expect(thread().map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(thread(PEER_B).map((m) => m.id)).toEqual(['b1']);
    expect(thread()[0]).toEqual({
      id: 'm1',
      content: 'hi m1',
      sender: 'anon1234',
      senderId: PEER_A,
      timestamp: 100,
      isPrivate: true,
      isOwn: false,
    });
  });

  it('keeps only the newest 500 messages of a thread', () => {
    for (let i = 0; i < 502; i += 1) store().appendIncoming(incoming(`m${i}`, i));

    expect(thread()).toHaveLength(500);
    expect(thread()[0].id).toBe('m2');
    expect(thread()[499].id).toBe('m501');
  });
});

describe('delivery status', () => {
  it('moves a sent message forward and never back', () => {
    store().appendOutgoing(outgoing('o1', 1), PEER_A);
    status('o1', 'sent');
    expect(thread()[0]).toMatchObject({ deliveryStatus: 'sent', isPending: false });

    status('o1', 'delivered');
    status('o1', 'sent');
    expect(thread()[0].deliveryStatus).toBe('delivered');

    status('o1', 'read');
    status('o1', 'delivered');
    expect(thread()[0].deliveryStatus).toBe('read');
  });

  it('an unconfirmed message refuses a late sending and takes a native failure, then a delivery', () => {
    store().appendOutgoing(outgoing('o1', 1), PEER_A);
    expect(store().markTimedOut('o1')).toBe(true);
    status('o1', 'sending');
    expect(thread()[0]).toMatchObject({ deliveryStatus: 'failed', failureReason: 'timeout' });

    status('o1', 'failed', 'peer_unreachable');
    expect(thread()[0]).toMatchObject({
      deliveryStatus: 'failed',
      failureReason: 'peer_unreachable',
    });
    status('o1', 'delivered');
    expect(thread()[0]).toMatchObject({ deliveryStatus: 'delivered', isPending: false });
    expect(thread()[0].failureReason).toBeUndefined();
  });

  it.each(['delivered', 'read'] as const)(
    'a failure keeps its reason, and a later %s report wins over it (the report is proof)',
    (report) => {
      store().appendOutgoing(outgoing('o1', 1), PEER_A);
      status('o1', 'failed', 'peer_unreachable');
      expect(thread()[0]).toMatchObject({
        deliveryStatus: 'failed',
        failureReason: 'peer_unreachable',
      });
      status('o1', 'failed', 'other_reason');
      expect(thread()[0].failureReason).toBe('other_reason');

      status('o1', report);
      expect(thread()[0]).toMatchObject({ deliveryStatus: report, isPending: false });
      expect(thread()[0].failureReason).toBeUndefined();

      // A failure, a sent or a sending after it moves it no more.
      status('o1', 'failed', 'peer_unreachable');
      status('o1', 'sent');
      status('o1', 'sending');
      expect(thread()[0].deliveryStatus).toBe(report);
    }
  );

  it('a late failure leaves a message the peer acknowledged delivered or read', () => {
    store().appendOutgoing(outgoing('o1', 1), PEER_A);
    store().appendOutgoing(outgoing('o2', 2), PEER_A);
    status('o1', 'delivered');
    status('o2', 'read');
    status('o1', 'failed', 'peer_unreachable');
    status('o2', 'failed', 'peer_unreachable');

    // Delivered is final: the peer's acknowledgement outranks any later failure.
    expect(thread().map((m) => [m.deliveryStatus, m.failureReason])).toEqual([
      ['delivered', undefined],
      ['read', undefined],
    ]);
  });

  it('a partial delivery counts as sent', () => {
    store().appendOutgoing(outgoing('o1', 1), PEER_A);
    status('o1', 'partiallyDelivered');
    expect(thread()[0].deliveryStatus).toBe('sent');
  });

  it('a status for an unknown message changes nothing', () => {
    store().appendOutgoing(outgoing('o1', 1), PEER_A);
    const before = store().byPeer;
    status('nope', 'delivered');
    expect(store().byPeer).toBe(before);
  });

  it('a status reaches the message whichever peer’s thread holds it', () => {
    store().appendIncoming(incoming('a', 1));
    store().appendOutgoing(outgoing('o-b', 2), PEER_B);
    status('o-b', 'delivered');

    expect(thread(PEER_B)[0].deliveryStatus).toBe('delivered');
    expect(thread()[0]).not.toHaveProperty('deliveryStatus');
  });
});

describe('after a restart', () => {
  it('saves the threads under the active profile’s key', async () => {
    store().appendIncoming(incoming('a', 1));
    const { key, blob } = await relaunch();

    expect(key).toBe(`bitchat-dm-messages-store:profile:${PUBKEY}`);
    expect(JSON.parse(blob).state.byPeer[PEER_A]).toHaveLength(1);
  });

  it('turns sending and sent messages into failed app_restart and keeps the rest', async () => {
    store().appendIncoming(incoming('in', 1));
    store().appendOutgoing(outgoing('sending', 2), PEER_A);
    store().appendOutgoing(outgoing('sent', 3), PEER_A);
    store().appendOutgoing(outgoing('delivered', 4), PEER_A);
    store().appendOutgoing(outgoing('read', 5), PEER_B);
    status('sent', 'sent');
    status('delivered', 'delivered');
    status('read', 'read');

    await relaunch();

    // Both are saved as failed with reason app_restart, as every release has
    // written them; that reads back as unconfirmed, not as a final failure.
    expect(thread().map((m) => [m.id, m.deliveryStatus, m.failureReason, m.isPending])).toEqual([
      ['in', undefined, undefined, undefined],
      ['sending', 'failed', 'app_restart', false],
      ['sent', 'failed', 'app_restart', false],
      ['delivered', 'delivered', undefined, false],
    ]);
    expect(thread(PEER_B)[0].deliveryStatus).toBe('read');

    status('sent', 'delivered');
    expect(thread()[2]).toMatchObject({ deliveryStatus: 'delivered', isPending: false });
    expect(thread()[2]).not.toHaveProperty('failureReason', 'app_restart');
  });

  it('reads back every saved status and reason, and writes back only the restart demotion', async () => {
    store().appendIncoming(incoming('seed', 0));
    await settle();
    const key = [...mockAsync.keys()].find((k) => k.startsWith('bitchat-dm-messages-store'))!;
    const saved = JSON.parse(mockAsync.get(key)!);
    const own = (id: string, deliveryStatus: string, failureReason?: string) => ({
      ...outgoing(id, 1),
      isPending: deliveryStatus === 'sending',
      deliveryStatus,
      ...(failureReason ? { failureReason } : {}),
    });
    saved.state.byPeer = {
      [PEER_A]: [
        own('sending', 'sending'),
        own('sent', 'sent'),
        own('delivered', 'delivered'),
        own('read', 'read'),
        own('timeout', 'failed', 'timeout'),
        own('restart', 'failed', 'app_restart'),
        own('native', 'failed', 'handshake-timeout'),
        own('bare', 'failed'),
      ],
    };
    useBitchatDmMessagesStore.setState({ byPeer: {} });
    await settle();
    mockAsync.set(key, JSON.stringify(saved));
    await useBitchatDmMessagesStore.persist.rehydrate();
    await settle();

    const rows = (list: BleDmMessage[]) =>
      list.map((m) => [m.id, m.deliveryStatus, m.failureReason, m.isPending]);
    const expected = [
      ['sending', 'failed', 'app_restart', false],
      ['sent', 'failed', 'app_restart', false],
      ['delivered', 'delivered', undefined, false],
      ['read', 'read', undefined, false],
      ['timeout', 'failed', 'timeout', false],
      ['restart', 'failed', 'app_restart', false],
      ['native', 'failed', 'handshake-timeout', false],
      ['bare', 'failed', undefined, false],
    ];
    expect(rows(thread())).toEqual(expected);
    expect(rows(JSON.parse(mockAsync.get(key)!).state.byPeer[PEER_A])).toEqual(expected);

    // A late delivery wins over every saved failure, an unconfirmed one (a
    // saved timeout or restart) and a native one alike: the report is proof.
    for (const m of thread()) status(m.id, 'delivered');
    expect(thread().map((m) => m.deliveryStatus)).toEqual([
      'delivered',
      'delivered',
      'delivered',
      'read',
      'delivered',
      'delivered',
      'delivered',
      'delivered',
    ]);
  });

  it('loads a saved status this release does not know as failed', async () => {
    store().appendOutgoing({ ...outgoing('o1', 1), deliveryStatus: 'delivered' }, PEER_A);
    await settle();
    const key = [...mockAsync.keys()].find((k) => k.startsWith('bitchat-dm-messages-store'))!;
    const saved = JSON.parse(mockAsync.get(key)!);
    saved.state.byPeer[PEER_A][0].deliveryStatus = 'queued-v2';
    useBitchatDmMessagesStore.setState({ byPeer: {} });
    await settle();
    mockAsync.set(key, JSON.stringify(saved));
    await useBitchatDmMessagesStore.persist.rehydrate();

    expect(thread()[0].deliveryStatus).toBe('failed');
    expect(thread()[0].content).toBe('out o1');
  });
});
