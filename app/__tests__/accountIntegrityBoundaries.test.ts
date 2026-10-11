/** @jest-environment node */
import { bytesToHex } from '@noble/hashes/utils.js';
import type AsyncStorageModule from '@react-native-async-storage/async-storage';
import * as nip19 from 'nostr-tools/nip19';
import { getPublicKey } from 'nostr-tools/pure';

import {
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
  deriveCashuWalletSeed,
  deriveNostrKeys,
  getRootSeed,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';
import { hashMnemonic } from '@/shared/lib/nostr/secureStorage';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';

import { fixture as E17 } from './releaseFixtures/E17-0.1.0';
import { fixture as E18 } from './releaseFixtures/E18-0.1.1';
import { fixture as E19 } from './releaseFixtures/E19-0.1.2';

const RELEASED = [E17, E18, E19].map((fixture) => ({
  fixture,
  epoch: fixture.epoch,
  versions: fixture.versions.join(', '),
}));

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
    cashuLog: noop,
    initLog: jest.fn(),
    initPhase: (_name: string, run: () => unknown) => run(),
    redactError: (error: unknown) => String(error),
  };
});
// The check stretches the phrase for itself, natively where it can. Here both
// stretches are Node's PBKDF2, counted, and the native one can be broken.
const mockStretch = {
  native: [] as string[],
  js: [] as string[],
  nativeBroken: false,
  nativeMissing: false,
};
jest.mock('@/shared/lib/nostr/phraseStretch', () => {
  const stretch = (phrase: string) =>
    new Uint8Array(
      jest
        .requireActual('node:crypto')
        .pbkdf2Sync(phrase.normalize('NFKD'), 'mnemonic', 2048, 64, 'sha512')
    );
  return {
    stretchPhraseNative: async (phrase: string) => {
      if (mockStretch.nativeMissing) return null;
      mockStretch.native.push(phrase);
      return mockStretch.nativeBroken ? new Uint8Array(64).fill(7) : stretch(phrase);
    },
    stretchPhraseJs: (phrase: string) => {
      mockStretch.js.push(phrase);
      return stretch(phrase);
    },
  };
});
jest.mock('@/shared/lib/profile/appRestart', () => ({ restartApp: jest.fn(() => true) }));
jest.mock('@/shared/lib/cashu/manager', () => ({
  CocoManager: {
    cleanup: jest.fn().mockResolvedValue(undefined),
    isReadyForCleanup: jest.fn(() => true),
    getCleanupReadiness: jest.fn(() => ({ ready: true })),
  },
}));
jest.mock('@/shared/stores/runtime/paymentStatusStore', () => ({
  usePaymentStatusStore: { getState: () => ({ setActive: jest.fn() }) },
}));
jest.mock('@/shared/stores/runtime/popupStore', () => ({
  usePopupStore: { getState: () => ({ destroySheet: jest.fn(), close: jest.fn() }) },
}));

/**
 * The integrity check at the places it guards, against real derivation and a
 * real (in-memory) keychain. The install is shaped like one that 0.1.3 wrote:
 * two derived accounts and an imported one, each with the caches that release
 * kept. It must pass untouched; each kind of damage must stop the flow it
 * reaches, and no check may write anything.
 */
const ROOT =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_ROOT = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

const importedSecret = new Uint8Array(32).fill(9);
const importedPubkey = getPublicKey(importedSecret);
const importedIndex = pubkeyToAccountNumber(importedPubkey);

/**
 * The account flows keep module-level state (a transition that ended in a
 * restart stays in flight, by design), so every test loads a fresh copy of
 * everything stateful. The keychain map above is shared with each copy.
 */
function freshModules() {
  jest.resetModules();
  return {
    ...(require('@/shared/lib/nostr/accountIntegrity') as typeof import('@/shared/lib/nostr/accountIntegrity')),
    ...(require('@/shared/lib/profile/profileSessionOrchestrator') as typeof import('@/shared/lib/profile/profileSessionOrchestrator')),
    ...(require('@/shared/stores/global/profileStore') as typeof import('@/shared/stores/global/profileStore')),
    ...(require('@/shared/stores/global/settingsStore') as typeof import('@/shared/stores/global/settingsStore')),
    AsyncStorage: require('@react-native-async-storage/async-storage') as typeof AsyncStorageModule,
    SecureStore: require('expo-secure-store') as typeof import('expo-secure-store'),
    CocoManager: (
      require('@/shared/lib/cashu/manager') as {
        CocoManager: { cleanup: jest.Mock; isReadyForCleanup: jest.Mock };
      }
    ).CocoManager,
    restartApp: jest.mocked(
      (
        require('@/shared/lib/profile/appRestart') as typeof import('@/shared/lib/profile/appRestart')
      ).restartApp
    ),
  };
}
let m: ReturnType<typeof freshModules>;

function writeDerivedCaches(root: string, accountIndex: number) {
  const keys = deriveNostrKeys(root, accountIndex);
  const walletPhrase = deriveCashuMnemonic(root, accountIndex);
  const mnemonicHash = hashMnemonic(root);
  mockSecure.set(
    `derived_keys_${accountIndex}`,
    JSON.stringify({
      npub: keys.npub,
      nsec: keys.nsec,
      pubkey: keys.pubkey,
      privateKeyHex: bytesToHex(keys.privateKey),
      mnemonicHash,
    })
  );
  mockSecure.set(
    `cashu_mnemonic_${accountIndex}`,
    JSON.stringify({ value: walletPhrase, mnemonicHash })
  );
  mockSecure.set(
    `cashu_seed_${accountIndex}`,
    JSON.stringify({
      hex: bytesToHex(deriveCashuWalletSeed(walletPhrase)),
      mnemonicHash: hashMnemonic(walletPhrase),
    })
  );
  return keys;
}

/** What a 0.1.3 install with two derived accounts and one imported account holds. */
function install013(): ProfileEntry[] {
  mockSecure.clear();
  mockSecure.set('user_mnemonic', ROOT);
  const first = writeDerivedCaches(ROOT, 0);
  const second = writeDerivedCaches(ROOT, 1);
  const importedPhrase = deriveCashuMnemonicForImported(ROOT, importedIndex);
  mockSecure.set(`imported_nsec_${importedPubkey}`, nip19.nsecEncode(importedSecret));
  mockSecure.set(
    `cashu_mnemonic_${importedIndex}`,
    JSON.stringify({ value: importedPhrase, mnemonicHash: hashMnemonic(ROOT) })
  );
  mockSecure.set(
    `cashu_seed_${importedIndex}`,
    JSON.stringify({
      hex: bytesToHex(deriveCashuWalletSeed(importedPhrase)),
      mnemonicHash: hashMnemonic(importedPhrase),
    })
  );
  const profiles: ProfileEntry[] = [
    // 0.1.3 wrote no `source` on a derived row.
    { accountIndex: 0, pubkey: first.pubkey, addedAt: 1, cachedBalanceSats: 63 },
    { accountIndex: 1, pubkey: second.pubkey, addedAt: 2 },
    {
      accountIndex: importedIndex,
      pubkey: importedPubkey,
      addedAt: 3,
      source: 'imported',
      externalChain: 1,
    },
  ];
  m.useProfileStore.setState({ activeAccountIndex: 0, profiles });
  return profiles;
}

const secureWrites = () => [
  ...jest.mocked(m.SecureStore.setItemAsync).mock.calls,
  ...jest.mocked(m.SecureStore.deleteItemAsync).mock.calls,
];
const diskWrites = () => [
  ...jest.mocked(m.AsyncStorage.setItem).mock.calls,
  ...jest.mocked(m.AsyncStorage.removeItem).mock.calls,
];
const failureOf = (accountIndex: number) =>
  m.getIntegrityFailures().find((failure) => failure.accountIndex === accountIndex);
const row = (accountIndex: number) =>
  m.useProfileStore.getState().profiles.find((profile) => profile.accountIndex === accountIndex)!;
/** Put another key on a saved row, as a bug or a mismatched restore would. */
function damageRow(accountIndex: number, pubkey: string) {
  m.useProfileStore.setState({
    profiles: m.useProfileStore
      .getState()
      .profiles.map((profile) =>
        profile.accountIndex === accountIndex ? { ...profile, pubkey } : profile
      ),
  });
}

beforeEach(async () => {
  Object.assign(mockStretch, { native: [], js: [], nativeBroken: false, nativeMissing: false });
  m = freshModules();
  install013();
  // Let the profile store's own save of the fixture land before counting writes.
  await new Promise((resolve) => setImmediate(resolve));
  jest.clearAllMocks();
  m.restartApp.mockReturnValue(true);
  m.CocoManager.cleanup.mockResolvedValue(undefined);
  m.CocoManager.isReadyForCleanup.mockReturnValue(true);
});

describe('a healthy install written by 0.1.3', () => {
  it('passes every account in full, and the check writes nothing', async () => {
    const before = new Map(mockSecure);
    for (const profile of m.useProfileStore.getState().profiles) {
      const result = await m.verifyStoredAccount(profile, { thorough: true });
      expect(result).toMatchObject({ ok: true, complete: true, mismatches: [] });
      // The caches really were compared, not skipped as stale.
      expect(result?.checks.find((check) => check.invariant === 'cache.wallet-seed')).toEqual({
        invariant: 'cache.wallet-seed',
        status: 'pass',
      });
    }
    expect(mockSecure).toEqual(before);
    expect(secureWrites()).toEqual([]);
    expect(diskWrites()).toEqual([]);
  });

  it('passes the background pass without raising anything', async () => {
    await m.verifyOtherAccountsInBackground(0, () => true);
    expect(m.getIntegrityFailures()).toEqual([]);
    expect(secureWrites()).toEqual([]);
    expect(diskWrites()).toEqual([]);
  });

  it('lets a switch to another of its accounts go ahead', async () => {
    expect(await m.switchToExistingProfile({ accountIndex: 1 })).toBe(true);
    expect(await m.AsyncStorage.getItem('profile-store')).toContain('"activeAccountIndex":1');
  });

  it('is still believed when the native key stretch returns nonsense', async () => {
    // The native stretch is only a faster second opinion. A mismatch counts
    // once the reference implementation agrees.
    mockStretch.nativeBroken = true;
    expect(await m.verifyStoredAccount(row(1), { thorough: true })).toMatchObject({ ok: true });
    expect(mockStretch.native).toContain(ROOT);
    expect(mockStretch.js).toContain(ROOT);
  });

  it('stretches the recovery phrase once for the whole launch', async () => {
    for (const profile of m.useProfileStore.getState().profiles) {
      await m.verifyStoredAccount(profile, { thorough: true });
    }
    await m.verifyOtherAccountsInBackground(0, () => true);
    expect([...mockStretch.native, ...mockStretch.js].filter((phrase) => phrase === ROOT)).toEqual([
      ROOT,
    ]);
  });

  it('does not hold the JS thread for accounts that are not being opened', async () => {
    // No native stretch on this device. The root is stretched once, for the
    // active account; the others' wallet seed caches wait until they are opened.
    mockStretch.nativeMissing = true;
    expect(await m.verifyStoredAccount(row(0), { thorough: true })).toMatchObject({
      ok: true,
      complete: true,
    });
    const afterActive = mockStretch.js.length;

    await m.verifyOtherAccountsInBackground(0, () => true);

    expect(mockStretch.js.length).toBe(afterActive);
    expect(m.getIntegrityFailures()).toEqual([]);
  });

  it('does not take the app\u2019s own root seed on trust', async () => {
    // The seed the app derives with, gone wrong in memory. A check that
    // borrowed it would compare the damage with itself and pass or fail at
    // random; this one stretches the phrase again.
    const appSeed = getRootSeed(ROOT);
    const intact = new Uint8Array(appSeed);
    appSeed.fill(0);
    try {
      expect(await m.verifyStoredAccount(row(0), { thorough: true })).toMatchObject({
        ok: true,
        complete: true,
      });
    } finally {
      appSeed.set(intact);
    }
  });
});

describe.each(RELEASED)('the install $epoch left ($versions)', ({ fixture }) => {
  // Written from each release's own source by releaseFixtures/, not by
  // today's functions: the key caches, their hashes and the profile rows are
  // what those builds put on disk.
  beforeEach(async () => {
    mockSecure.clear();
    for (const [key, value] of Object.entries(fixture.secureStore)) mockSecure.set(key, value);
    const saved = fixture.asyncStorage['profile-store'] as {
      state: { activeAccountIndex: number; profiles: ProfileEntry[] };
    };
    m.useProfileStore.setState(saved.state);
    await new Promise((resolve) => setImmediate(resolve));
    jest.clearAllMocks();
  });

  it('passes every account in full, and the check writes nothing', async () => {
    const profiles = m.useProfileStore.getState().profiles;
    expect(profiles.map((profile) => profile.source ?? 'derived').sort()).toEqual([
      'derived',
      'derived',
      'imported',
    ]);
    for (const profile of profiles) {
      const result = await m.verifyStoredAccount(profile, { thorough: true });
      expect(result).toMatchObject({ ok: true, complete: true, mismatches: [] });
      // Its caches were compared, not skipped: this build reads them as current.
      for (const invariant of ['cache.wallet-phrase', 'cache.wallet-seed'] as const) {
        expect(result?.checks.find((check) => check.invariant === invariant)).toEqual({
          invariant,
          status: 'pass',
        });
      }
    }
    expect(secureWrites()).toEqual([]);
    expect(diskWrites()).toEqual([]);
  });
});

describe('damage the check must find', () => {
  it('finds a derived row whose key the phrase does not derive, in the background', async () => {
    damageRow(1, deriveNostrKeys(OTHER_ROOT, 1).pubkey);
    await new Promise((resolve) => setImmediate(resolve));
    jest.clearAllMocks();

    await m.verifyOtherAccountsInBackground(0, () => true);

    expect(failureOf(1)).toMatchObject({
      accountIndex: 1,
      source: 'derived',
      ok: false,
    });
    expect(failureOf(1)?.mismatches.map((m) => m.invariant)).toEqual(
      expect.arrayContaining(['row.derived-pubkey', 'cache.derived-keys-row'])
    );
    // Found, recorded, and nothing touched: no repair of the row or the caches.
    expect(secureWrites()).toEqual([]);
    expect(diskWrites()).toEqual([]);
  });

  it("finds an imported row whose stored key is another identity's", async () => {
    mockSecure.set(`imported_nsec_${importedPubkey}`, nip19.nsecEncode(new Uint8Array(32).fill(4)));
    const result = await m.verifyStoredAccount(row(importedIndex), { thorough: true });
    expect(result?.mismatches.map((m) => m.invariant)).toEqual(['row.imported-key']);
  });

  it('leaves a blob it cannot read where it is', async () => {
    mockSecure.set('derived_keys_1', '{not json');
    const result = await m.verifyStoredAccount(row(1), { thorough: true });
    expect(result?.ok).toBe(true);
    expect(mockSecure.get('derived_keys_1')).toBe('{not json');
    expect(secureWrites()).toEqual([]);
  });

  it('reports nothing when the phrase itself cannot be read', async () => {
    mockSecure.delete('user_mnemonic');
    expect(await m.verifyStoredAccount(row(0), { thorough: true })).toBeNull();
  });
});

describe('changing the active account', () => {
  it('refuses a mismatched target and leaves the active account as it was', async () => {
    damageRow(1, deriveNostrKeys(OTHER_ROOT, 1).pubkey);
    await new Promise((resolve) => setImmediate(resolve));
    jest.clearAllMocks();

    expect(await m.switchToExistingProfile({ accountIndex: 1 })).toBe(false);

    expect(m.useProfileStore.getState().activeAccountIndex).toBe(0);
    // The wallet was not closed and the target was never recorded.
    expect(m.CocoManager.cleanup).not.toHaveBeenCalled();
    expect(m.restartApp).not.toHaveBeenCalled();
    expect(
      jest.mocked(m.AsyncStorage.setItem).mock.calls.filter(([key]) => key === 'profile-store')
    ).toEqual([]);
    expect(secureWrites()).toEqual([]);
    expect(failureOf(1)).toMatchObject({ accountIndex: 1 });
    // The lock was given back: the sound account can still be switched to.
    expect(await m.switchToExistingProfile({ accountIndex: importedIndex })).toBe(true);
  });

  it('lets a stopped account hand over to a sound one without an open wallet', async () => {
    m.CocoManager.isReadyForCleanup.mockReturnValue(false);
    expect(await m.switchToExistingProfile({ accountIndex: 1 })).toBe(false);
    expect(await m.switchToExistingProfile({ accountIndex: 1, fromStoppedAccount: true })).toBe(
      true
    );
    expect(m.restartApp).toHaveBeenCalled();
  });
});

describe('more than one mismatched account', () => {
  it('keeps every failure, and closing one leaves the other', async () => {
    damageRow(0, deriveNostrKeys(OTHER_ROOT, 0).pubkey);
    damageRow(1, deriveNostrKeys(OTHER_ROOT, 1).pubkey);

    // The inactive account's failure arrives first, as it does when a
    // refused switch records it while the active account is still being checked.
    m.reportIntegrityFailure((await m.verifyStoredAccount(row(1), { thorough: true }))!);
    m.reportIntegrityFailure((await m.verifyStoredAccount(row(0), { thorough: true }))!);

    expect(m.getIntegrityFailures().map((failure) => failure.accountIndex)).toEqual([1, 0]);
    m.dismissIntegrityFailure(1);
    expect(m.getIntegrityFailures().map((failure) => failure.accountIndex)).toEqual([0]);
  });
});

describe('adding a profile', () => {
  it('refuses to record a new profile under a key the phrase does not derive', async () => {
    const wrong = deriveNostrKeys(OTHER_ROOT, 2).pubkey;

    expect(
      await m.createAndSwitchProfile({ getKeysForAccount: async () => ({ pubkey: wrong }) })
    ).toBe(false);

    expect(m.useProfileStore.getState().profiles.some((p) => p.pubkey === wrong)).toBe(false);
    expect(m.useProfileStore.getState().activeAccountIndex).toBe(0);
    expect(m.restartApp).not.toHaveBeenCalled();
  });

  it('records one the phrase does derive', async () => {
    const next = m.useProfileStore.getState().getNextAccountIndex();
    const pubkey = deriveNostrKeys(ROOT, next).pubkey;

    expect(await m.createAndSwitchProfile({ getKeysForAccount: async () => ({ pubkey }) })).toBe(
      true
    );

    expect(row(next).pubkey).toBe(pubkey);
  });

  it('refuses an import whose key, public key and account number disagree', async () => {
    const secret = new Uint8Array(32).fill(5);
    const pubkeyHex = getPublicKey(secret);
    const good = {
      accountIndex: pubkeyToAccountNumber(pubkeyHex),
      pubkeyHex,
      nsec: nip19.nsecEncode(secret),
    };

    for (const bad of [
      { ...good, nsec: nip19.nsecEncode(new Uint8Array(32).fill(6)) },
      { ...good, accountIndex: good.accountIndex + 1 },
      { ...good, nsec: 'nsec1example' },
    ]) {
      expect(await m.importAndSwitchProfile(bad)).toBe('key-mismatch');
    }
    expect(secureWrites()).toEqual([]);
    expect(m.useProfileStore.getState().hasPubkey(pubkeyHex)).toBe(false);

    expect(await m.importAndSwitchProfile(good)).toBe('switching');
  });
});

describe('recovery', () => {
  beforeEach(() => {
    m.useSettingsStore.setState({ hasSeenOnboarding: true });
  });

  it('refuses a phrase that does not derive the saved accounts, and keeps the old one', async () => {
    expect(await m.recoverMnemonicSession(OTHER_ROOT)).toBe(false);
    expect(mockSecure.get('user_mnemonic')).toBe(ROOT);
    expect(m.CocoManager.cleanup).not.toHaveBeenCalled();
  });

  it('accepts the phrase the saved accounts came from, and the check then passes', async () => {
    // The 0.1.3 backup-restore case, put right by the person: the device
    // holds another phrase, and they enter the one their account was made with.
    mockSecure.set('user_mnemonic', OTHER_ROOT);
    expect((await m.verifyStoredAccount(row(0), { thorough: true }))?.ok).toBe(false);

    expect(await m.recoverMnemonicSession(ROOT)).toBe(true);

    expect(mockSecure.get('user_mnemonic')).toBe(ROOT);
    for (const profile of m.useProfileStore.getState().profiles) {
      expect(await m.verifyStoredAccount(profile, { thorough: true })).toMatchObject({ ok: true });
    }
  });

  it('does not lock an account recovered during onboarding with a different phrase', async () => {
    // Onboarding recovery empties the profile list, then the next start
    // makes account 0 from the new phrase. The old phrase's caches are still
    // in the keychain under the same names.
    m.useSettingsStore.setState({ hasSeenOnboarding: false });
    expect(await m.recoverMnemonicSession(OTHER_ROOT)).toBe(true);
    expect(mockSecure.get('user_mnemonic')).toBe(OTHER_ROOT);
    expect(JSON.parse((await m.AsyncStorage.getItem('profile-store'))!).state.profiles).toEqual([]);

    const recovered = {
      accountIndex: 0,
      pubkey: deriveNostrKeys(OTHER_ROOT, 0).pubkey,
      addedAt: 9,
    };
    const result = await m.verifyStoredAccount(recovered, { thorough: true });
    expect(result).toMatchObject({ ok: true, complete: true });
    expect(result?.checks.find((check) => check.invariant === 'cache.derived-keys-row')).toEqual({
      invariant: 'cache.derived-keys-row',
      status: 'not-checked',
      reason: 'stale',
    });
  });
});

describe('opening a wallet', () => {
  it("accepts the row's own account and signer key", () => {
    expect(
      m.checkStagedCredentials({
        accountIndex: 1,
        isImported: false,
        signerKey: deriveNostrKeys(ROOT, 1).privateKey,
      })
    ).toMatchObject({ ok: true });
    expect(
      m.checkStagedCredentials({
        accountIndex: importedIndex,
        isImported: true,
        signerKey: importedSecret,
      })
    ).toMatchObject({ ok: true });
  });

  it('refuses a signer key staged for another account', () => {
    const result = m.checkStagedCredentials({
      accountIndex: 1,
      isImported: false,
      signerKey: deriveNostrKeys(ROOT, 0).privateKey,
    });
    expect(result?.mismatches.map((m) => m.invariant)).toEqual(['session.signer-row']);
  });

  it('refuses an imported account about to be opened as a derived one', () => {
    // The wallet would stretch its seed from the wrong chain.
    const result = m.checkStagedCredentials({
      accountIndex: importedIndex,
      isImported: false,
      signerKey: importedSecret,
    });
    expect(result?.mismatches.map((m) => m.invariant)).toEqual(['session.account']);
  });

  it('has nothing to compare before the first profile row exists', () => {
    m.useProfileStore.setState({ profiles: [] });
    expect(
      m.checkStagedCredentials({ accountIndex: 0, isImported: false, signerKey: null })
    ).toBeNull();
  });
});
