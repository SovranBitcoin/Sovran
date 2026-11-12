/**
 * The BitChat bridge (`bitchat-module`'s TypeScript facade) and the account
 * provider that listens to it: how a BLE start and stop are checked and
 * queued, how a public-mesh lease restarts the mesh, how native events reach
 * JS listeners (and which are dropped), what changes when another account
 * starts, and what `BitchatBLEProvider` mounts and removes.
 *
 * The real facade runs; only the native module behind `requireNativeModule`
 * is a recording fake. The BLE DM store is the real one over an in-memory
 * AsyncStorage.
 */
import { Platform } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { useBitchatDmMessagesStore } from '@/features/bitchat/stores/bitchatDmMessages';

type NativeListener = (raw: unknown) => void;
const mockNativeListeners = new Map<string, Set<NativeListener>>();
const mockNative = {
  startBLE: jest.fn(async (..._args: unknown[]) => undefined),
  stopBLE: jest.fn(async () => undefined),
  getBLEPeers: jest.fn(() => []),
  getBLEState: jest.fn(() => 'poweredOn'),
  addListener: jest.fn((name: string, fn: NativeListener) => {
    if (!mockNativeListeners.has(name)) mockNativeListeners.set(name, new Set());
    mockNativeListeners.get(name)!.add(fn);
    return { remove: jest.fn(() => mockNativeListeners.get(name)!.delete(fn)) };
  }),
};
jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireNativeModule: () => mockNative,
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
jest.mock('@/features/nearPay/hooks/useNearbyDiscovery', () => ({ useNearbyDiscovery: jest.fn() }));
jest.mock('@/features/nearPay/hooks/useNutDropAutoRedeem', () => ({
  useNutDropAutoRedeem: jest.fn(),
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    bitchatLog: log,
    cashuLog: log,
    log,
    storeLog: log,
    redactError: (e: unknown) => e,
    initLog: jest.fn(),
    useInitMount: jest.fn(),
  };
});

// The Jest preset runs as web, where the facade loads no native module. The
// phone platforms are what ship, so the facade is loaded as iOS.
const JEST_PLATFORM = Platform.OS;
Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  acquirePublicBLEMesh,
  addBLEDeliveryStatusListener,
  addBLEMessageListener,
  addBLEPrivateMessageListener,
  isPublicBLEMesh,
  startBLE,
  stopBLE,
} = require('bitchat-module') as typeof import('bitchat-module');
const { BitchatBLEProvider } =
  require('@/shared/providers/BitchatBLEProvider') as typeof import('@/shared/providers/BitchatBLEProvider');
/* eslint-enable @typescript-eslint/no-require-imports */
Object.defineProperty(Platform, 'OS', { value: JEST_PLATFORM, configurable: true });

const HEX = (c: string) => c.repeat(64);
const IDENTITY = {
  version: 'sovran-bitchat-ble-v1' as const,
  nostrPubkey: HEX('a'),
  noisePrivateKeyHex: HEX('b'),
  signingPrivateKeyHex: HEX('c'),
};
const REQUEST = { nickname: 'Tester', profileScope: 'profile-0', identityMaterial: IDENTITY };
const PEER = '0123456789abcdef';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function emitNative(name: string, raw: unknown) {
  mockNativeListeners.get(name)?.forEach((fn) => fn(raw));
}
const listenerCount = (name: string) => mockNativeListeners.get(name)?.size ?? 0;
const walletDiscoveryArgs = () => mockNative.startBLE.mock.calls.map((args) => args[6]);

function privateMessage(id: string, profileScope?: string, content = `hi ${id}`) {
  return {
    id,
    peerID: PEER,
    sender: 'anon',
    content,
    timestamp: 1_000,
    isOwn: false,
    ...(profileScope ? { profileScope } : {}),
  };
}

beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

const leases: (() => void)[] = [];
beforeEach(async () => {
  while (leases.length) leases.pop()!();
  await stopBLE();
  jest.clearAllMocks();
  useBitchatDmMessagesStore.setState({ byPeer: {} });
});

describe('starting and stopping the mesh', () => {
  it('hands native the profile, the keys, the 02-prefixed favorite key, no request and wallet discovery on', async () => {
    await startBLE(REQUEST);

    expect(mockNative.startBLE).toHaveBeenCalledWith(
      'Tester',
      'profile-0',
      HEX('b'),
      HEX('c'),
      `02${HEX('a')}`,
      null,
      true
    );
  });

  it('passes a standing payment request when given one', async () => {
    await startBLE({ ...REQUEST, creq: 'creqA1' });

    expect(mockNative.startBLE.mock.calls[0]![5]).toBe('creqA1');
  });

  it.each([
    ['missing', null, 'BitChat identity material unavailable'],
    [
      'another version',
      { ...IDENTITY, version: 'v0' },
      'BitChat identity material has an unsupported version',
    ],
    [
      'a short noise key',
      { ...IDENTITY, noisePrivateKeyHex: 'ab' },
      'BitChat noise identity material is invalid',
    ],
    [
      'an upper-case signing key',
      { ...IDENTITY, signingPrivateKeyHex: 'C'.repeat(64) },
      'BitChat signing identity material is invalid',
    ],
  ])(
    'refuses identity material that is %s, without calling native',
    async (_, material, message) => {
      await expect(
        startBLE({ ...REQUEST, identityMaterial: material as typeof IDENTITY })
      ).rejects.toThrow(message);

      expect(mockNative.startBLE).not.toHaveBeenCalled();
    }
  );

  it('queues a stop behind a start still in flight', async () => {
    const starting = deferred<undefined>();
    mockNative.startBLE.mockReturnValueOnce(starting.promise);

    const started = startBLE(REQUEST);
    const stopped = stopBLE();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockNative.stopBLE).not.toHaveBeenCalled();

    starting.resolve(undefined);
    await started;
    await stopped;
    expect(mockNative.stopBLE).toHaveBeenCalledTimes(1);
  });

  it('a failed start still lets the queued stop run, and only the start rejects', async () => {
    mockNative.startBLE.mockRejectedValueOnce(new Error('bluetooth off'));

    const started = startBLE(REQUEST);
    const stopped = stopBLE();

    await expect(started).rejects.toThrow('bluetooth off');
    await expect(stopped).resolves.toBeUndefined();
    expect(mockNative.stopBLE).toHaveBeenCalledTimes(1);
  });
});

describe('public mesh leases', () => {
  it('a lease restarts the running mesh with wallet discovery off; its release restarts it with discovery on', async () => {
    await startBLE(REQUEST);
    expect(isPublicBLEMesh()).toBe(false);

    const release = acquirePublicBLEMesh();
    await stopQueueSettled();
    expect(isPublicBLEMesh()).toBe(true);

    release();
    await stopQueueSettled();
    expect(isPublicBLEMesh()).toBe(false);
    expect(walletDiscoveryArgs()).toEqual([true, false, true]);
  });

  it('stays public until the last of two leases is released', async () => {
    await startBLE(REQUEST);
    const first = acquirePublicBLEMesh();
    const second = acquirePublicBLEMesh();
    first();
    await stopQueueSettled();
    expect(isPublicBLEMesh()).toBe(true);

    second();
    await stopQueueSettled();
    expect(walletDiscoveryArgs()).toEqual([true, false, false, false, true]);
  });

  it('after a stop, a lease neither starts the mesh nor restarts it on release', async () => {
    await startBLE(REQUEST);
    await stopBLE();
    mockNative.startBLE.mockClear();

    const release = acquirePublicBLEMesh();
    leases.push(release);
    await stopQueueSettled();

    expect(isPublicBLEMesh()).toBe(true);
    expect(mockNative.startBLE).not.toHaveBeenCalled();
  });

  it('a start made while a lease is held starts with wallet discovery off', async () => {
    leases.push(acquirePublicBLEMesh());

    await startBLE(REQUEST);

    expect(walletDiscoveryArgs()).toEqual([false]);
  });
});

describe('native events to JS listeners', () => {
  it('delivers a well-formed mesh message, drops a malformed one, and stops on remove', () => {
    const received: unknown[] = [];
    const sub = addBLEMessageListener((event) => received.push(event));
    const good = {
      id: 'm1',
      content: 'hello',
      sender: 'anon',
      senderPeerID: PEER,
      timestamp: 5,
      isPrivate: false,
    };

    emitNative('onBLEMessage', good);
    emitNative('onBLEMessage', { ...good, id: '' });
    emitNative('onBLEMessage', 'not an object');
    sub.remove();
    emitNative('onBLEMessage', { ...good, id: 'm2' });

    expect(received).toEqual([good]);
    expect(listenerCount('onBLEMessage')).toBe(0);
  });

  it('delivers a private message only when it carries the running profile’s scope', async () => {
    const received: string[] = [];
    const sub = addBLEPrivateMessageListener((event) => received.push(event.id));

    emitNative('onBLEPrivateMessage', privateMessage('before-start', 'profile-0'));
    await startBLE(REQUEST);
    emitNative('onBLEPrivateMessage', privateMessage('mine', 'profile-0'));
    emitNative('onBLEPrivateMessage', privateMessage('other-account', 'profile-1'));
    emitNative('onBLEPrivateMessage', privateMessage('no-scope'));

    expect(received).toEqual(['mine']);
    sub.remove();
  });

  it('after another account starts, the first account’s messages are dropped; after a stop, all are', async () => {
    const received: string[] = [];
    const sub = addBLEPrivateMessageListener((event) => received.push(event.id));
    await startBLE(REQUEST);

    await startBLE({ ...REQUEST, profileScope: 'profile-1' });
    emitNative('onBLEPrivateMessage', privateMessage('old', 'profile-0'));
    emitNative('onBLEPrivateMessage', privateMessage('new', 'profile-1'));
    await stopBLE();
    emitNative('onBLEPrivateMessage', privateMessage('after-stop', 'profile-1'));

    expect(received).toEqual(['new']);
    sub.remove();
  });

  it('applies the scope at delivery time, so a message is dropped as soon as a new start is queued', async () => {
    const received: string[] = [];
    const sub = addBLEPrivateMessageListener((event) => received.push(event.id));
    await startBLE(REQUEST);
    const starting = deferred<undefined>();
    mockNative.startBLE.mockReturnValueOnce(starting.promise);

    const next = startBLE({ ...REQUEST, profileScope: 'profile-1' });
    emitNative('onBLEPrivateMessage', privateMessage('old-while-switching', 'profile-0'));
    starting.resolve(undefined);
    await next;

    // QUIRK: the scope switches when the start is asked for, not when native
    // has started, so the old account's in-flight messages are already lost.
    expect(received).toEqual([]);
    sub.remove();
  });

  it('a delivery status is passed through with its reason', () => {
    const received: unknown[] = [];
    const sub = addBLEDeliveryStatusListener((event) => received.push(event));

    emitNative('onBLEDeliveryStatus', { messageID: 'x', status: 'failed', reason: 'gone' });
    emitNative('onBLEDeliveryStatus', { messageID: 'x', status: 'exploded' });

    expect(received).toEqual([{ messageID: 'x', status: 'failed', reason: 'gone' }]);
    sub.remove();
  });
});

describe('BitchatBLEProvider', () => {
  const thread = () => useBitchatDmMessagesStore.getState().byPeer[PEER] ?? [];

  it('feeds private messages and delivery statuses into the DM store, and stops when unmounted', async () => {
    await startBLE(REQUEST);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <BitchatBLEProvider>
          <></>
        </BitchatBLEProvider>
      );
    });
    expect(listenerCount('onBLEPrivateMessage')).toBe(1);
    expect(listenerCount('onBLEDeliveryStatus')).toBe(1);

    act(() => {
      emitNative('onBLEPrivateMessage', privateMessage('in-1', 'profile-0'));
      emitNative('onBLEPrivateMessage', privateMessage('proto', 'profile-0', 'sovran:payment:1:x'));
    });
    useBitchatDmMessagesStore.getState().appendOutgoing(
      {
        id: 'out-1',
        content: 'sent by me',
        sender: 'Tester',
        senderId: '',
        timestamp: 2_000,
        isPrivate: true,
        isOwn: true,
        isPending: true,
        deliveryStatus: 'sending',
      },
      PEER
    );
    act(() => {
      emitNative('onBLEDeliveryStatus', { messageID: 'out-1', status: 'delivered' });
    });

    expect(thread().map((m) => [m.id, m.deliveryStatus])).toEqual([
      ['in-1', undefined],
      ['out-1', 'delivered'],
    ]);

    act(() => renderer.unmount());
    expect(listenerCount('onBLEPrivateMessage')).toBe(0);
    expect(listenerCount('onBLEDeliveryStatus')).toBe(0);
    emitNative('onBLEPrivateMessage', privateMessage('after-unmount', 'profile-0'));
    expect(thread().map((m) => m.id)).toEqual(['in-1', 'out-1']);
  });

  it('a remount for another account drops the previous account’s messages', async () => {
    await startBLE(REQUEST);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <BitchatBLEProvider key="profile-0">
          <></>
        </BitchatBLEProvider>
      );
    });
    await startBLE({ ...REQUEST, profileScope: 'profile-1' });
    await act(async () => {
      renderer.update(
        <BitchatBLEProvider key="profile-1">
          <></>
        </BitchatBLEProvider>
      );
    });

    act(() => {
      emitNative('onBLEPrivateMessage', privateMessage('old', 'profile-0'));
      emitNative('onBLEPrivateMessage', privateMessage('new', 'profile-1'));
    });

    expect(listenerCount('onBLEPrivateMessage')).toBe(1);
    expect(thread().map((m) => m.id)).toEqual(['new']);
    act(() => renderer.unmount());
  });
});

describe('without the native module', () => {
  it('rejects sends and starts as unavailable, resolves a stop, and listens to nothing', async () => {
    await jest.isolateModulesAsync(async () => {
      expect(Platform.OS).toBe('web');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const web = require('bitchat-module') as typeof import('bitchat-module');
      const sub = web.addBLEMessageListener(() => undefined);

      await expect(web.startBLE(REQUEST)).rejects.toThrow(
        'BitChat native module is unavailable on this platform'
      );
      await expect(web.sendBLEMessage('x')).rejects.toThrow(
        'BitChat native module is unavailable on this platform'
      );
      await expect(web.stopBLE()).resolves.toBeUndefined();
      await expect(web.beginBLEBackgroundTask('x')).resolves.toBe(-1);
      expect(web.getBLEPeers()).toEqual([]);
      expect(web.getBLEState()).toBe('unavailable');
      expect(() => sub.remove()).not.toThrow();
      expect(mockNative.startBLE).not.toHaveBeenCalled();
      expect(mockNative.addListener).not.toHaveBeenCalled();
    });
  });
});

async function stopQueueSettled() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}
