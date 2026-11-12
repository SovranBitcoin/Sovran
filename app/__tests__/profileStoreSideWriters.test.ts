/**
 * @jest-environment node
 *
 * Characterization: the `profile-store` blobs written by hand outside the
 * store agree with what the store itself saves and loads. Covered writers:
 * the switch target (`persistSwitchTargetToDisk`), the "profile list" step of
 * a profile removal, and the onboarding recovery step of
 * `recoverMnemonicSession`. Each blob is compared with the store's own
 * save (its `partialize` keys and version) and then loaded back through the
 * real store. Only storage, the keychain, the wallet databases and files, the
 * wallet manager, the restart and the settings store are replaced.
 */

import { recoverMnemonicSession } from '@/shared/lib/profile/profileSessionOrchestrator';
import { persistSwitchTargetToDisk } from '@/shared/lib/profile/profileTransition';
import { profileRemovalPorts } from '@/shared/lib/profile/profileRemovalStorage';
import { removeProfileData } from '@/shared/lib/profile/removeProfile';
import {
  PROFILE_STORE_PERSIST_VERSION,
  useProfileStore,
  type ProfileEntry,
} from '@/shared/stores/global/profileStore';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';

const mockAsync = new Map<string, string>();
const mockSecure = new Map<string, string>();
const mockDeleted = new Set<string>();

jest.mock('@react-native-async-storage/async-storage', () => {
  const storage = {
    getItem: async (key: string) => mockAsync.get(key) ?? null,
    setItem: async (key: string, value: string) => void mockAsync.set(key, value),
    removeItem: async (key: string) => void mockAsync.delete(key),
    getAllKeys: async () => [...mockAsync.keys()],
  };
  return { __esModule: true, default: storage, ...storage };
});
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'fixture/',
  getInfoAsync: async (path: string) => ({
    exists: path.endsWith('.db') && !mockDeleted.has(path),
  }),
  deleteAsync: async (path: string) => void mockDeleted.add(path),
}));
// An empty wallet database: nothing in it blocks the removal.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => ({
    execAsync: async () => {},
    closeAsync: async () => {},
    getFirstAsync: async () => ({ quick_check: 'ok' }),
    getAllAsync: async (sql: string) =>
      sql.includes('sqlite_master')
        ? [
            'coco_cashu_proofs',
            'coco_cashu_mint_quotes',
            'coco_cashu_canonical_mint_quotes',
            'coco_cashu_melt_quotes',
            'coco_cashu_send_operations',
            'coco_cashu_receive_operations',
            'coco_cashu_melt_operations',
            'coco_cashu_mint_operations',
          ].map((name) => ({ name }))
        : [],
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const log = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { log, nostrLog: log, storeLog: log, cashuLog: log, redactError: () => 'redacted' };
});
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  hashMnemonic: (mnemonic: string) => `fingerprint of ${mnemonic}`,
  retrieveMnemonic: jest.fn(async () => null),
  storeMnemonic: jest.fn(async () => true),
  clearAllSecureData: jest.fn(async () => true),
  prepareSecureDataReset: jest.fn(async () => async () => true),
  prepareProfileSecureRemoval: jest.fn(async () => async () => {}),
}));
jest.mock('@/shared/lib/profile/appRestart', () => ({ restartApp: jest.fn(() => true) }));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { cleanup: jest.fn(async () => {}), completeReset: jest.fn(async () => {}) },
}));
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: { getState: () => ({ setActive: jest.fn() }) },
}));
jest.mock('@/shared/stores/runtime/popupStore', () => ({
  usePopupStore: { getState: () => ({ close: jest.fn(), destroySheet: jest.fn() }) },
}));
jest.mock('@/shared/stores/global/btcMapStore', () => ({
  useBTCMapStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/shared/stores/global/settingsStore', () => {
  const storage = { setItem: jest.fn(async () => {}) };
  return {
    useSettingsStore: {
      getState: jest.fn(() => ({ hasSeenOnboarding: false })),
      persist: {
        getOptions: () => ({
          storage,
          name: 'settings-store',
          version: 1,
          partialize: (state: object) => state,
        }),
      },
    },
  };
});

const PHRASE = `${'abandon '.repeat(11)}about`;

/** Every field a profile row can carry, so a lossy copy shows. */
const FULL_ROWS: ProfileEntry[] = [
  {
    accountIndex: 0,
    pubkey: '0'.repeat(64),
    addedAt: 1,
    cachedBalanceSats: 1234,
    cachedDisplayName: 'Alice',
    cachedPicture: 'https://pic.example/a.png',
    source: 'derived',
    walletDatabaseCreated: true,
  },
  {
    accountIndex: 1_234_567,
    pubkey: 'f'.repeat(64),
    addedAt: 2,
    source: 'imported',
    externalChain: 1,
    walletPhraseFingerprint: 'fingerprint of another phrase',
  },
];

type Envelope = { state: Record<string, unknown>; version: number };
const savedBlob = (): Envelope => JSON.parse(mockAsync.get('profile-store')!);

async function settle() {
  for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
}

/** The blob the store itself writes for its current state. */
async function storeOwnBlob(): Promise<Envelope> {
  useProfileStore.setState({ profiles: [...useProfileStore.getState().profiles] });
  await settle();
  return savedBlob();
}

async function loadBack(blob: Envelope) {
  mockAsync.set('profile-store', JSON.stringify(blob));
  useProfileStore.setState({ activeAccountIndex: 99, profiles: [] });
  await settle();
  mockAsync.set('profile-store', JSON.stringify(blob));
  await useProfileStore.persist.rehydrate();
  await settle();
}

// The module-load read ran before the in-memory disk existed; one good read
// lets the store save again, as it would after a normal launch.
beforeAll(async () => {
  await useProfileStore.persist.rehydrate();
});

beforeEach(async () => {
  mockAsync.clear();
  mockSecure.clear();
  mockDeleted.clear();
  useSecureStoreState.setState({ secureStoreState: 'available' });
  useProfileStore.setState({ activeAccountIndex: 0, profiles: FULL_ROWS });
  await settle();
});

describe('the switch target writer', () => {
  it('writes the same keys and version the store itself saves', async () => {
    const own = await storeOwnBlob();
    const partialized = useProfileStore.persist.getOptions().partialize!(
      useProfileStore.getState()
    ) as Record<string, unknown>;

    const result = await persistSwitchTargetToDisk(1_234_567);
    expect(result.isOk()).toBe(true);
    const written = savedBlob();

    expect(Object.keys(written).sort()).toEqual(Object.keys(own).sort());
    expect(Object.keys(written.state).sort()).toEqual(Object.keys(own.state).sort());
    expect(Object.keys(written.state).sort()).toEqual(Object.keys(partialized).sort());
    expect(written.version).toBe(PROFILE_STORE_PERSIST_VERSION);
    expect(written.version).toBe(own.version);
  });

  it('changes only the active index and keeps every field of every row', async () => {
    await persistSwitchTargetToDisk(1_234_567);
    const written = savedBlob();

    expect(written.state).toEqual({ activeAccountIndex: 1_234_567, profiles: FULL_ROWS });
    // The in-memory store is left on the old profile.
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
  });

  it('loads back through the store as the switched profile with every row intact', async () => {
    await persistSwitchTargetToDisk(1_234_567);
    await loadBack(savedBlob());

    expect(useProfileStore.getState().activeAccountIndex).toBe(1_234_567);
    expect(useProfileStore.getState().profiles).toEqual(FULL_ROWS);
  });

  it('writes an index no row stands behind, which the next load repairs to the first row', async () => {
    await persistSwitchTargetToDisk(42);
    expect(savedBlob().state.activeAccountIndex).toBe(42);

    await loadBack(savedBlob());
    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
  });
});

describe('the profile removal writer', () => {
  it('writes the store’s own keys and version and keeps every field of the remaining rows', async () => {
    const own = await storeOwnBlob();

    const result = await removeProfileData(1_234_567, true, profileRemovalPorts);
    expect(result.kind).toBe('removed');
    const written = savedBlob();

    expect(Object.keys(written.state).sort()).toEqual(Object.keys(own.state).sort());
    expect(written.version).toBe(PROFILE_STORE_PERSIST_VERSION);
    expect(written.state).toEqual({ activeAccountIndex: 0, profiles: [FULL_ROWS[0]] });
  });

  it('loads back through the store with the removed row gone and the rest intact', async () => {
    await removeProfileData(1_234_567, true, profileRemovalPorts);
    await loadBack(savedBlob());

    expect(useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(useProfileStore.getState().profiles).toEqual([FULL_ROWS[0]]);
  });
});

describe('the onboarding recovery writer', () => {
  it('empties the list in a blob with the store’s own keys and version', async () => {
    const own = await storeOwnBlob();

    await expect(recoverMnemonicSession(PHRASE)).resolves.toBe(true);
    const written = savedBlob();

    expect(written).toEqual({
      state: { activeAccountIndex: 0, profiles: [] },
      version: PROFILE_STORE_PERSIST_VERSION,
    });
    expect(Object.keys(written.state).sort()).toEqual(Object.keys(own.state).sort());
    expect(written.version).toBe(own.version);
  });

  it('loads back through the store as an empty profile list on index 0', async () => {
    await recoverMnemonicSession(PHRASE);
    await loadBack(savedBlob());

    expect(useProfileStore.getState()).toMatchObject({ activeAccountIndex: 0, profiles: [] });
  });
});
