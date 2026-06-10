/**
 * Pins the hub's Reset Remote Login: clearAllSignerData wipes EXACTLY the
 * signer's state — the three nip46 stores (runtime + both persisted blobs),
 * the pending pairing intent, and the profile's bunker secrets — and touches
 * no other storage key. Also pins the keys-still-deriving path (undefined
 * pubkey skips the per-pubkey SecureStore delete but still clears the rest).
 */

/* eslint-disable import/first */

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    __backing: store,
  };
});

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    __backing: store,
  };
});

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => {
  const map = new Map<string, string>();
  return {
    createProfileScopedStorage: () => ({
      getItem: (key: string) => Promise.resolve(map.get(key) ?? null),
      setItem: (key: string, value: string) => {
        map.set(key, value);
        return Promise.resolve();
      },
      removeItem: (key: string) => {
        map.delete(key);
        return Promise.resolve();
      },
    }),
    __storageMap: map,
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import { useNip46ActivityStore } from '@/features/nostrSigner/data/nip46ActivityStore';
import {
  useNip46ConnectionsStore,
  type Nip46Connection,
} from '@/features/nostrSigner/data/nip46ConnectionsStore';
import { useNip46RequestsStore } from '@/features/nostrSigner/data/nip46RequestsStore';
import { mintSecret } from '@/features/nostrSigner/lib/bunkerSecrets';
import { clearAllSignerData } from '@/features/nostrSigner/lib/clearSignerData';
import {
  PAIRING_INTENT_STORAGE_KEY,
  setPairingIntent,
} from '@/features/nostrSigner/lib/pairingIntentStorage';

const { __backing: asyncBacking } = jest.requireMock(
  '@react-native-async-storage/async-storage'
) as { __backing: Map<string, string> };
const { __backing: secureBacking } = jest.requireMock('expo-secure-store') as {
  __backing: Map<string, string>;
};
const { __storageMap: profileBacking } = jest.requireMock(
  '@/shared/lib/cashu/profileScopedStorage'
) as { __storageMap: Map<string, string> };

const USER = 'a'.repeat(64);
const CLIENT = 'b'.repeat(64);
const SECRETS_KEY = `nip46_bunker_secrets_${USER}`;

function connection(): Nip46Connection {
  return {
    clientPubkey: CLIENT,
    relays: ['wss://relay.example.com'],
    origin: 'nostrconnect',
    status: 'active',
    mode: 'standard',
    encryption: 'nip44',
    pairedAt: 1,
    requestCount: 0,
    deniedCount: 0,
    grants: {},
    peerDecryptGrants: {},
    previousClientPubkeys: [],
  };
}

async function flushPersistWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function seedEverything(): Promise<void> {
  useNip46ConnectionsStore.setState({ apps: { [CLIENT]: connection() } });
  useNip46ActivityStore.getState().logActivity({
    clientPubkey: CLIENT,
    method: 'sign_event',
    kind: 1,
    verdict: 'approved_once',
  });
  useNip46RequestsStore.setState({
    pending: [
      {
        id: 'req-1',
        eventId: 'c'.repeat(64),
        clientPubkey: CLIENT,
        method: 'sign_event',
        kind: 1,
        paramsPreview: { type: 'none' },
        receivedAt: 1,
        expiresAt: 2,
      },
    ],
    throttledApps: { [CLIENT]: 1 },
  });
  expect(
    (
      await setPairingIntent({ uri: 'nostrconnect://x', targetPubkey: USER, targetAccountIndex: 0 })
    ).isOk()
  ).toBe(true);
  expect((await mintSecret(USER)).isOk()).toBe(true);
  await flushPersistWrites();
}

beforeEach(() => {
  asyncBacking.clear();
  secureBacking.clear();
  profileBacking.clear();
  useNip46ConnectionsStore.setState({ apps: {} });
  useNip46ActivityStore.setState({ entries: [] });
  useNip46RequestsStore.getState().clear();
  jest.clearAllMocks();
});

describe('clearAllSignerData', () => {
  it('wipes all three stores, the pairing intent, and the bunker secrets', async () => {
    await seedEverything();
    expect(asyncBacking.has(PAIRING_INTENT_STORAGE_KEY)).toBe(true);
    expect(secureBacking.has(SECRETS_KEY)).toBe(true);

    expect((await clearAllSignerData(USER)).isOk()).toBe(true);
    await flushPersistWrites();

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
    expect(useNip46ActivityStore.getState().entries).toEqual([]);
    const requests = useNip46RequestsStore.getState();
    expect(requests.pending).toEqual([]);
    expect(requests.throttledApps).toEqual({});
    expect(asyncBacking.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);
    expect(secureBacking.has(SECRETS_KEY)).toBe(false);

    // The persisted blobs were rewritten as empty shells, not left behind.
    const connectionsBlob = profileBacking.get('nip46-connections-store');
    expect(connectionsBlob).toBeDefined();
    expect(JSON.parse(connectionsBlob!).state.apps).toEqual({});
    const activityBlob = profileBacking.get('nip46-activity-store');
    expect(activityBlob).toBeDefined();
    expect(JSON.parse(activityBlob!).state.entries).toEqual([]);
  });

  it('touches no storage outside the signer keys', async () => {
    await seedEverything();
    asyncBacking.set('unrelated-store', 'untouched');
    secureBacking.set('unrelated-secret', 'untouched');
    jest.clearAllMocks();

    expect((await clearAllSignerData(USER)).isOk()).toBe(true);

    // Focused wipe: every storage delete addressed a signer-owned key.
    const removedAsyncKeys = (AsyncStorage.removeItem as jest.Mock).mock.calls.map(
      ([key]) => key as string
    );
    expect(removedAsyncKeys).toEqual([PAIRING_INTENT_STORAGE_KEY]);
    const removedSecureKeys = (SecureStore.deleteItemAsync as jest.Mock).mock.calls.map(
      ([key]) => key as string
    );
    expect(removedSecureKeys).toEqual([SECRETS_KEY]);
    expect(asyncBacking.get('unrelated-store')).toBe('untouched');
    expect(secureBacking.get('unrelated-secret')).toBe('untouched');
  });

  it('clears stores and the intent even while keys are still deriving', async () => {
    await seedEverything();

    expect((await clearAllSignerData(undefined)).isOk()).toBe(true);

    expect(useNip46ConnectionsStore.getState().apps).toEqual({});
    expect(asyncBacking.has(PAIRING_INTENT_STORAGE_KEY)).toBe(false);
    // No pubkey → the per-pubkey secrets key is not addressable; left alone.
    expect(secureBacking.has(SECRETS_KEY)).toBe(true);
  });
});
