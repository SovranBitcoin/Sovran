/**
 * @jest-environment node
 *
 * Characterization of `useNearbyDiscovery`, the account's warm nearby
 * directory, against a fake BitChat native module: when Bluetooth discovery is
 * started and stopped, how the public-mesh lease changes the start, which
 * peers get a Noise handshake or a signed wallet capability, how a received
 * capability lands in the peer directory, how the nearby payment journal is
 * pumped, and what unmounting tears down. The real bitchat-module JS wrapper,
 * capability signing and peer directory run; the native module, the wallet's
 * standing request, Coco and the account hooks are replaced.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import { AppState, Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

type Listener = (event: unknown) => void;

const mockNativeListeners = new Map<string, Set<Listener>>();
const mockNative = {
  startBLE: jest.fn(async (..._args: unknown[]) => undefined),
  stopBLE: jest.fn(async () => undefined),
  getBLEPeers: jest.fn((): unknown[] => []),
  startBLEPrivateChat: jest.fn(async (_peerID: string) => undefined),
  sendBLEPrivateMessage: jest.fn(async (..._args: unknown[]) => 'sent'),
  addListener: jest.fn((name: string, listener: Listener) => {
    if (!mockNativeListeners.has(name)) mockNativeListeners.set(name, new Set());
    mockNativeListeners.get(name)!.add(listener);
    return { remove: () => mockNativeListeners.get(name)!.delete(listener) };
  }),
  removeListeners: jest.fn(),
};
const mockPayments = { drain: jest.fn(async () => undefined), ingest: jest.fn(async () => true) };
const mockAppStateListeners = new Set<(state: string) => void>();
let mockScope = 'scope-a';
let mockCocoReady = true;
let mockIdentity: Record<string, string> | null = null;
let mockKeys: { privateKey: Uint8Array } | null = null;

jest.mock('expo-modules-core', () => ({ requireNativeModule: () => mockNative }));
jest.mock('@/features/bitchat/hooks/useBitchatNickname', () => ({
  useBitchatNickname: () => 'alice',
}));
jest.mock('@/features/bitchat/lib/profileScope', () => ({
  getBitchatProfileScope: () => mockScope,
  useBitchatProfileScope: () => mockScope,
}));
jest.mock('@/features/bitchat/hooks/useBitchatBLEIdentityMaterial', () => ({
  useBitchatBLEIdentityMaterial: () => mockIdentity,
}));
jest.mock('@/shared/providers/NostrKeysProvider', () => ({
  useNostrKeysContext: () => ({ keys: mockKeys }),
}));
jest.mock('@cashu/coco-react', () => ({
  useMints: () => ({ trustedMints: [] }),
  useBalanceContext: () => ({ balances: { byMintAndUnit: {} } }),
}));
jest.mock('wallet/react', () => ({ useStandingPaymentRequest: () => ({ request: null }) }));
jest.mock('@/shared/stores/global/mintTestnutStore', () => ({
  useIsTestnutMint: () => () => false,
}));
jest.mock('@/shared/hooks/useNostrProfileMetadata', () => ({
  useNostrProfileMetadataMany: () => ({ metadata: {} }),
}));
jest.mock('@/shared/hooks/useWarmNip05Profiles', () => ({ useWarmNip05Profiles: jest.fn() }));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { isInitialized: () => mockCocoReady, getInstance: () => ({ id: 'manager' }) },
}));
jest.mock('@/features/nearPay/lib/nearbyPayments', () => ({
  NEARBY_PAYMENT_PREFIX: 'sovran:payment:1:',
  nearbyPayments: () => mockPayments,
}));
jest.mock('@/features/receive/lib/standingQuoteIdentityStore', () => ({
  standingQuoteIdentityStore: { get: jest.fn(), set: jest.fn(), subscribe: jest.fn() },
}));

const NOW = 1_800_000_000_000;
const NOSTR_PUB = 'a1'.repeat(32);
const OUR_NOISE = '01'.repeat(32);
const PEER_NOISE = '02'.repeat(32);
const PEER_KEY = new Uint8Array(32).fill(2);

// The wrapper picks the native module at load time, on iOS and Android only, so the
// platform is set before the hook and the wrapper are loaded.
const osBefore = Platform.OS;
Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
const mod = {
  ...(require('@/features/nearPay/hooks/useNearbyDiscovery') as {
    useNearbyDiscovery: () => void;
  }),
  ...(require('bitchat-module') as { acquirePublicBLEMesh: () => () => void }),
  ...(require('@/features/bitchat/hooks/useBLEPeers') as {
    useBLEPeerDirectory: {
      getState: () => { peers: { peerID: string; nostrPubkeyHex?: string }[] };
    };
  }),
  ...(require('@/features/nearPay/lib/nearbyCapability') as {
    nearbyNoiseIdentity: (hex: string) => { peerID: string; fingerprint: string };
    createNearbyCapability: (
      key: Uint8Array,
      noise: string,
      creq: string | null,
      now?: number
    ) => string;
  }),
  getPublicKey: (require('nostr-tools/pure') as { getPublicKey: (key: Uint8Array) => string })
    .getPublicKey,
  renderHook,
  act,
};

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: osBefore, configurable: true });
});

const IDENTITY = {
  version: 'sovran-bitchat-ble-v1',
  nostrPubkey: NOSTR_PUB,
  noisePrivateKeyHex: OUR_NOISE,
  signingPrivateKeyHex: '03'.repeat(32),
};

function setAppState(state: 'active' | 'background') {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
}

function emit(name: string, event: unknown) {
  mod.act(() => mockNativeListeners.get(name)?.forEach((listener) => listener(event)));
}

async function flush(ms = 0) {
  await mod.act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

function peer(peerID: string, extra: Record<string, unknown> = {}) {
  return {
    peerID,
    nickname: peerID,
    isConnected: true,
    hasDirectLink: true,
    lastSeen: NOW,
    ...extra,
  };
}

function privateMessage(peerID: string, content: string, profileScope = mockScope) {
  return {
    id: `m-${content.length}`,
    peerID,
    sender: 'bob',
    content,
    timestamp: NOW,
    isOwn: false,
    profileScope,
  };
}

async function mount() {
  const view = mod.renderHook(() => mod.useNearbyDiscovery());
  await flush();
  return view;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  for (const level of ['debug', 'info', 'warn', 'error', 'log'] as const) {
    jest.spyOn(console, level).mockImplementation(() => undefined);
  }
  jest.clearAllMocks();
  mockScope = 'scope-a';
  mockCocoReady = true;
  mockIdentity = IDENTITY;
  mockKeys = { privateKey: new Uint8Array(32).fill(1) };
  mockNative.getBLEPeers.mockReturnValue([]);
  mockAppStateListeners.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: string) => void
  ) => {
    mockAppStateListeners.add(listener);
    return { remove: () => mockAppStateListeners.delete(listener) };
  }) as never);
  setAppState('active');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('starting and stopping Bluetooth', () => {
  it('starts nothing without the account BLE identity', async () => {
    mockIdentity = null;
    await mount();

    expect(mockNative.startBLE).not.toHaveBeenCalled();
    expect(mockPayments.drain).not.toHaveBeenCalled();
  });

  it('starts wallet discovery for the profile with no request advertised natively', async () => {
    const view = await mount();

    expect(mockNative.startBLE).toHaveBeenCalledTimes(1);
    expect(mockNative.startBLE).toHaveBeenCalledWith(
      'alice',
      'scope-a',
      OUR_NOISE,
      IDENTITY.signingPrivateKeyHex,
      `02${NOSTR_PUB}`,
      null,
      true
    );
    view.unmount();
  });

  it('waits for the foreground, and starts again when the radio powers on', async () => {
    setAppState('background');
    const view = await mount();
    expect(mockNative.startBLE).not.toHaveBeenCalled();

    setAppState('active');
    mod.act(() => mockAppStateListeners.forEach((listener) => listener('active')));
    await flush();
    expect(mockNative.startBLE).toHaveBeenCalledTimes(1);

    emit('onBLEStateChanged', { state: 'poweredOn' });
    await flush();
    expect(mockNative.startBLE).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('stops Bluetooth, clears the directory and stops polling on unmount', async () => {
    mockNative.getBLEPeers.mockReturnValue([peer('ffffffffffffffff')]);
    const view = await mount();
    expect(mod.useBLEPeerDirectory.getState().peers).toHaveLength(1);

    view.unmount();
    await flush();
    const polls = mockNative.getBLEPeers.mock.calls.length;
    await flush(30_000);

    expect(mockNative.stopBLE).toHaveBeenCalledTimes(1);
    expect(mod.useBLEPeerDirectory.getState().peers).toEqual([]);
    expect(mockNative.getBLEPeers.mock.calls.length).toBe(polls);
    expect(mockPayments.drain).toHaveBeenCalledTimes(1);
  });

  it('stops before starting again when the profile changes', async () => {
    const view = await mount();
    mockScope = 'scope-b';

    view.rerender({});
    await flush();

    const order = [
      ...mockNative.startBLE.mock.invocationCallOrder.map((at, i) => ({
        at,
        what: `start ${String(mockNative.startBLE.mock.calls[i]![1])}`,
      })),
      ...mockNative.stopBLE.mock.invocationCallOrder.map((at) => ({ at, what: 'stop' })),
    ]
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.what);
    expect(order).toEqual(['start scope-a', 'stop', 'start scope-b']);
    view.unmount();
  });

  it('restarts without wallet discovery while a public-mesh lease is held, and with it after', async () => {
    const view = await mount();

    const release = mod.acquirePublicBLEMesh();
    await flush();
    expect(mockNative.startBLE.mock.calls.at(-1)!.at(-1)).toBe(false);

    release();
    await flush();
    expect(mockNative.startBLE.mock.calls.at(-1)!.at(-1)).toBe(true);
    expect(mockNative.startBLE).toHaveBeenCalledTimes(3);
    view.unmount();
  });

  it('starts nothing when a lease is taken after discovery stopped', async () => {
    const view = await mount();
    view.unmount();
    await flush();
    mockNative.startBLE.mockClear();

    const release = mod.acquirePublicBLEMesh();
    release();
    await flush();

    expect(mockNative.startBLE).not.toHaveBeenCalled();
  });
});

describe('peers and wallet capabilities', () => {
  it('opens a Noise handshake only toward a higher peer ID, at most every 15 s', async () => {
    const ours = mod.nearbyNoiseIdentity(OUR_NOISE).peerID;
    const higher = 'f'.repeat(16);
    const lower = '0'.repeat(16);
    expect(ours < higher && ours > lower).toBe(true);
    mockNative.getBLEPeers.mockReturnValue([peer(higher), peer(lower)]);
    const view = await mount();

    expect(mockNative.startBLEPrivateChat.mock.calls).toEqual([[higher]]);
    await flush(12_000);
    expect(mockNative.startBLEPrivateChat).toHaveBeenCalledTimes(1);
    await flush(6_000);
    expect(mockNative.startBLEPrivateChat).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('sends an authenticated peer a signed capability, then not again for 30 s', async () => {
    const fingerprint = mod.nearbyNoiseIdentity(PEER_NOISE).fingerprint;
    mockNative.getBLEPeers.mockReturnValue([
      peer('abcdefabcdefabcd', { authenticatedNoiseFingerprint: fingerprint }),
    ]);
    const view = await mount();

    expect(mockNative.sendBLEPrivateMessage).toHaveBeenCalledTimes(1);
    const [peerID, content, nickname] = mockNative.sendBLEPrivateMessage.mock.calls[0]!;
    expect(peerID).toBe('abcdefabcdefabcd');
    expect(String(content).startsWith('sovran:nearby:1:')).toBe(true);
    expect(nickname).toBe('alice');

    await flush(27_000);
    expect(mockNative.sendBLEPrivateMessage).toHaveBeenCalledTimes(1);
    await flush(3_000);
    expect(mockNative.sendBLEPrivateMessage).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('sends no capability without the account keys', async () => {
    mockKeys = null;
    const fingerprint = mod.nearbyNoiseIdentity(PEER_NOISE).fingerprint;
    mockNative.getBLEPeers.mockReturnValue([
      peer('abcdefabcdefabcd', { authenticatedNoiseFingerprint: fingerprint }),
    ]);
    const view = await mount();

    expect(mockNative.sendBLEPrivateMessage).not.toHaveBeenCalled();
    view.unmount();
  });

  it('puts a peer’s verified Nostr identity in the directory, and drops a native favorite', async () => {
    const fingerprint = mod.nearbyNoiseIdentity(PEER_NOISE).fingerprint;
    mockNative.getBLEPeers.mockReturnValue([
      peer('abcdefabcdefabcd', {
        authenticatedNoiseFingerprint: fingerprint,
        nostrPubkeyHex: 'ee'.repeat(32),
      }),
    ]);
    const view = await mount();
    expect(mod.useBLEPeerDirectory.getState().peers[0]!.nostrPubkeyHex).toBeUndefined();

    emit(
      'onBLEPrivateMessage',
      privateMessage(
        'abcdefabcdefabcd',
        mod.createNearbyCapability(PEER_KEY, PEER_NOISE, null, NOW)
      )
    );

    expect(mod.useBLEPeerDirectory.getState().peers[0]!.nostrPubkeyHex).toBe(
      mod.getPublicKey(PEER_KEY)
    );
    view.unmount();
  });

  it('ignores a capability delivered for another profile', async () => {
    const fingerprint = mod.nearbyNoiseIdentity(PEER_NOISE).fingerprint;
    mockNative.getBLEPeers.mockReturnValue([
      peer('abcdefabcdefabcd', { authenticatedNoiseFingerprint: fingerprint }),
    ]);
    const view = await mount();

    emit(
      'onBLEPrivateMessage',
      privateMessage(
        'abcdefabcdefabcd',
        mod.createNearbyCapability(PEER_KEY, PEER_NOISE, null, NOW),
        'scope-other'
      )
    );

    expect(mod.useBLEPeerDirectory.getState().peers[0]!.nostrPubkeyHex).toBeUndefined();
    view.unmount();
  });

  it('sends wallet messages to no unverified peer while the public mesh is leased', async () => {
    const release = mod.acquirePublicBLEMesh();
    const fingerprint = mod.nearbyNoiseIdentity(PEER_NOISE).fingerprint;
    mockNative.getBLEPeers.mockReturnValue([
      peer('abcdefabcdefabcd', { authenticatedNoiseFingerprint: fingerprint }),
      peer('f'.repeat(16)),
    ]);
    const view = await mount();

    expect(mockNative.sendBLEPrivateMessage).not.toHaveBeenCalled();
    expect(mockNative.startBLEPrivateChat).not.toHaveBeenCalled();
    view.unmount();
    release();
  });
});

describe('the nearby payment journal', () => {
  it('drains on mount, every 5 s and on return to the foreground, and stops on unmount', async () => {
    const view = await mount();
    expect(mockPayments.drain).toHaveBeenCalledTimes(1);
    expect(mockPayments.drain).toHaveBeenCalledWith(mockKeys!.privateKey, IDENTITY, 'alice');

    await flush(5_000);
    expect(mockPayments.drain).toHaveBeenCalledTimes(2);
    mod.act(() => mockAppStateListeners.forEach((listener) => listener('active')));
    expect(mockPayments.drain).toHaveBeenCalledTimes(3);

    view.unmount();
    await flush(20_000);
    expect(mockPayments.drain).toHaveBeenCalledTimes(3);
  });

  it('does not run before the wallet is open', async () => {
    mockCocoReady = false;
    const view = await mount();
    await flush(10_000);

    expect(mockPayments.drain).not.toHaveBeenCalled();
    view.unmount();
  });

  it('hands an incoming nearby payment to the journal, then drains', async () => {
    mockNative.getBLEPeers.mockReturnValue([peer('abcdefabcdefabcd')]);
    const view = await mount();
    mockPayments.drain.mockClear();

    emit('onBLEPrivateMessage', privateMessage('abcdefabcdefabcd', 'sovran:payment:1:{"x":1}'));
    await flush();

    expect(mockPayments.ingest).toHaveBeenCalledWith('{"x":1}', NOSTR_PUB, undefined);
    expect(mockPayments.drain).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
