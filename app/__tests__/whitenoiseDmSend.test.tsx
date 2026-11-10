/**
 * @jest-environment node
 *
 * `useWhitenoiseDM`, the 1:1 White Noise conversation: what opening it reads,
 * what the first send creates, stores and publishes, what a send into an
 * existing group does, how incoming group messages land, and what each
 * failure leaves behind.
 *
 * The Marmot (MLS) client and its groups are replaced at the app's own
 * boundary, the `WhitenoiseContext` value: a fake client with `loadAllGroups`,
 * `getGroup`, `createGroup` and a network, and fake groups that record
 * invites, sends and ingests. marmot-ts ships untranspiled ESM, so its two
 * runtime helpers are replaced. The DM index is the real one over an
 * in-memory AsyncStorage, so the saved key and envelope are observed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { WhitenoiseContext } from '@/features/whitenoise/WhitenoiseContext';
import { useWhitenoiseDM } from '@/features/whitenoise/hooks/useWhitenoiseDM';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@internet-privacy/marmot-ts', () => ({
  deserializeApplicationRumor: (bytes: Uint8Array) => {
    const rumor = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof rumor?.content !== 'string') throw new Error('not a rumor');
    return rumor;
  },
  getNostrGroupIdHex: (state: { nostrGroupIdHex: string }) => state.nostrGroupIdHex,
}));
let mockKeys: { pubkey: string } | null = null;
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { wnLog: log, log, storeLog: log, redactError: (e: unknown) => e };
});

const SELF = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const PROVIDER_RELAYS = ['wss://app-one.example', 'wss://app-two.example'];
const INDEX_KEY = `whitenoise:0:dm-index:${PEER}`;

type Rumor = { id?: string; pubkey: string; content: string; created_at: number };
type Listener = (bytes: Uint8Array) => void;

const encode = (rumor: Rumor) => new TextEncoder().encode(JSON.stringify(rumor));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeGroup(idBytes: number[], opts: { relays?: string[]; stored?: Rumor[] } = {}) {
  const listeners = new Set<Listener>();
  const group = {
    id: new Uint8Array(idBytes),
    relays: opts.relays ?? [],
    state: { nostrGroupIdHex: `nostr-${idBytes.join('')}` },
    history: { loadMessages: jest.fn(async () => (opts.stored ?? []).map((rumor) => ({ rumor }))) },
    on: jest.fn((name: string, fn: Listener) => {
      if (name === 'applicationMessage') listeners.add(fn);
    }),
    off: jest.fn((name: string, fn: Listener) => {
      if (name === 'applicationMessage') listeners.delete(fn);
    }),
    ingest: jest.fn(async function* (_events: unknown[]) {
      yield undefined;
    }),
    inviteByKeyPackageEvent: jest.fn(async (_event: unknown) => undefined),
    sendChatMessage: jest.fn(async (_text: string) => undefined),
    emit: (rumor: Rumor) => listeners.forEach((fn) => fn(encode(rumor))),
    emitBytes: (bytes: Uint8Array) => listeners.forEach((fn) => fn(bytes)),
    listenerCount: () => listeners.size,
  };
  return group;
}
type FakeGroup = ReturnType<typeof makeGroup>;

const KEY_PACKAGE_EVENT = { id: 'kp-event', kind: 443, pubkey: PEER };

function makeClient() {
  const subscriptionNext: ((event: unknown) => void)[] = [];
  const unsubscribe = jest.fn();
  const groups = new Map<string, FakeGroup>();
  const client = {
    loadAllGroups: jest.fn(async () => undefined),
    getGroup: jest.fn(async (hex: string) => groups.get(hex)),
    createGroup: jest.fn(async (_name: string, _opts: unknown) => makeGroup([0xc0, 0xde])),
    network: {
      getUserInboxRelays: jest.fn(async (_pubkey: string) => ['wss://peer-inbox.example']),
      request: jest.fn(async (_relays: string[], _filters: unknown) => [KEY_PACKAGE_EVENT]),
      subscription: jest.fn((_relays: string[], _filters: unknown) => ({
        subscribe: (observer: { next: (event: unknown) => void }) => {
          subscriptionNext.push(observer.next);
          return { unsubscribe };
        },
      })),
    },
  };
  return { client, groups, subscriptionNext, unsubscribe };
}

let fake: ReturnType<typeof makeClient>;
let contextClient: ReturnType<typeof makeClient>['client'] | null;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <WhitenoiseContext.Provider
      value={{
        client: contextClient as never,
        inviteReader: null,
        relays: PROVIDER_RELAYS,
        accountIndex: 0,
      }}>
      {children}
    </WhitenoiseContext.Provider>
  );
}

async function mount(peer = PEER) {
  const view = renderHook(() => useWhitenoiseDM(peer), { wrapper });
  await act(async () => undefined);
  return view;
}

async function seedIndex(groupIdHex: string) {
  await AsyncStorage.setItem(INDEX_KEY, JSON.stringify({ v: 1, d: groupIdHex }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockKeys = { pubkey: SELF };
  fake = makeClient();
  contextClient = fake.client;
});

describe('opening a conversation', () => {
  it('with no saved group: loads all groups, finds none and shows an empty, settled thread', async () => {
    const { result } = await mount();

    expect(fake.client.loadAllGroups).toHaveBeenCalledTimes(1);
    expect(fake.client.getGroup).not.toHaveBeenCalled();
    expect(fake.client.network.subscription).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      isClientReady: true,
      isLoading: false,
      isCreatingGroup: false,
      error: null,
      hasGroup: false,
      messages: [],
    });
  });

  it('with a saved group: opens it, shows its saved history oldest first and subscribes to kind 445 by its Nostr id', async () => {
    const group = makeGroup([0x01, 0x02], {
      relays: ['wss://group.example'],
      stored: [
        { id: 'm2', pubkey: PEER, content: 'second', created_at: 200 },
        { pubkey: SELF, content: 'first, no id', created_at: 100 },
      ],
    });
    fake.groups.set('0102', group);
    await seedIndex('0102');

    const { result } = await mount();

    expect(fake.client.getGroup).toHaveBeenCalledWith('0102');
    expect(result.current.hasGroup).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toEqual([
      {
        id: `wn-100-${SELF.slice(0, 8)}`,
        authorPubkey: SELF,
        content: 'first, no id',
        createdAtSec: 100,
        isSelf: true,
      },
      { id: 'm2', authorPubkey: PEER, content: 'second', createdAtSec: 200, isSelf: false },
    ]);
    expect(fake.client.network.subscription).toHaveBeenCalledWith(
      ['wss://group.example'],
      [{ kinds: [445], '#h': ['nostr-12'] }]
    );
  });

  it("subscribes on the provider's relays when the group names none", async () => {
    fake.groups.set('0102', makeGroup([0x01, 0x02]));
    await seedIndex('0102');

    await mount();

    expect(fake.client.network.subscription).toHaveBeenCalledWith(PROVIDER_RELAYS, [
      { kinds: [445], '#h': ['nostr-12'] },
    ]);
  });

  it('keeps the group but shows no history when the saved history cannot be read', async () => {
    const group = makeGroup([0x01, 0x02]);
    group.history.loadMessages.mockRejectedValue(new Error('corrupt'));
    fake.groups.set('0102', group);
    await seedIndex('0102');

    const { result } = await mount();

    expect(result.current).toMatchObject({
      hasGroup: true,
      messages: [],
      error: null,
      isLoading: false,
    });
  });

  it('shows the load error when the groups cannot be loaded', async () => {
    fake.client.loadAllGroups.mockRejectedValue(new Error('group state unreadable'));

    const { result } = await mount();

    expect(result.current).toMatchObject({
      hasGroup: false,
      isLoading: false,
      error: 'group state unreadable',
    });
  });

  it('with no client: is settled and not ready, and a send reports the client is not ready', async () => {
    contextClient = null;
    const { result } = await mount();

    expect(result.current).toMatchObject({ isClientReady: false, isLoading: false });
    await act(async () => {
      await result.current.send('hi');
    });
    expect(result.current.error).toBe('White Noise client not ready');
    expect(result.current.messages).toEqual([]);
  });

  it('unsubscribes and stops listening to the group on unmount', async () => {
    const group = makeGroup([0x01, 0x02]);
    fake.groups.set('0102', group);
    await seedIndex('0102');
    const { unmount } = await mount();
    expect(group.listenerCount()).toBe(1);

    unmount();

    expect(group.listenerCount()).toBe(0);
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('the first send creates the group', () => {
  it("looks up the peer's key package on their inbox relays, creates and invites, saves the index, then sends", async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.send('hello');
    });

    expect(fake.client.network.getUserInboxRelays).toHaveBeenCalledWith(PEER);
    expect(fake.client.network.request).toHaveBeenCalledWith(
      ['wss://peer-inbox.example'],
      [{ kinds: [443], authors: [PEER], limit: 1 }]
    );
    expect(fake.client.createGroup).toHaveBeenCalledWith(`dm:${PEER.slice(0, 16)}`, {
      description: 'White Noise 1:1 DM',
      relays: PROVIDER_RELAYS,
    });
    const created = (await fake.client.createGroup.mock.results[0]!.value) as FakeGroup;
    expect(created.inviteByKeyPackageEvent).toHaveBeenCalledWith(KEY_PACKAGE_EVENT);
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBe('{"v":1,"d":"c0de"}');
    expect(created.sendChatMessage).toHaveBeenCalledWith('hello');

    const order = [
      created.inviteByKeyPackageEvent.mock.invocationCallOrder[0]!,
      created.sendChatMessage.mock.invocationCallOrder[0]!,
    ];
    expect(order[0]).toBeLessThan(order[1]);

    expect(result.current).toMatchObject({ hasGroup: true, isCreatingGroup: false, error: null });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      authorPubkey: SELF,
      content: 'hello',
      isSelf: true,
      isPending: false,
    });
    expect(result.current.messages[0]!.id).toMatch(/^pending-/);
  });

  it('falls back to the provider relays for the key package when the inbox lookup throws', async () => {
    fake.client.network.getUserInboxRelays.mockRejectedValue(new Error('relay timeout'));
    const { result } = await mount();

    await act(async () => {
      await result.current.send('hello');
    });

    expect(fake.client.network.request).toHaveBeenCalledWith(PROVIDER_RELAYS, expect.anything());
    expect(fake.client.createGroup).toHaveBeenCalledTimes(1);
  });

  it('shows the message as pending while the group send is in flight and creating while the group is made', async () => {
    const creating = deferred<FakeGroup>();
    fake.client.createGroup.mockReturnValueOnce(creating.promise);
    const { result } = await mount();

    let sending!: Promise<unknown>;
    act(() => {
      sending = result.current.send('hello');
    });
    await act(async () => undefined);
    expect(result.current.isCreatingGroup).toBe(true);
    expect(result.current.messages).toEqual([]);

    const group = makeGroup([0xc0, 0xde]);
    const sent = deferred<undefined>();
    group.sendChatMessage.mockReturnValueOnce(sent.promise);
    await act(async () => {
      creating.resolve(group);
    });
    expect(result.current.isCreatingGroup).toBe(false);
    expect(result.current.messages).toEqual([expect.objectContaining({ isPending: true })]);

    await act(async () => {
      sent.resolve(undefined);
      await sending;
    });
    expect(result.current.messages).toEqual([expect.objectContaining({ isPending: false })]);
  });

  it('a second tap while the first send is in flight is dropped: one group, one message', async () => {
    const creating = deferred<FakeGroup>();
    fake.client.createGroup.mockReturnValueOnce(creating.promise);
    const { result } = await mount();

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.send('hello');
      second = result.current.send('hello');
    });
    await act(async () => {
      creating.resolve(makeGroup([0xc0, 0xde]));
      await first;
    });

    await expect(second).resolves.toBeUndefined();
    expect(fake.client.createGroup).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toHaveLength(1);
  });

  it('stops before creating anything when the peer has no key package, and shows why', async () => {
    fake.client.network.request.mockResolvedValue([]);
    const { result } = await mount();

    await act(async () => {
      await result.current.send('hello');
    });

    expect(fake.client.createGroup).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBeNull();
    expect(result.current).toMatchObject({
      error: "Recipient hasn't published a White Noise key package yet.",
      hasGroup: false,
      isCreatingGroup: false,
      messages: [],
    });
  });

  it('an invite failure after the group exists saves no index and sends nothing; the next send creates another group', async () => {
    const orphan = makeGroup([0x0f, 0x0f]);
    orphan.inviteByKeyPackageEvent.mockRejectedValue(new Error('publish welcome failed'));
    fake.client.createGroup.mockResolvedValueOnce(orphan);
    const { result } = await mount();

    await act(async () => {
      await result.current.send('hello');
    });

    expect(orphan.sendChatMessage).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBeNull();
    expect(result.current).toMatchObject({
      error: 'publish welcome failed',
      hasGroup: false,
      isCreatingGroup: false,
      messages: [],
    });

    // QUIRK: the first group stays created in the Marmot client with nothing
    // pointing at it, and the retry creates (and invites into) a second one.
    await act(async () => {
      await result.current.send('hello');
    });
    expect(fake.client.createGroup).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBe('{"v":1,"d":"c0de"}');
    expect(result.current.error).toBeNull();
  });

  it('ignores blank text without touching the network', async () => {
    const { result } = await mount();

    await act(async () => {
      await result.current.send('   ');
    });

    expect(fake.client.network.request).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('with no Nostr key: reports it and creates nothing', async () => {
    mockKeys = null;
    const { result } = await mount();

    await act(async () => {
      await result.current.send('hello');
    });

    expect(fake.client.createGroup).not.toHaveBeenCalled();
    expect(result.current.error).toBe('No active Nostr key');
  });
});

describe('a send into an existing group', () => {
  async function mountWithGroup() {
    const group = makeGroup([0x01, 0x02]);
    fake.groups.set('0102', group);
    await seedIndex('0102');
    const view = await mount();
    return { ...view, group };
  }

  it('sends through the saved group without a key-package lookup or a new group', async () => {
    const { result, group } = await mountWithGroup();

    await act(async () => {
      await result.current.send('again');
    });

    expect(fake.client.network.request).not.toHaveBeenCalled();
    expect(fake.client.createGroup).not.toHaveBeenCalled();
    expect(group.sendChatMessage).toHaveBeenCalledWith('again');
    expect(result.current.messages).toEqual([
      expect.objectContaining({ content: 'again', isSelf: true, isPending: false }),
    ]);
  });

  it('a failed group send removes the message and shows the error; the group and index stay', async () => {
    const { result, group } = await mountWithGroup();
    group.sendChatMessage.mockRejectedValue(new Error('no relay accepted'));

    await act(async () => {
      await result.current.send('lost');
    });

    // QUIRK: the text is not kept anywhere: the optimistic row is dropped and
    // only the error string remains, so the person must retype the message.
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBe('no relay accepted');
    expect(result.current.hasGroup).toBe(true);
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBe('{"v":1,"d":"0102"}');
  });

  it('the next send clears the previous error', async () => {
    const { result, group } = await mountWithGroup();
    group.sendChatMessage.mockRejectedValueOnce(new Error('no relay accepted'));
    await act(async () => {
      await result.current.send('lost');
    });

    await act(async () => {
      await result.current.send('kept');
    });

    expect(result.current.error).toBeNull();
    expect(result.current.messages.map((m) => m.content)).toEqual(['kept']);
  });
});

describe('incoming group messages', () => {
  async function mountWithGroup(stored: Rumor[] = []) {
    const group = makeGroup([0x01, 0x02], { stored });
    fake.groups.set('0102', group);
    await seedIndex('0102');
    const view = await mount();
    return { ...view, group };
  }

  it('hands each subscription event to the group to ingest', async () => {
    const { group } = await mountWithGroup();
    const event = { id: 'e1', kind: 445 };

    await act(async () => {
      fake.subscriptionNext[0]!(event);
    });

    expect(group.ingest).toHaveBeenCalledWith([event]);
  });

  it('inserts each decoded message by time and ignores one it already shows', async () => {
    const { result, group } = await mountWithGroup([
      { id: 'old', pubkey: PEER, content: 'old', created_at: 100 },
      { id: 'new', pubkey: PEER, content: 'new', created_at: 300 },
    ]);

    act(() => {
      group.emit({ id: 'mid', pubkey: PEER, content: 'mid', created_at: 200 });
      group.emit({ id: 'old', pubkey: PEER, content: 'old again', created_at: 100 });
      group.emit({ id: 'mine', pubkey: SELF, content: 'from my other device', created_at: 400 });
    });

    expect(result.current.messages.map((m) => [m.id, m.content, m.isSelf])).toEqual([
      ['old', 'old', false],
      ['mid', 'mid', false],
      ['new', 'new', false],
      ['mine', 'from my other device', true],
    ]);
  });

  it('drops bytes that do not decode as a rumor and keeps the thread', async () => {
    const { result, group } = await mountWithGroup([
      { id: 'old', pubkey: PEER, content: 'old', created_at: 100 },
    ]);

    act(() => {
      group.emitBytes(new TextEncoder().encode('{"nope":1}'));
    });

    expect(result.current.messages.map((m) => m.id)).toEqual(['old']);
  });
});
