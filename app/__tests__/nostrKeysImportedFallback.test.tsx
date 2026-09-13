/** @jest-environment node */
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NostrKeysProvider, useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import {
  useProfileStore,
  PROFILE_STORE_PERSIST_VERSION,
} from '@/shared/stores/global/profileStore';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';
import {
  clearAccountDerivedCache,
  retrieveImportedNsec,
  storeCashuMnemonic,
} from '@/shared/lib/nostr/secureStorage';
import {
  deriveNostrKeys,
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
} from '@/shared/lib/nostr/keyDerivation';
import { CocoManager } from '@/shared/lib/cashu/manager';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
  removeItem: jest.fn(async () => {}),
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { error: jest.fn(), warn: jest.fn() },
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  initLog: jest.fn(),
  useInitMount: jest.fn(),
  redactError: () => 'redacted',
  initPhase: (_name: string, fn: () => unknown) => fn(),
}));
jest.mock('@/shared/providers/InitializationProvider', () => {
  const stage = { canStart: true, log: jest.fn(), complete: jest.fn(), error: jest.fn() };
  return { useInitializationStage: () => stage };
});
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  useMnemonic: () => ({ value: 'fixture-root', loading: false, error: null, refresh: jest.fn() }),
  retrieveImportedNsec: jest.fn(async () => null),
  clearAccountDerivedCache: jest.fn(async () => true),
  hashMnemonic: () => 'root-hash',
  retrieveDerivedKeys: jest.fn(async () => ({ mnemonicHash: 'root-hash' })),
  retrieveCashuMnemonic: jest.fn(async () => ({
    value: 'wrong-chain-cache',
    mnemonicHash: 'root-hash',
  })),
  storeDerivedKeys: jest.fn(async () => true),
  storeCashuMnemonic: jest.fn(async () => true),
}));
jest.mock('@/shared/lib/nostr/keyDerivation', () => ({
  deriveNostrKeys: jest.fn(() => ({
    pubkey: 'a'.repeat(64),
    npub: 'fixture-npub',
    nsec: 'fixture-nsec',
    privateKey: new Uint8Array(32),
  })),
  deriveCashuMnemonic: jest.fn(() => 'derived-chain-zero'),
  deriveCashuMnemonicForImported: jest.fn(),
}));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { setAccountIndex: jest.fn(), setCashuMnemonic: jest.fn() },
}));
jest.mock('@/shared/lib/profile/ownProfileSync', () => ({ syncOwnProfiles: jest.fn() }));
jest.mock('@/shared/blocks/KeyRecoveryScreen', () => {
  return {
    KeyRecoveryScreen: ({ locked }: { locked: boolean }) =>
      jest.requireActual('react').createElement('View', { testID: locked ? 'locked' : 'reimport' }),
  };
});

let context: ReturnType<typeof useNostrKeysContext>;
function Consumer() {
  context = useNostrKeysContext();
  return null;
}

beforeEach(async () => {
  jest.clearAllMocks();
  useSecureStoreState.setState({ secureStoreState: 'available', errorName: null });
  jest.mocked(clearAccountDerivedCache).mockResolvedValue(true);
  jest.mocked(retrieveImportedNsec).mockResolvedValue(null);
});

async function hydrate(pubkey: string) {
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
    JSON.stringify({
      version: PROFILE_STORE_PERSIST_VERSION,
      state: {
        activeAccountIndex: 7,
        profiles: [{ accountIndex: 7, pubkey, source: 'bogus', externalChain: 1, addedAt: 123 }],
      },
    })
  );
  await useProfileStore.persist.rehydrate();
  expect(useProfileStore.getState().getActiveProfile()?.source).toBe('imported');
}

it('repairs a hydrated unknown source only after proving NIP-06 identity and clearing old chain caches', async () => {
  await hydrate('a'.repeat(64));
  render(
    <NostrKeysProvider defaultAccountIndex={7}>
      <Consumer />
    </NostrKeysProvider>
  );
  await waitFor(() => expect(context?.isReady).toBe(true));
  expect(deriveNostrKeys).toHaveBeenCalledWith('fixture-root', 7);
  expect(clearAccountDerivedCache).toHaveBeenCalledWith(7);
  expect(useProfileStore.getState().getActiveProfile()).toMatchObject({
    source: 'derived',
    externalChain: 0,
    addedAt: 123,
  });
  expect(deriveCashuMnemonic).toHaveBeenCalledWith('fixture-root', 7);
  expect(deriveCashuMnemonicForImported).not.toHaveBeenCalled();
  expect(context.cashuMnemonic).toBe('derived-chain-zero');
  expect(CocoManager.setAccountIndex).toHaveBeenCalledWith(7, false);
  expect(storeCashuMnemonic).toHaveBeenCalledWith(7, 'derived-chain-zero', 'root-hash');
});

it('shows Re-import on a pubkey mismatch and never configures the wallet', async () => {
  await hydrate('b'.repeat(64));
  const screen = render(
    <NostrKeysProvider defaultAccountIndex={7}>
      <Consumer />
    </NostrKeysProvider>
  );
  await waitFor(() => expect(screen.getByTestId('reimport')).toBeTruthy());
  expect(useProfileStore.getState().getActiveProfile()?.source).toBe('imported');
  expect(clearAccountDerivedCache).not.toHaveBeenCalled();
  expect(deriveCashuMnemonicForImported).not.toHaveBeenCalled();
  expect(CocoManager.setAccountIndex).not.toHaveBeenCalled();
});

it('refuses repair if an old chain cache cannot be deleted', async () => {
  await hydrate('a'.repeat(64));
  jest.mocked(clearAccountDerivedCache).mockResolvedValue(false);
  const screen = render(
    <NostrKeysProvider defaultAccountIndex={7}>
      <Consumer />
    </NostrKeysProvider>
  );
  await waitFor(() => expect(screen.getByTestId('reimport')).toBeTruthy());
  expect(useProfileStore.getState().getActiveProfile()?.source).toBe('imported');
  expect(CocoManager.setAccountIndex).not.toHaveBeenCalled();
});

it('keeps recovery reachable at the provider boundary when secure storage is locked', async () => {
  useSecureStoreState.setState({ secureStoreState: 'locked', errorName: 'Error' });
  const screen = render(
    <NostrKeysProvider>
      <Consumer />
    </NostrKeysProvider>
  );
  expect(screen.getByTestId('locked')).toBeTruthy();
});
