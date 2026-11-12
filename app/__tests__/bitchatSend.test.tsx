/**
 * `useBitChat` send path, for each of its four transports: what a message
 * typed into the chat hands the native module, what row the person sees
 * (local buffer for public and Nostr chats, the saved DM store for BLE DMs),
 * and what a failed or stuck send leaves behind (F183).
 *
 * The native `bitchat-module` is replaced by recording fakes; the BLE DM
 * store is the real one over an in-memory AsyncStorage. Nickname, profile
 * scope and identity material are fixed at their hooks.
 */
import { AppState } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useBitChat } from '@/features/bitchat/hooks/useBitChat';
import { useBitchatDmMessagesStore } from '@/features/bitchat/stores/bitchatDmMessages';

type Listener = (event: Record<string, unknown>) => void;
const mockListeners: Record<string, Set<Listener>> = {};
const mockRelease = jest.fn();
function mockAddListener(name: string) {
  return (fn: Listener) => {
    (mockListeners[name] ??= new Set()).add(fn);
    return { remove: () => mockListeners[name]!.delete(fn) };
  };
}
const mockNative = {
  startBLE: jest.fn(async (_opts: unknown) => undefined),
  acquirePublicBLEMesh: jest.fn(() => mockRelease),
  sendBLEMessage: jest.fn(async (_content: string) => undefined),
  startBLEPrivateChat: jest.fn(async (_peer: string) => undefined),
  sendBLEPrivateMessage: jest.fn(async (args: { messageID: string }) => args.messageID),
  getBLEPeers: jest.fn((): unknown[] => []),
  getBLEState: jest.fn(() => 'poweredOn'),
  startNostr: jest.fn(async (_scope: string) => undefined),
  joinGeohash: jest.fn(async (_geohash: string) => undefined),
  sendGeohashMessage: jest.fn(async (_content: string, _nickname?: string) => undefined),
  sendGeohashPrivateMessage: jest.fn(async (_pubkey: string, _content: string) => undefined),
};
type NativeName = keyof typeof mockNative;
function mockForward(name: NativeName) {
  return (...args: unknown[]) => (mockNative[name] as (...a: unknown[]) => unknown)(...args);
}
jest.mock('bitchat-module', () => ({
  ...Object.fromEntries(
    [
      'startBLE',
      'acquirePublicBLEMesh',
      'sendBLEMessage',
      'startBLEPrivateChat',
      'sendBLEPrivateMessage',
      'getBLEPeers',
      'getBLEState',
      'startNostr',
      'joinGeohash',
      'sendGeohashMessage',
      'sendGeohashPrivateMessage',
    ].map((name) => [name, mockForward(name as NativeName)])
  ),
  addBLEMessageListener: mockAddListener('bleMessage'),
  addBLEPeerListener: mockAddListener('blePeer'),
  addBLEStateListener: mockAddListener('bleState'),
  addNostrMessageListener: mockAddListener('nostrMessage'),
  addNostrPrivateMessageListener: mockAddListener('nostrPrivate'),
}));
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
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  useBitchatNickname: () => 'Tester',
}));
const mockIdentity = { nostrPubkey: 'a'.repeat(64) };
jest.mock('@/features/bitchat/hooks/useBitchatBLEIdentityMaterial', () => ({
  useBitchatBLEIdentityMaterial: () => mockIdentity,
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  useBitchatProfileScope: () => 'profile-1',
  getBitchatProfileScope: () => 'profile-1',
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { bitchatLog: log, cashuLog: log, log, storeLog: log, redactError: (e: unknown) => e };
});

const GEOHASH = 'u4pruy';
const NOSTR_PEER = 'e'.repeat(64);
const BLE_PEER = '0123456789abcdef';
const NOW = 1_800_000_000_000;

function emit(name: string, event: Record<string, unknown>) {
  act(() => mockListeners[name]?.forEach((fn) => fn(event)));
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function mount(...args: Parameters<typeof useBitChat>) {
  const view = renderHook(() => useBitChat(...args));
  await act(async () => undefined);
  return view;
}

/**
 * Open a Bluetooth chat whose BLE start is still pending, switch the hook away
 * from it (to a public geohash chat with no geohash, which never connects),
 * then let the old start resolve.
 */
async function leaveBeforeBLEStarts(...args: Parameters<typeof useBitChat>) {
  const starting = deferred<undefined>();
  mockNative.startBLE.mockReturnValueOnce(starting.promise);
  const view = renderHook((props: Parameters<typeof useBitChat>) => useBitChat(...props), {
    initialProps: args,
  });
  await act(async () => undefined);
  expect(view.result.current.isConnected).toBe(false);
  view.rerender([{ transport: 'nostr' }]);
  await act(async () => {
    starting.resolve(undefined);
    await starting.promise;
  });
  return view;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.clearAllMocks();
  for (const key of Object.keys(mockListeners)) delete mockListeners[key];
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  useBitchatDmMessagesStore.setState({ byPeer: {} });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('public geohash chat (nostr)', () => {
  it('starts Nostr for the profile, joins the geohash and reports connected', async () => {
    const { result } = await mount({ transport: 'nostr', geohash: GEOHASH });

    expect(mockNative.startNostr).toHaveBeenCalledWith('profile-1');
    expect(mockNative.joinGeohash).toHaveBeenCalledWith(GEOHASH);
    expect(result.current.isConnected).toBe(true);
  });

  it('a send goes to sendGeohashMessage with the nickname and shows a pending, then sent, own row', async () => {
    const sending = deferred<undefined>();
    mockNative.sendGeohashMessage.mockReturnValueOnce(sending.promise);
    const { result } = await mount({ transport: 'nostr', geohash: GEOHASH });

    let done!: Promise<void>;
    act(() => {
      done = result.current.sendMessage('gm');
    });
    expect(mockNative.sendGeohashMessage).toHaveBeenCalledWith('gm', 'Tester');
    expect(result.current.messages).toEqual([
      expect.objectContaining({
        content: 'gm',
        sender: 'Tester',
        senderId: '',
        timestamp: NOW,
        isOwn: true,
        deliveryStatus: 'sending',
      }),
    ]);

    await act(async () => {
      sending.resolve(undefined);
      await done;
    });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ content: 'gm', deliveryStatus: 'sent' }),
    ]);
  });

  it('collapses the relay echo of an own message and drops messages for another geohash', async () => {
    const { result } = await mount({ transport: 'nostr', geohash: GEOHASH });
    await act(async () => {
      await result.current.sendMessage('gm');
    });

    emit('nostrMessage', {
      id: 'relay-echo',
      content: 'gm',
      sender: 'Tester',
      senderPubkey: 'f'.repeat(64),
      timestamp: NOW + 2_000,
      isOwn: true,
      geohash: GEOHASH,
    });
    emit('nostrMessage', {
      id: 'elsewhere',
      content: 'hi',
      sender: 'x',
      senderPubkey: 'd'.repeat(64),
      timestamp: NOW,
      isOwn: false,
      geohash: 'zzzzzz',
    });
    emit('nostrMessage', {
      id: 'peer-1',
      content: 'hello back',
      sender: 'anon',
      senderPubkey: NOSTR_PEER,
      timestamp: NOW + 3_000,
      isOwn: false,
      geohash: GEOHASH,
    });

    expect(result.current.messages.map((m) => [m.content, m.isOwn])).toEqual([
      ['gm', true],
      ['hello back', false],
    ]);
    expect(result.current.messages[1]).toMatchObject({ senderId: NOSTR_PEER });
  });

  it('a rejected native send removes the row and resolves without an error (F183)', async () => {
    mockNative.sendGeohashMessage.mockRejectedValueOnce(new Error('relay down'));
    const { result } = await mount({ transport: 'nostr', geohash: GEOHASH });

    let outcome!: Promise<void>;
    await act(async () => {
      outcome = result.current.sendMessage('lost words');
      await outcome;
    });

    // QUIRK: the text is gone and the caller (ChatScreen, which has already
    // cleared its draft) gets a plain resolve, so nothing tells the person.
    await expect(outcome).resolves.toBeUndefined();
    expect(result.current.messages).toEqual([]);
  });

  it('does not connect without a geohash', async () => {
    const { result } = await mount({ transport: 'nostr' });

    expect(mockNative.startNostr).not.toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
  });

  it('stays disconnected when joining the geohash fails', async () => {
    mockNative.joinGeohash.mockRejectedValueOnce(new Error('no relays'));
    const { result } = await mount({ transport: 'nostr', geohash: GEOHASH });

    expect(result.current.isConnected).toBe(false);
  });
});

describe('public Bluetooth chat (ble)', () => {
  it('takes a public mesh lease, starts BLE with the profile identity and releases the lease on unmount', async () => {
    const { result, unmount } = await mount({ transport: 'ble' });

    expect(mockNative.acquirePublicBLEMesh).toHaveBeenCalledTimes(1);
    expect(mockNative.startBLE).toHaveBeenCalledWith({
      nickname: 'Tester',
      profileScope: 'profile-1',
      identityMaterial: mockIdentity,
    });
    expect(result.current.isConnected).toBe(true);

    unmount();
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it('a BLE start that resolves after leaving the chat leaves it disconnected', async () => {
    const { result } = await leaveBeforeBLEStarts({ transport: 'ble' });
    expect(result.current.isConnected).toBe(false);
  });

  it('a send goes to sendBLEMessage and a mesh message arrives as a peer row', async () => {
    const { result } = await mount({ transport: 'ble' });

    await act(async () => {
      await result.current.sendMessage('hi mesh');
    });
    emit('bleMessage', {
      id: 'm1',
      content: 'hi back',
      sender: 'anon7',
      senderPeerID: BLE_PEER,
      timestamp: NOW + 1,
      isPrivate: false,
    });

    expect(mockNative.sendBLEMessage).toHaveBeenCalledWith('hi mesh');
    expect(result.current.messages.map((m) => [m.content, m.isOwn, m.senderId])).toEqual([
      ['hi mesh', true, ''],
      ['hi back', false, BLE_PEER],
    ]);
  });

  it('a rejected native send removes the row and resolves (F183)', async () => {
    mockNative.sendBLEMessage.mockRejectedValueOnce(new Error('mesh not started'));
    const { result } = await mount({ transport: 'ble' });

    await act(async () => {
      await expect(result.current.sendMessage('lost')).resolves.toBeUndefined();
    });

    expect(result.current.messages).toEqual([]);
  });
});

describe('Nostr direct message (nostr-dm)', () => {
  it('sends a gift-wrapped DM to the peer and keeps only that peer’s incoming messages', async () => {
    const { result } = await mount({ transport: 'nostr-dm', geohash: GEOHASH, peerID: NOSTR_PEER });
    expect(mockNative.joinGeohash).toHaveBeenCalledWith(GEOHASH);

    await act(async () => {
      await result.current.sendMessage('psst');
    });
    emit('nostrPrivate', {
      id: 'p1',
      content: 'from peer',
      sender: 'anon',
      senderPubkey: NOSTR_PEER,
      timestamp: NOW + 1,
      isOwn: false,
      geohash: GEOHASH,
    });
    emit('nostrPrivate', {
      id: 'p2',
      content: 'from someone else',
      sender: 'anon',
      senderPubkey: 'd'.repeat(64),
      timestamp: NOW + 2,
      isOwn: false,
      geohash: GEOHASH,
    });

    expect(mockNative.sendGeohashPrivateMessage).toHaveBeenCalledWith(NOSTR_PEER, 'psst');
    expect(result.current.messages.map((m) => [m.content, m.isOwn])).toEqual([
      ['psst', true],
      ['from peer', false],
    ]);
  });

  it('a peer id that is not a Nostr pubkey never reaches native and the row is dropped', async () => {
    const { result } = await mount({ transport: 'nostr-dm', geohash: GEOHASH, peerID: BLE_PEER });

    await act(async () => {
      await result.current.sendMessage('psst');
    });

    expect(mockNative.sendGeohashPrivateMessage).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it('a rejected native send removes the row and resolves (F183)', async () => {
    mockNative.sendGeohashPrivateMessage.mockRejectedValueOnce(new Error('relay down'));
    const { result } = await mount({ transport: 'nostr-dm', geohash: GEOHASH, peerID: NOSTR_PEER });

    await act(async () => {
      await expect(result.current.sendMessage('lost')).resolves.toBeUndefined();
    });

    expect(result.current.messages).toEqual([]);
  });
});

describe('Bluetooth direct message (ble-dm)', () => {
  const thread = () => useBitchatDmMessagesStore.getState().byPeer[BLE_PEER] ?? [];

  it('starts BLE and the Noise handshake with the peer on open', async () => {
    await mount({ transport: 'ble-dm', peerID: BLE_PEER });

    expect(mockNative.startBLE).toHaveBeenCalledTimes(1);
    expect(mockNative.startBLEPrivateChat).toHaveBeenCalledWith(BLE_PEER);
  });

  it('a BLE start that resolves after leaving the thread leaves it disconnected', async () => {
    const { result } = await leaveBeforeBLEStarts({ transport: 'ble-dm', peerID: BLE_PEER });
    expect(result.current.isConnected).toBe(false);
  });

  it('a send saves a sending row in the DM store, then hands native the same message id', async () => {
    const { result } = await mount({ transport: 'ble-dm', peerID: BLE_PEER });

    await act(async () => {
      await result.current.sendMessage('hello peer');
    });

    expect(thread()).toEqual([
      expect.objectContaining({
        content: 'hello peer',
        sender: 'Tester',
        senderId: '',
        timestamp: NOW,
        isPrivate: true,
        isOwn: true,
        isPending: true,
        deliveryStatus: 'sending',
      }),
    ]);
    const id = thread()[0]!.id;
    expect(id).toMatch(/^ble-dm-/);
    expect(mockNative.sendBLEPrivateMessage).toHaveBeenCalledWith({
      peerID: BLE_PEER,
      content: 'hello peer',
      nickname: 'Tester',
      messageID: id,
    });
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id, content: 'hello peer', deliveryStatus: 'sending' }),
    ]);
  });

  it('a native rejection marks the saved row failed with the reason and cancels the watchdog', async () => {
    mockNative.sendBLEPrivateMessage.mockRejectedValueOnce(new Error('peer unknown'));
    const { result } = await mount({ transport: 'ble-dm', peerID: BLE_PEER });

    await act(async () => {
      await result.current.sendMessage('hello peer');
    });

    expect(thread()).toEqual([
      expect.objectContaining({
        content: 'hello peer',
        deliveryStatus: 'failed',
        failureReason: 'peer unknown',
        isPending: false,
      }),
    ]);
    act(() => {
      jest.advanceTimersByTime(20_000);
    });
    expect(thread()[0]!.failureReason).toBe('peer unknown');
  });

  it('a row still sending after 15 s is marked failed with reason timeout', async () => {
    const { result } = await mount({ transport: 'ble-dm', peerID: BLE_PEER });
    await act(async () => {
      await result.current.sendMessage('hello peer');
    });

    act(() => {
      jest.advanceTimersByTime(14_999);
    });
    expect(thread()[0]!.deliveryStatus).toBe('sending');
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(thread()[0]).toMatchObject({ deliveryStatus: 'failed', failureReason: 'timeout' });
  });

  it('a row that reached sent before 15 s is left alone by the watchdog', async () => {
    const { result } = await mount({ transport: 'ble-dm', peerID: BLE_PEER });
    await act(async () => {
      await result.current.sendMessage('hello peer');
    });
    act(() => {
      useBitchatDmMessagesStore
        .getState()
        .applyDeliveryStatus({ messageID: thread()[0]!.id, status: 'sent' });
    });

    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    expect(thread()[0]).toMatchObject({ deliveryStatus: 'sent', isPending: false });
  });

  it('a late sent, then delivered, after the 15 s watchdog wins: the row shows delivered', async () => {
    const { result } = await mount({ transport: 'ble-dm', peerID: BLE_PEER });
    await act(async () => {
      await result.current.sendMessage('hello peer');
    });
    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    const messageID = thread()[0]!.id;

    expect(thread()[0]).toMatchObject({ deliveryStatus: 'failed', failureReason: 'timeout' });

    // The 15 s mark means "not confirmed yet": a later report wins.
    act(() => {
      useBitchatDmMessagesStore.getState().applyDeliveryStatus({ messageID, status: 'sent' });
    });
    expect(thread()[0]).toMatchObject({ deliveryStatus: 'sent', isPending: false });
    expect(thread()[0]).not.toHaveProperty('failureReason', 'timeout');
    act(() => {
      useBitchatDmMessagesStore.getState().applyDeliveryStatus({ messageID, status: 'delivered' });
    });
    expect(thread()[0]).toMatchObject({ deliveryStatus: 'delivered', isPending: false });
  });

  it('a retry of an unconfirmed message that is then reported delivered leaves two delivered copies', async () => {
    const { result } = await mount({ transport: 'ble-dm', peerID: BLE_PEER });
    await act(async () => {
      await result.current.sendMessage('hello peer');
    });
    act(() => {
      jest.advanceTimersByTime(15_000);
    });
    // "Tap to retry" sends the same text again as a new message.
    await act(async () => {
      await result.current.sendMessage('hello peer');
    });
    const [original, copy] = thread();

    act(() => {
      const store = useBitchatDmMessagesStore.getState();
      store.applyDeliveryStatus({ messageID: original!.id, status: 'delivered' });
      store.applyDeliveryStatus({ messageID: copy!.id, status: 'delivered' });
    });

    // The peer got the text twice; both rows show delivered and nothing marks
    // the second as a repeat.
    expect(thread().map((m) => [m.content, m.deliveryStatus])).toEqual([
      ['hello peer', 'delivered'],
      ['hello peer', 'delivered'],
    ]);
  });

  it('the watchdog fires after the chat is closed', async () => {
    const { result, unmount } = await mount({ transport: 'ble-dm', peerID: BLE_PEER });
    await act(async () => {
      await result.current.sendMessage('hello peer');
    });

    unmount();
    act(() => {
      jest.advanceTimersByTime(15_000);
    });

    expect(thread()[0]).toMatchObject({ deliveryStatus: 'failed', failureReason: 'timeout' });
  });
});
