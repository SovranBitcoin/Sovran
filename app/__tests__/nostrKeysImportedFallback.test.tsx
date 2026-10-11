/** @jest-environment node */
import { render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NostrKeysProvider, useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import {
  useProfileStore,
  PROFILE_STORE_PERSIST_VERSION,
} from '@/shared/stores/global/profileStore';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';
import { storeCashuMnemonic, storeDerivedKeys } from '@/shared/lib/nostr/secureStorage';
import { dismissIntegrityFailure, verifyStoredAccount } from '@/shared/lib/nostr/accountIntegrity';
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
  hashMnemonic: () => 'root-hash',
  // No imported key, and a wallet phrase cache left by whatever chain the
  // row was last loaded under.
  readAccountSecretsUnchanged: jest.fn(async () => ({
    importedNsec: null,
    derivedKeys: null,
    walletPhrase: { value: 'wrong-chain-cache', mnemonicHash: 'other-hash' },
    walletSeed: null,
    keptDerivedNsec: null,
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
// Derivation is faked in this file ('a' repeated is "what the phrase derives"),
// so the integrity check is faked to match. The real check, against real
// keys, is in accountIntegrityStartup.test.tsx.
jest.mock('@/shared/lib/nostr/accountIntegrity', () => ({
  ...jest.requireActual('@/shared/lib/nostr/accountIntegrity'),
  verifyOtherAccountsInBackground: jest.fn(async () => {}),
  phraseDerivesAccount: jest.fn(
    async (_phrase: string, _index: number, pubkey: string) => pubkey === 'a'.repeat(64)
  ),
  verifyStoredAccount: jest.fn(async (row: { accountIndex: number; pubkey: string }) => ({
    accountIndex: row.accountIndex,
    source: 'derived',
    pubkeyPrefix: row.pubkey.slice(0, 8),
    ok: row.pubkey === 'a'.repeat(64),
    complete: true,
    checks: [],
    mismatches: [],
    diagnosticCode: null,
  })),
}));
jest.mock('@/shared/blocks/AccountMismatchScreen', () => ({
  AccountMismatchScreen: () =>
    jest.requireActual('react').createElement('View', { testID: 'mismatch' }),
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

it('corrects a hydrated unknown source once the account has passed, and deletes nothing', async () => {
  await hydrate('a'.repeat(64));
  render(
    <NostrKeysProvider defaultAccountIndex={7}>
      <Consumer />
    </NostrKeysProvider>
  );
  await waitFor(() => expect(context?.isReady).toBe(true));
  expect(deriveNostrKeys).toHaveBeenCalledWith('fixture-root', 7);
  // Checked as the derived account it is about to become, before the label moves.
  expect(verifyStoredAccount).toHaveBeenCalledWith(
    expect.objectContaining({ accountIndex: 7, source: 'derived' }),
    expect.objectContaining({ thorough: true })
  );
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
  expect(await screen.findByTestId('reimport')).toBeOnTheScreen();
  expect(useProfileStore.getState().getActiveProfile()?.source).toBe('imported');
  expect(deriveCashuMnemonicForImported).not.toHaveBeenCalled();
  expect(CocoManager.setAccountIndex).not.toHaveBeenCalled();
});

it('stops a derived account whose saved row names another key, and never configures the wallet', async () => {
  // The state an Android backup restore left behind on 0.1.3: the profile row
  // came back, the keychain did not, and a new root was generated under it.
  // 0.1.3 ran on in it. This build stops, and changes nothing.
  jest.mocked(AsyncStorage.getItem).mockResolvedValueOnce(
    JSON.stringify({
      version: PROFILE_STORE_PERSIST_VERSION,
      state: {
        activeAccountIndex: 7,
        profiles: [{ accountIndex: 7, pubkey: 'b'.repeat(64), addedAt: 123 }],
      },
    })
  );
  await useProfileStore.persist.rehydrate();
  jest.mocked(AsyncStorage.setItem).mockClear();

  const screen = render(
    <NostrKeysProvider defaultAccountIndex={7}>
      <Consumer />
    </NostrKeysProvider>
  );

  expect(await screen.findByTestId('mismatch')).toBeOnTheScreen();
  expect(screen.queryByTestId('reimport')).toBeNull();
  expect(CocoManager.setAccountIndex).not.toHaveBeenCalled();
  expect(CocoManager.setCashuMnemonic).not.toHaveBeenCalled();
  // The row is left as it is, and no cache is written over.
  expect(useProfileStore.getState().getActiveProfile()?.pubkey).toBe('b'.repeat(64));
  expect(storeCashuMnemonic).not.toHaveBeenCalled();
  expect(storeDerivedKeys).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  dismissIntegrityFailure(7);
});

it('leaves the label alone when the account does not pass its check', async () => {
  await hydrate('a'.repeat(64));
  jest.mocked(verifyStoredAccount).mockResolvedValueOnce({
    accountIndex: 7,
    source: 'derived',
    pubkeyPrefix: 'aaaaaaaa',
    ok: false,
    complete: true,
    checks: [],
    mismatches: [],
    diagnosticCode: 'AM1-D7-CW-x-x',
  });
  const screen = render(
    <NostrKeysProvider defaultAccountIndex={7}>
      <Consumer />
    </NostrKeysProvider>
  );
  expect(await screen.findByTestId('mismatch')).toBeOnTheScreen();
  expect(useProfileStore.getState().getActiveProfile()?.source).toBe('imported');
  expect(CocoManager.setAccountIndex).not.toHaveBeenCalled();
  expect(storeCashuMnemonic).not.toHaveBeenCalled();
  dismissIntegrityFailure(7);
});

it('keeps recovery reachable at the provider boundary when secure storage is locked', async () => {
  useSecureStoreState.setState({ secureStoreState: 'locked', errorName: 'Error' });
  const screen = render(
    <NostrKeysProvider>
      <Consumer />
    </NostrKeysProvider>
  );
  expect(screen.getByTestId('locked')).toBeOnTheScreen();
});
