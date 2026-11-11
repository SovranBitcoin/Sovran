/**
 * @jest-environment node
 *
 * The White Noise invite path: `useWhitenoiseInbox`, the account-lifetime
 * gift-wrap subscription that feeds marmot-ts's InviteReader and saves a
 * cursor, and `useWhitenoiseRequests`, the request list with accept and
 * decline. Pinned: what the inbox subscribes to and from where, what it does
 * with each event and the cursor, what a start failure does (F184), how an
 * invite becomes a request, and what accept and decline call, save and leave
 * behind when a step fails.
 *
 * The Marmot client and InviteReader are fakes handed in through the app's
 * own `WhitenoiseContext`. Storage is the real envelope backend over an
 * in-memory AsyncStorage. Navigation is replaced at `guardedRouter`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { wnLog } from '@/shared/lib/logger';
import { WhitenoiseContext } from '@/features/whitenoise/WhitenoiseContext';
import { relays } from '@/shared/ndk';
import { useWhitenoiseInbox } from '@/features/whitenoise/hooks/useWhitenoiseInbox';
import {
  useWhitenoiseRequests,
  type WhitenoiseRequest,
} from '@/features/whitenoise/hooks/useWhitenoiseRequests';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@internet-privacy/marmot-ts', () => ({}));
let mockKeys: { pubkey: string } | null = null;
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
const mockPush = jest.fn();
jest.mock('@/shared/hooks/useGuardedRouter', () => ({
  guardedRouter: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { wnLog: log, log, storeLog: log, redactError: (e: unknown) => e };
});

const SELF = 'a'.repeat(64);
const INVITER = 'c'.repeat(64);
const OTHER = 'd'.repeat(64);
/** The app's relays, which the provider hands White Noise. */
const PROVIDER_RELAYS = relays;
const CURSOR_KEY = 'whitenoise:2:inbox-cursor:last-seen-at';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Invite = { id: string; pubkey: string; created_at: number };

function makeReader(unread: Invite[] = []) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    unread,
    getUnread: jest.fn(async () => [...unread]),
    ingestEvent: jest.fn(async (_event: unknown) => true),
    decryptGiftWrap: jest.fn(async (_id: string) => ({ pubkey: INVITER })),
    markAsRead: jest.fn(async (id: string) => {
      const at = unread.findIndex((i) => i.id === id);
      if (at >= 0) unread.splice(at, 1);
    }),
    on: jest.fn((name: string, fn: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(fn);
    }),
    off: jest.fn((name: string, fn: () => void) => listeners.get(name)?.delete(fn)),
    emit: (name: string) => listeners.get(name)?.forEach((fn) => fn()),
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}
type FakeReader = ReturnType<typeof makeReader>;

type Joined = { group: { id: Uint8Array } };

function makeClient() {
  const next: ((event: unknown) => void)[] = [];
  const unsubscribe = jest.fn();
  return {
    next,
    unsubscribe,
    joinGroupFromWelcome: jest.fn(async (_args: unknown): Promise<Joined> => ({
      group: { id: new Uint8Array([0xab, 0xcd]) },
    })),
    network: {
      getUserInboxRelays: jest.fn(async (_pubkey: string) => ['wss://my-inbox.example']),
      subscription: jest.fn((_relays: string[], _filters: unknown) => ({
        subscribe: (observer: { next: (event: unknown) => void }) => {
          next.push(observer.next);
          return { unsubscribe };
        },
      })),
    },
  };
}
type FakeClient = ReturnType<typeof makeClient>;

let client: FakeClient | null;
let reader: FakeReader | null;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <WhitenoiseContext.Provider
      value={{
        client: client as never,
        inviteReader: reader as never,
        accountIndex: 2,
      }}>
      {children}
    </WhitenoiseContext.Provider>
  );
}

const flush = () => act(async () => undefined);
const giftWrap = (id: string, created_at: number, kind = 1059) => ({ id, kind, created_at });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  jest.mocked(AsyncStorage.setItem).mockClear();
  mockKeys = { pubkey: SELF };
  mockPush.mockReset();
  client = makeClient();
  reader = makeReader();
});

describe('the inbox subscription', () => {
  it('on a first start (no cursor) subscribes to every kind 1059 for me on my inbox relays', async () => {
    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    expect(client!.network.getUserInboxRelays).toHaveBeenCalledWith(SELF);
    expect(client!.network.subscription).toHaveBeenCalledWith(
      ['wss://my-inbox.example'],
      [{ kinds: [1059], '#p': [SELF] }]
    );
  });

  it('with a saved cursor subscribes from three days before it', async () => {
    await AsyncStorage.setItem(CURSOR_KEY, '{"v":1,"d":1700000000}');

    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    expect(client!.network.subscription).toHaveBeenCalledWith(
      ['wss://my-inbox.example'],
      [{ kinds: [1059], '#p': [SELF], since: 1_700_000_000 - 3 * 24 * 60 * 60 }]
    );
  });

  it('asks for an invitation dated two days before the newest gift wrap seen', async () => {
    // Senders move a gift wrap's date back by up to two days, so one sent
    // after the newest wrap seen can be dated well before it.
    const newestSeen = 1_700_000_000;
    const backdatedInvite = newestSeen - 2 * 24 * 60 * 60;
    await AsyncStorage.setItem(CURSOR_KEY, `{"v":1,"d":${newestSeen}}`);

    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    const [filter] = jest.mocked(client!.network.subscription).mock.calls[0][1] as {
      since: number;
    }[];
    expect(filter.since).toBeLessThanOrEqual(backdatedInvite);
  });

  it('never asks from before time zero', async () => {
    await AsyncStorage.setItem(CURSOR_KEY, '{"v":1,"d":1000}');

    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    expect(client!.network.subscription).toHaveBeenCalledWith(
      ['wss://my-inbox.example'],
      [{ kinds: [1059], '#p': [SELF], since: 0 }]
    );
  });

  it('falls back to the provider relays when the inbox lookup throws, and to a full backfill on an unreadable cursor', async () => {
    client!.network.getUserInboxRelays.mockRejectedValue(new Error('timeout'));
    await AsyncStorage.setItem(CURSOR_KEY, '1000');

    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    expect(client!.network.subscription).toHaveBeenCalledWith(PROVIDER_RELAYS, [
      { kinds: [1059], '#p': [SELF] },
    ]);
  });

  it('does not start without a client, a reader or a key', async () => {
    mockKeys = null;
    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();
    mockKeys = { pubkey: SELF };
    reader = null;
    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    expect(client!.network.getUserInboxRelays).not.toHaveBeenCalled();
    expect(client!.network.subscription).not.toHaveBeenCalled();
  });

  it('a failed cursor read is reported and the inbox starts with a full backfill', async () => {
    jest.mocked(AsyncStorage.getItem).mockClear();
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage closed'));
    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    expect(jest.mocked(wnLog.warn)).toHaveBeenCalledWith('whitenoise.inbox.cursor_read_failed', {
      error: 'storage closed',
    });
    // No cursor means no `since`: everything is fetched once, as on a first start.
    expect(client!.network.subscription).toHaveBeenCalledTimes(1);
    const filters = jest.mocked(client!.network.subscription).mock.calls[0][1] as object[];
    expect(filters[0]).not.toHaveProperty('since');
  });

  it('a start that fails before subscribing is reported, not left unhandled', async () => {
    jest.mocked(client!.network.subscription).mockImplementationOnce(() => {
      throw new Error('pool closed');
    });
    renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    expect(jest.mocked(wnLog.warn)).toHaveBeenCalledWith('whitenoise.inbox.start_failed', {
      error: 'pool closed',
    });
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();

    unmount();

    expect(client!.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('an unmount before the start finishes never subscribes', async () => {
    const lookup = deferred<string[]>();
    client!.network.getUserInboxRelays.mockReturnValueOnce(lookup.promise);
    const { unmount } = renderHook(() => useWhitenoiseInbox(), { wrapper });

    unmount();
    await act(async () => {
      lookup.resolve(['wss://late.example']);
    });

    expect(client!.network.subscription).not.toHaveBeenCalled();
  });
});

describe('each incoming gift wrap', () => {
  async function started() {
    const view = renderHook(() => useWhitenoiseInbox(), { wrapper });
    await flush();
    const deliver = async (event: unknown) => {
      await act(async () => {
        client!.next[0]!(event);
      });
    };
    return { ...view, deliver };
  }

  it('is ingested, then decrypted, and moves the saved cursor to its time', async () => {
    const { deliver } = await started();

    await deliver(giftWrap('gw1', 1_700));

    expect(reader!.ingestEvent).toHaveBeenCalledWith(giftWrap('gw1', 1_700));
    expect(reader!.decryptGiftWrap).toHaveBeenCalledWith('gw1');
    expect(reader!.ingestEvent.mock.invocationCallOrder[0]).toBeLessThan(
      reader!.decryptGiftWrap.mock.invocationCallOrder[0]!
    );
    expect(await AsyncStorage.getItem(CURSOR_KEY)).toBe('{"v":1,"d":1700}');
  });

  it('does not move a saved cursor it could not read', async () => {
    await AsyncStorage.setItem(CURSOR_KEY, '{"v":1,"d":2000}');
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage closed'));
    const { deliver } = await started();

    await deliver(giftWrap('old', 1_000));

    // The backfill replays older wraps; the unread cursor may be newer than any of them.
    expect(await AsyncStorage.getItem(CURSOR_KEY)).toBe('{"v":1,"d":2000}');
  });

  it('never moves the cursor backwards', async () => {
    await AsyncStorage.setItem(CURSOR_KEY, '{"v":1,"d":2000}');
    const { deliver } = await started();

    await deliver(giftWrap('older', 1_990));
    await deliver(giftWrap('newer', 2_100));
    await deliver(giftWrap('between', 2_050));

    expect(reader!.decryptGiftWrap.mock.calls.map(([id]) => id)).toEqual([
      'older',
      'newer',
      'between',
    ]);
    expect(await AsyncStorage.getItem(CURSOR_KEY)).toBe('{"v":1,"d":2100}');
  });

  it('a wrap the reader has already seen is not decrypted and does not move the cursor', async () => {
    reader!.ingestEvent.mockResolvedValue(false);
    const { deliver } = await started();

    await deliver(giftWrap('dup', 5_000));

    expect(reader!.decryptGiftWrap).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(CURSOR_KEY)).toBeNull();
  });

  it('wraps fetched again by the three-day look-back are not processed twice and leave the cursor alone', async () => {
    await AsyncStorage.setItem(CURSOR_KEY, '{"v":1,"d":1700000000}');
    // The reader keeps the ids it has seen on the phone, across restarts.
    reader!.ingestEvent.mockResolvedValue(false);
    const { deliver } = await started();

    await deliver(giftWrap('seen-yesterday', 1_700_000_000 - 24 * 60 * 60));
    await deliver(giftWrap('seen-newest', 1_700_000_000));

    expect(reader!.ingestEvent).toHaveBeenCalledTimes(2);
    expect(reader!.decryptGiftWrap).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(CURSOR_KEY)).toBe('{"v":1,"d":1700000000}');
  });

  it('ignores events of another kind or without an id', async () => {
    const { deliver } = await started();

    await deliver(giftWrap('dm', 1_000, 4));
    await deliver({ kind: 1059, created_at: 1_000 });

    expect(reader!.ingestEvent).not.toHaveBeenCalled();
  });

  it('a wrap that does not decrypt (not a Welcome) still keeps the cursor and the subscription', async () => {
    reader!.decryptGiftWrap.mockRejectedValueOnce(new Error('not a welcome'));
    const { deliver } = await started();

    await deliver(giftWrap('nip17', 3_000));
    await deliver(giftWrap('welcome', 3_001));

    expect(reader!.decryptGiftWrap.mock.calls.map(([id]) => id)).toEqual(['nip17', 'welcome']);
    expect(await AsyncStorage.getItem(CURSOR_KEY)).toBe('{"v":1,"d":3001}');
    expect(client!.unsubscribe).not.toHaveBeenCalled();
  });

  it('a wrap whose ingest finishes after unmount is not decrypted and does not move the cursor', async () => {
    const ingest = deferred<boolean>();
    reader!.ingestEvent.mockReturnValueOnce(ingest.promise);
    const { deliver, unmount } = await started();

    await deliver(giftWrap('late', 9_000));
    unmount();
    await act(async () => {
      ingest.resolve(true);
    });

    expect(reader!.decryptGiftWrap).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(CURSOR_KEY)).toBeNull();
  });
});

describe('the request list', () => {
  const invite = (id: string, pubkey: string, created_at: number): Invite => ({
    id,
    pubkey,
    created_at,
  });

  it('lists unread invites newest first as requests, and is not ready without a reader', async () => {
    reader = makeReader([invite('i1', INVITER, 100), invite('i2', OTHER, 300)]);
    const { result } = renderHook(() => useWhitenoiseRequests(), { wrapper });
    await flush();

    expect(result.current.isReady).toBe(true);
    expect(result.current.requests.map((r) => [r.id, r.fromPubkey, r.createdAtSec])).toEqual([
      ['i2', OTHER, 300],
      ['i1', INVITER, 100],
    ]);
    expect(result.current.requests[1]!.rumor).toEqual(invite('i1', INVITER, 100));

    reader = null;
    const empty = renderHook(() => useWhitenoiseRequests(), { wrapper });
    await flush();
    expect(empty.result.current).toMatchObject({ isReady: false, requests: [] });
  });

  it('re-reads the list when the reader reports a new invite or a read one', async () => {
    reader = makeReader([]);
    const { result } = renderHook(() => useWhitenoiseRequests(), { wrapper });
    await flush();
    expect(result.current.requests).toEqual([]);

    reader.unread.push(invite('i1', INVITER, 100));
    await act(async () => reader!.emit('newInvite'));
    expect(result.current.requests.map((r) => r.id)).toEqual(['i1']);

    reader.unread.splice(0);
    await act(async () => reader!.emit('inviteRead'));
    expect(result.current.requests).toEqual([]);
  });

  it('keeps the last list when a re-read fails', async () => {
    reader = makeReader([invite('i1', INVITER, 100)]);
    const { result } = renderHook(() => useWhitenoiseRequests(), { wrapper });
    await flush();
    reader.getUnread.mockRejectedValueOnce(new Error('storage'));

    await act(async () => reader!.emit('newInvite'));

    expect(result.current.requests.map((r) => r.id)).toEqual(['i1']);
  });

  it('stops listening on unmount', async () => {
    const { unmount } = renderHook(() => useWhitenoiseRequests(), { wrapper });
    await flush();
    expect(reader!.listenerCount()).toBe(2);

    unmount();

    expect(reader!.listenerCount()).toBe(0);
  });
});

describe('accepting and declining a request', () => {
  const INDEX_KEY = `whitenoise:2:dm-index:${INVITER}`;
  const theInvite = { id: 'i1', pubkey: INVITER, created_at: 100 };

  async function mountWithRequest() {
    reader = makeReader([theInvite]);
    const view = renderHook(() => useWhitenoiseRequests(), { wrapper });
    await flush();
    const request = view.result.current.requests[0] as WhitenoiseRequest;
    return { ...view, request };
  }

  it('accept joins from the Welcome, saves the peer in the DM index, marks it read and opens the chat', async () => {
    const { result, request } = await mountWithRequest();

    await act(async () => {
      await result.current.accept(request);
    });

    expect(client!.joinGroupFromWelcome).toHaveBeenCalledWith({ welcomeRumor: theInvite });
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBe('{"v":1,"d":"abcd"}');
    expect(reader!.markAsRead).toHaveBeenCalledWith('i1');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(user-flow)/whitenoiseDM',
      params: { pubkey: INVITER },
    });
    expect(result.current).toMatchObject({ busyId: null, error: null });
  });

  it('marks the request busy while accept runs', async () => {
    const join = deferred<Joined>();
    client!.joinGroupFromWelcome.mockReturnValueOnce(join.promise);
    const { result, request } = await mountWithRequest();

    let accepting!: Promise<unknown>;
    act(() => {
      accepting = result.current.accept(request);
    });
    expect(result.current.busyId).toBe('i1');

    await act(async () => {
      join.resolve({ group: { id: new Uint8Array([1]) } });
      await accepting;
    });
    expect(result.current.busyId).toBeNull();
  });

  it('a second accept tap while the first runs is dropped: one join', async () => {
    const join = deferred<Joined>();
    client!.joinGroupFromWelcome.mockReturnValueOnce(join.promise);
    const { result, request } = await mountWithRequest();

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = result.current.accept(request);
      second = result.current.accept(request);
    });
    await act(async () => {
      join.resolve({ group: { id: new Uint8Array([1]) } });
      await first;
    });

    await expect(second).resolves.toBeUndefined();
    expect(client!.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
  });

  it('a failed join saves nothing, leaves the request unread, stays put and shows the error', async () => {
    client!.joinGroupFromWelcome.mockRejectedValueOnce(new Error('key package gone'));
    const { result, request } = await mountWithRequest();

    await act(async () => {
      await result.current.accept(request);
    });

    expect(await AsyncStorage.getItem(INDEX_KEY)).toBeNull();
    expect(reader!.markAsRead).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ error: 'key package gone', busyId: null });
    expect(result.current.requests.map((r) => r.id)).toEqual(['i1']);
  });

  it('an index write failure after a successful join leaves the request unread and the group unindexed', async () => {
    const { result, request } = await mountWithRequest();
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));

    await act(async () => {
      await result.current.accept(request);
    });

    // QUIRK: the group is joined (its key package spent) but nothing points at
    // it, and the request stays in the list, so accepting again joins again.
    expect(client!.joinGroupFromWelcome).toHaveBeenCalledTimes(1);
    expect(reader!.markAsRead).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(result.current.error).toBe('disk full');
    expect(result.current.requests.map((r) => r.id)).toEqual(['i1']);
  });

  it('a mark-read failure after join and index keeps the index but does not open the chat', async () => {
    const { result, request } = await mountWithRequest();
    reader!.markAsRead.mockRejectedValueOnce(new Error('storage'));

    await act(async () => {
      await result.current.accept(request);
    });

    expect(await AsyncStorage.getItem(INDEX_KEY)).toBe('{"v":1,"d":"abcd"}');
    expect(mockPush).not.toHaveBeenCalled();
    expect(result.current.error).toBe('storage');
  });

  it('accept with no client reports it is not ready and joins nothing', async () => {
    client = null;
    const { result, request } = await mountWithRequest();

    await act(async () => {
      await result.current.accept(request);
    });

    expect(result.current.error).toBe('White Noise client not ready');
    expect(reader!.markAsRead).not.toHaveBeenCalled();
  });

  it('decline only marks it read: no join, no index, no navigation; the list re-reads', async () => {
    const { result, request } = await mountWithRequest();

    await act(async () => {
      await result.current.decline(request);
    });
    await act(async () => reader!.emit('inviteRead'));

    expect(reader!.markAsRead).toHaveBeenCalledWith('i1');
    expect(client!.joinGroupFromWelcome).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(INDEX_KEY)).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(result.current.requests).toEqual([]);
  });

  it('a failed decline shows the error and keeps the request', async () => {
    const { result, request } = await mountWithRequest();
    reader!.markAsRead.mockRejectedValueOnce(new Error('storage'));

    await act(async () => {
      await result.current.decline(request);
    });

    expect(result.current).toMatchObject({ error: 'storage', busyId: null });
    expect(result.current.requests.map((r) => r.id)).toEqual(['i1']);
  });

  it('a decline tapped while an accept runs is not blocked by it', async () => {
    const join = deferred<Joined>();
    client!.joinGroupFromWelcome.mockReturnValueOnce(join.promise);
    const { result, request } = await mountWithRequest();

    let accepting!: Promise<unknown>;
    act(() => {
      accepting = result.current.accept(request);
    });
    await act(async () => {
      await result.current.decline(request);
    });
    // QUIRK: accept and decline have separate guards, so the decline marks the
    // invite read mid-accept and clears the busy flag the accept set.
    expect(reader!.markAsRead).toHaveBeenCalledTimes(1);
    expect(result.current.busyId).toBeNull();

    await act(async () => {
      join.resolve({ group: { id: new Uint8Array([0xab, 0xcd]) } });
      await accepting;
    });
    expect(reader!.markAsRead).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
