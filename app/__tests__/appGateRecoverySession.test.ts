/** @jest-environment node */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  recoverMnemonicSession,
  deleteAllProfiles,
} from '@/shared/lib/profile/profileSessionOrchestrator';
import {
  storeMnemonic,
  clearAllSecureData,
  prepareSecureDataReset,
} from '@/shared/lib/nostr/secureStorage';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';
import { useProfileStore } from '@/shared/stores/global/profileStore';
import { useSettingsStore } from '@/shared/stores/global/settingsStore';
import { restartApp } from '@/shared/lib/profile/appRestart';
import { deriveNostrKeys } from '@/shared/lib/nostr/keyDerivation';
import { CocoManager } from '@/shared/lib/cashu/manager';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
  clear: jest.fn(async () => {}),
}));
jest.mock('@/shared/lib/logger', () => ({
  nostrLog: { info: jest.fn(), warn: jest.fn() },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: () => 'redacted',
}));
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  storeMnemonic: jest.fn(async () => true),
  clearAllSecureData: jest.fn(async () => true),
  prepareSecureDataReset: jest.fn(
    async () => jest.requireMock('@/shared/lib/nostr/secureStorage').clearAllSecureData
  ),
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

const phrase = 'abandon '.repeat(11) + 'about';
beforeEach(() => {
  jest.clearAllMocks();
  useProfileStore.setState({ activeAccountIndex: 0, profiles: [] });
  useSecureStoreState.setState({ secureStoreState: 'locked', errorName: 'Error' });
  jest.mocked(storeMnemonic).mockResolvedValue(true);
  jest.mocked(clearAllSecureData).mockResolvedValue(true);
});

it('persists pending restore before storing the recovery phrase, then restarts the session', async () => {
  await expect(recoverMnemonicSession(phrase)).resolves.toBe(true);
  expect(storeMnemonic).toHaveBeenCalledWith(phrase);
  const writes = jest.mocked(AsyncStorage.setItem).mock.calls;
  const lifecycleIndex = writes.findIndex(([key]) => key === 'wallet-lifecycle');
  expect(JSON.parse(writes[lifecycleIndex][1]).state).toMatchObject({
    seedCreatedAt: null,
    restoreStatus: 'pending',
  });
  expect(jest.mocked(AsyncStorage.setItem).mock.invocationCallOrder[lifecycleIndex]).toBeLessThan(
    jest.mocked(storeMnemonic).mock.invocationCallOrder[0]
  );
  expect(restartApp).toHaveBeenCalledTimes(1);
  // Sticky until native restart: background callers must not resume against old caches.
  expect(useSecureStoreState.getState().secureStoreState).toBe('locked');
});

it('does not restart if storing the phrase fails', async () => {
  jest.mocked(storeMnemonic).mockResolvedValue(false);
  await expect(recoverMnemonicSession(phrase)).resolves.toBe(false);
  expect(restartApp).not.toHaveBeenCalled();
});

it('puts the restore decision back when the phrase cannot be stored', async () => {
  // Left as written, the next start would find a restore owed for a phrase
  // that was never replaced.
  const previous = JSON.stringify({
    state: { seedCreatedAt: 5, restoreStatus: 'not-needed', lastRestoreAt: null },
    version: 0,
  });
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async (key) => (key === 'wallet-lifecycle' ? previous : null));
  jest.mocked(storeMnemonic).mockResolvedValue(false);

  await expect(recoverMnemonicSession(phrase)).resolves.toBe(false);

  const writes = jest
    .mocked(AsyncStorage.setItem)
    .mock.calls.filter(([key]) => key === 'wallet-lifecycle');
  expect(JSON.parse(writes[0][1]).state.restoreStatus).toBe('pending');
  expect(JSON.parse(writes.at(-1)![1]).state).toMatchObject({
    seedCreatedAt: 5,
    restoreStatus: 'not-needed',
  });
  expect(restartApp).not.toHaveBeenCalled();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async () => null);
});

it('still recovers when the saved restore record is damaged', async () => {
  // Reading it back for a rollback must not be what stops a recovery.
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async (key) => (key === 'wallet-lifecycle' ? '{"state":{"se' : null));

  await expect(recoverMnemonicSession(phrase)).resolves.toBe(true);

  expect(storeMnemonic).toHaveBeenCalledWith(phrase);
  expect(restartApp).toHaveBeenCalledTimes(1);
  jest.mocked(AsyncStorage.getItem).mockImplementation(async () => null);
});

it('rejects a recovery phrase that changes a known derived identity', async () => {
  useProfileStore.setState({
    profiles: [{ accountIndex: 0, pubkey: 'b'.repeat(64), source: 'derived', addedAt: 1 }],
  });
  await expect(recoverMnemonicSession(phrase)).resolves.toBe(false);
  expect(storeMnemonic).not.toHaveBeenCalled();
  expect(CocoManager.cleanup).not.toHaveBeenCalled();
});

it('discards only the unused onboarding profile projection before replacing the seed', async () => {
  useSecureStoreState.setState({ secureStoreState: 'available', errorName: null });
  await expect(recoverMnemonicSession(phrase)).resolves.toBe(true);
  const write = jest
    .mocked(AsyncStorage.setItem)
    .mock.calls.find(([key]) => key === 'profile-store');
  expect(JSON.parse(write![1]).state).toEqual({ activeAccountIndex: 0, profiles: [] });
  expect(useSettingsStore.persist.getOptions().storage!.setItem).toHaveBeenCalled();
});

it('leaves databases and keys intact when reset enumeration fails', async () => {
  jest.mocked(prepareSecureDataReset).mockRejectedValueOnce(new Error('index unreadable'));
  await expect(deleteAllProfiles()).resolves.toBe(false);
  expect(CocoManager.completeReset).not.toHaveBeenCalled();
  expect(clearAllSecureData).not.toHaveBeenCalled();
  expect(AsyncStorage.clear).not.toHaveBeenCalled();
});

it('lets a derived account recover its matching phrase after a setup failure', async () => {
  useSecureStoreState.setState({ secureStoreState: 'available', errorName: null });
  jest
    .mocked(useSettingsStore.getState)
    .mockReturnValueOnce({ ...useSettingsStore.getState(), hasSeenOnboarding: true });
  useProfileStore.setState({
    profiles: [
      { accountIndex: 0, pubkey: deriveNostrKeys(phrase, 0).pubkey, source: 'derived', addedAt: 1 },
    ],
  });
  jest.mocked(AsyncStorage.setItem).mockClear();
  await expect(recoverMnemonicSession(phrase)).resolves.toBe(true);
  expect(storeMnemonic).toHaveBeenCalledWith(phrase);
  expect(
    jest.mocked(AsyncStorage.setItem).mock.calls.some(([key]) => key === 'profile-store')
  ).toBe(false);
});

it('clears secure data and preferences before restarting fresh', async () => {
  await expect(deleteAllProfiles()).resolves.toBe(true);
  expect(clearAllSecureData).toHaveBeenCalled();
  expect(AsyncStorage.clear).toHaveBeenCalled();
  expect(restartApp).toHaveBeenCalledTimes(1);
});
