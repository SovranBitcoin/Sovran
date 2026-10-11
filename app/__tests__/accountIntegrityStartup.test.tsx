/** @jest-environment node */
import { bytesToHex } from '@noble/hashes/utils.js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

import { CocoManager } from '@/shared/lib/cashu/manager';
import {
  dismissIntegrityFailure,
  getIntegrityFailures,
  reportIntegrityFailure,
  verifyStoredAccount,
} from '@/shared/lib/nostr/accountIntegrity';
import {
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
  deriveCashuWalletSeed,
  deriveNostrKeys,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';
import { hashMnemonic } from '@/shared/lib/nostr/secureStorage';
import { NostrKeysProvider, useNostrKeysContext } from '@/shared/providers/NostrKeysProvider';
import { useProfileStore, type ProfileEntry } from '@/shared/stores/global/profileStore';
import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecure.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecure.delete(key);
  }),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return {
    log: noop,
    storeLog: noop,
    nostrLog: noop,
    initLog: jest.fn(),
    useInitMount: jest.fn(),
    redactError: () => 'redacted',
    initPhase: (_name: string, run: () => unknown) => run(),
  };
});
// The check stretches the phrase for itself. Node's PBKDF2 makes that quick
// and the same on every run, whatever the test environment offers natively.
jest.mock('@/shared/lib/nostr/phraseStretch', () => {
  const stretch = (phrase: string) =>
    new Uint8Array(
      jest
        .requireActual('node:crypto')
        .pbkdf2Sync(phrase.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512')
    );
  return {
    stretchPhraseNative: async (phrase: string) => stretch(phrase),
    stretchPhraseJs: stretch,
  };
});
// The real background pass, with its promise kept so a test can wait for it
// to finish instead of for an amount of time.
const mockBackground: { finished: Promise<void> | null } = { finished: null };
jest.mock('@/shared/lib/nostr/accountIntegrity', () => {
  const actual = jest.requireActual('@/shared/lib/nostr/accountIntegrity');
  return {
    ...actual,
    verifyOtherAccountsInBackground: (...args: unknown[]) =>
      (mockBackground.finished = actual.verifyOtherAccountsInBackground(...args)),
  };
});
jest.mock('@/shared/providers/InitializationProvider', () => {
  const stage = { canStart: true, log: jest.fn(), complete: jest.fn(), error: jest.fn() };
  return { useInitializationStage: () => stage };
});
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: { setAccountIndex: jest.fn(), setCashuMnemonic: jest.fn() },
}));
jest.mock('@/shared/lib/profile/ownProfileSync', () => ({ syncOwnProfiles: jest.fn() }));
jest.mock('@/shared/blocks/KeyRecoveryScreen', () => ({
  KeyRecoveryScreen: () =>
    jest.requireActual('react').createElement('View', { testID: 'key-recovery' }),
}));
// The screen itself is covered in accountMismatchScreen.test.tsx; here only
// where it appears, for which account, and whether it stops the app.
jest.mock('@/shared/blocks/AccountMismatchScreen', () => ({
  AccountMismatchScreen: (props: { failure: { accountIndex: number }; stopped: boolean }) =>
    jest.requireActual('react').createElement('View', {
      testID: props.stopped ? 'mismatch-stopped' : 'mismatch-cover',
      accessibilityLabel: `account ${props.failure.accountIndex}`,
    }),
}));

/**
 * Startup, with real derivation and a real (in-memory) keychain: a saved
 * account that does not follow from the recovery phrase lands on the critical
 * screen with nothing written; a healthy install written by 0.1.3 opens.
 */
const ROOT =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_ROOT = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

const importedSecret = new Uint8Array(32).fill(9);
const importedPubkey = getPublicKey(importedSecret);
const importedIndex = pubkeyToAccountNumber(importedPubkey);

/** The caches a release leaves for a derived account; `stamp` is the phrase they claim to be from. */
function writeCaches(root: string, accountIndex: number, stamp = root) {
  const keys = deriveNostrKeys(root, accountIndex);
  mockSecure.set(
    `derived_keys_${accountIndex}`,
    JSON.stringify({
      npub: keys.npub,
      nsec: keys.nsec,
      pubkey: keys.pubkey,
      privateKeyHex: bytesToHex(keys.privateKey),
      mnemonicHash: hashMnemonic(stamp),
    })
  );
  mockSecure.set(
    `cashu_mnemonic_${accountIndex}`,
    JSON.stringify({
      value: deriveCashuMnemonic(root, accountIndex),
      mnemonicHash: hashMnemonic(stamp),
    })
  );
}

const derivedRow = (root: string, accountIndex: number): ProfileEntry => ({
  accountIndex,
  pubkey: deriveNostrKeys(root, accountIndex).pubkey,
  addedAt: accountIndex + 1,
});
const importedRow: ProfileEntry = {
  accountIndex: importedIndex,
  pubkey: importedPubkey,
  addedAt: 9,
  source: 'imported',
  externalChain: 1,
};

/** Two derived accounts and an imported one, as 0.1.3 left them. */
function install013(activeAccountIndex = 0) {
  mockSecure.set('user_mnemonic', ROOT);
  writeCaches(ROOT, 0);
  writeCaches(ROOT, 1);
  mockSecure.set(`imported_nsec_${importedPubkey}`, nip19.nsecEncode(importedSecret));
  mockSecure.set(
    `cashu_mnemonic_${importedIndex}`,
    JSON.stringify({
      value: deriveCashuMnemonicForImported(ROOT, importedIndex),
      mnemonicHash: hashMnemonic(ROOT),
    })
  );
  useProfileStore.setState({
    activeAccountIndex,
    profiles: [derivedRow(ROOT, 0), derivedRow(ROOT, 1), importedRow],
  });
}

let context: ReturnType<typeof useNostrKeysContext> | null;
function Consumer() {
  context = useNostrKeysContext();
  return jest.requireActual('react').createElement('View', { testID: 'app' });
}

/** Everything the app could have changed on disk while starting. */
const writes = () => [
  ...jest.mocked(SecureStore.setItemAsync).mock.calls,
  ...jest.mocked(SecureStore.deleteItemAsync).mock.calls,
  ...jest.mocked(AsyncStorage.setItem).mock.calls,
  ...jest.mocked(AsyncStorage.removeItem).mock.calls,
];

async function start(accountIndex: number) {
  // The fixture's own save of the profile list must not count as the app's.
  await new Promise((resolve) => setImmediate(resolve));
  jest.clearAllMocks();
  return render(
    <NostrKeysProvider defaultAccountIndex={accountIndex}>
      <Consumer />
    </NostrKeysProvider>
  );
}

beforeEach(() => {
  mockSecure.clear();
  context = null;
  mockBackground.finished = null;
  for (const failure of getIntegrityFailures()) dismissIntegrityFailure(failure.accountIndex);
  useSecureStoreState.setState({ secureStoreState: 'available', errorName: null });
  useProfileStore.setState({ activeAccountIndex: 0, profiles: [] });
});

describe('a derived account whose saved key the phrase does not derive', () => {
  it('stops on the critical screen and writes nothing, with an empty keychain cache', async () => {
    // What a 0.1.3 Android backup restore left: the profile row came back, the
    // keychain did not, and a new phrase was generated under it.
    mockSecure.set('user_mnemonic', ROOT);
    const saved = derivedRow(OTHER_ROOT, 0);
    useProfileStore.setState({ activeAccountIndex: 0, profiles: [saved] });
    const keychain = new Map(mockSecure);

    const screen = await start(0);

    expect(await screen.findByTestId('mismatch-stopped')).toBeOnTheScreen();
    expect(screen.queryByTestId('app')).toBeNull();
    expect(screen.queryByTestId('key-recovery')).toBeNull();
    expect(CocoManager.setAccountIndex).not.toHaveBeenCalled();
    expect(CocoManager.setCashuMnemonic).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    expect(mockSecure).toEqual(keychain);
    expect(useProfileStore.getState().profiles).toEqual([saved]);
  });

  it('stops when 0.1.3 had already cached the other key, and leaves the cache alone', async () => {
    // 0.1.3 ran on in that state, so it cached the new phrase's key beside
    // the old row. The fast start derives nothing; the cache gives it away.
    mockSecure.set('user_mnemonic', ROOT);
    writeCaches(ROOT, 0);
    useProfileStore.setState({ activeAccountIndex: 0, profiles: [derivedRow(OTHER_ROOT, 0)] });
    const keychain = new Map(mockSecure);

    const screen = await start(0);

    expect(await screen.findByTestId('mismatch-stopped')).toBeOnTheScreen();
    expect(CocoManager.setCashuMnemonic).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
    expect(mockSecure).toEqual(keychain);
  });

  it('is caught before the account is ready when only a full derivation can tell', async () => {
    // Row and cache agree with each other, and the cache claims to be from
    // this phrase, but the phrase derives another key.
    mockSecure.set('user_mnemonic', ROOT);
    writeCaches(OTHER_ROOT, 0, ROOT);
    useProfileStore.setState({ activeAccountIndex: 0, profiles: [derivedRow(OTHER_ROOT, 0)] });

    const screen = await start(0);

    expect(await screen.findByTestId('mismatch-stopped')).toBeOnTheScreen();
    expect(context).toBeNull();
    expect(CocoManager.setAccountIndex).not.toHaveBeenCalled();
    expect(writes()).toEqual([]);
  });

  it('keeps a damaged key cache that may be the only copy of the old key', async () => {
    // The cache holds the row's key but one field of it is the wrong shape.
    // The ordinary reader deletes such a blob; here that would destroy the
    // key before the mismatch was even noticed.
    mockSecure.set('user_mnemonic', ROOT);
    const old = deriveNostrKeys(OTHER_ROOT, 0);
    const damaged = JSON.stringify({
      npub: 'not-an-npub',
      nsec: old.nsec,
      pubkey: old.pubkey,
      privateKeyHex: bytesToHex(old.privateKey),
      mnemonicHash: hashMnemonic(OTHER_ROOT),
    });
    mockSecure.set('derived_keys_0', damaged);
    useProfileStore.setState({ activeAccountIndex: 0, profiles: [derivedRow(OTHER_ROOT, 0)] });

    const screen = await start(0);

    expect(await screen.findByTestId('mismatch-stopped')).toBeOnTheScreen();
    expect(mockSecure.get('derived_keys_0')).toBe(damaged);
    expect(writes()).toEqual([]);
  });
});

describe('a sound key with a wrong wallet phrase cached beside it', () => {
  it('stops before anything below the key provider can open the wallet', async () => {
    // The signer, the row and the key cache are all right. Only the wallet
    // phrase cache is another account's, stamped as current: the wallet
    // would have opened under a seed that is not this account's.
    install013(0);
    mockSecure.set(
      'cashu_mnemonic_0',
      JSON.stringify({ value: deriveCashuMnemonic(ROOT, 1), mnemonicHash: hashMnemonic(ROOT) })
    );
    const keychain = new Map(mockSecure);

    const screen = await start(0);

    expect(await screen.findByTestId('mismatch-stopped')).toBeOnTheScreen();
    // Never ready, so no provider below it ever mounted, and nothing was staged.
    expect(context).toBeNull();
    expect(screen.queryByTestId('app')).toBeNull();
    expect(CocoManager.setAccountIndex).not.toHaveBeenCalled();
    expect(CocoManager.setCashuMnemonic).not.toHaveBeenCalled();
    expect(getIntegrityFailures()[0].mismatches.map((m) => m.invariant)).toEqual([
      'cache.wallet-phrase',
      'session.wallet-phrase',
    ]);
    expect(writes()).toEqual([]);
    expect(mockSecure).toEqual(keychain);
  });
});

describe('a healthy install written by 0.1.3', () => {
  it.each([
    ['its first derived account', 0],
    ['its second derived account', 1],
    ['its imported account', importedIndex],
  ])('opens on %s with no critical screen and nothing rewritten', async (_name, accountIndex) => {
    install013(accountIndex);
    const expected = useProfileStore
      .getState()
      .profiles.find((profile) => profile.accountIndex === accountIndex)!;

    const screen = await start(accountIndex);

    await waitFor(() => expect(context?.isReady).toBe(true));
    expect(context?.keys?.pubkey).toBe(expected.pubkey);
    expect(CocoManager.setAccountIndex).toHaveBeenCalledWith(
      accountIndex,
      accountIndex === importedIndex
    );
    // The other two accounts are looked at once this one is up.
    await waitFor(() => expect(mockBackground.finished).not.toBeNull());
    await mockBackground.finished;
    expect(screen.getByTestId('app')).toBeOnTheScreen();
    expect(screen.queryByTestId('mismatch-stopped')).toBeNull();
    expect(screen.queryByTestId('mismatch-cover')).toBeNull();
    expect(writes()).toEqual([]);
  });
});

describe('a wallet seed cache beside a healthy account', () => {
  const seedCache = (hex: string) =>
    JSON.stringify({ hex, mnemonicHash: hashMnemonic(deriveCashuMnemonic(ROOT, 0)) });

  it('starts when the cache is not a seed at all: the wallet remakes it later', async () => {
    install013(0);
    mockSecure.set('cashu_seed_0', seedCache('00'));

    const screen = await start(0);

    await waitFor(() => expect(context?.isReady).toBe(true));
    expect(screen.queryByTestId('mismatch-stopped')).toBeNull();
    // Left for the wallet's own reader: the check deletes nothing.
    expect(mockSecure.get('cashu_seed_0')).toBe(seedCache('00'));
    expect(writes()).toEqual([]);
  });

  it('stops when the cache is a real seed, but another wallet\u2019s', async () => {
    install013(0);
    mockSecure.set(
      'cashu_seed_0',
      seedCache(bytesToHex(deriveCashuWalletSeed(deriveCashuMnemonic(ROOT, 1))))
    );

    const screen = await start(0);

    expect(await screen.findByTestId('mismatch-stopped')).toBeOnTheScreen();
    expect(getIntegrityFailures()[0].mismatches.map((m) => m.invariant)).toEqual([
      'cache.wallet-seed',
    ]);
    expect(context).toBeNull();
  });
});

describe('a mismatch on an account that is not the active one', () => {
  it('covers the running app without stopping it, and names the other account', async () => {
    install013(0);
    useProfileStore.setState({
      profiles: [derivedRow(ROOT, 0), derivedRow(OTHER_ROOT, 1), importedRow],
    });

    const screen = await start(0);

    const cover = await screen.findByTestId('mismatch-cover');
    expect(cover.props.accessibilityLabel).toBe('account 1');
    // The sound account is still mounted underneath.
    expect(screen.getByTestId('app')).toBeOnTheScreen();
    expect(context?.isReady).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('never lets that cover hide a mismatch on the active account', async () => {
    // Both accounts are wrong. The other one's failure is recorded first, as
    // a refused switch would record it while this account is still loading.
    mockSecure.set('user_mnemonic', ROOT);
    const other = derivedRow(OTHER_ROOT, 1);
    useProfileStore.setState({
      activeAccountIndex: 0,
      profiles: [derivedRow(OTHER_ROOT, 0), other],
    });
    reportIntegrityFailure((await verifyStoredAccount(other, { thorough: true }))!);

    const screen = await start(0);

    const stopped = await screen.findByTestId('mismatch-stopped');
    expect(stopped.props.accessibilityLabel).toBe('account 0');
    expect(screen.queryByTestId('mismatch-cover')).toBeNull();
    expect(screen.queryByTestId('app')).toBeNull();

    // Closing the other account's failure changes nothing for this one.
    act(() => dismissIntegrityFailure(1));
    expect(screen.getByTestId('mismatch-stopped').props.accessibilityLabel).toBe('account 0');
  });
});
