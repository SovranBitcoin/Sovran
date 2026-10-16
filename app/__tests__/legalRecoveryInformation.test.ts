import { readRecoveryInformation } from '@/features/settings/lib/readRecoveryInformation';
import {
  hashMnemonic,
  readAccountSecretsUnchanged,
  retrieveMnemonic,
  retrieveImportedNsec,
} from '@/shared/lib/nostr/secureStorage';
import type { ProfileEntry } from '@/shared/stores/global/profileStore';
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  retrieveMnemonic: jest.fn(),
  retrieveImportedNsec: jest.fn(),
  hashMnemonic: (phrase: string) => `hash:${phrase.length}:${phrase.slice(0, 6)}`,
  readAccountSecretsUnchanged: jest.fn(async () => ({
    importedNsec: null,
    derivedKeys: null,
    walletPhrase: null,
    walletSeed: null,
    keptDerivedNsec: null,
  })),
}));
jest.mock('@/shared/lib/logger', () => ({ log: { info: jest.fn(), debug: jest.fn() } }));
// Public vectors shared with keyDerivation.test.ts.
const ROOT_MNEMONIC =
  'leader monkey parrot ring guide accident before fence cannon height naive bean';
const IMPORTED_NSEC = 'nsec1jlpx0y7gffw63zrhv8fu2lawrcxl7evtz6w5v67urh59j4l0fsys7hr66h';
const OTHER_NSEC = 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp';
const profile: ProfileEntry = {
  accountIndex: 17,
  pubkey: '9969973b30f3e1912ea1607d3f7beab11c7cd723ae932d451bdbbd9ce9dc2bfc',
  addedAt: 0,
  source: 'imported',
};
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readAccountSecretsUnchanged).mockResolvedValue({
    importedNsec: null,
    derivedKeys: null,
    walletPhrase: null,
    walletSeed: null,
    keptDerivedNsec: null,
  });
  jest.mocked(retrieveMnemonic).mockResolvedValue(ROOT_MNEMONIC);
  jest.mocked(retrieveImportedNsec).mockResolvedValue(IMPORTED_NSEC);
});
test('imported profiles use their own verified key and imported Cashu derivation without switching the active account', async () => {
  expect(await readRecoveryInformation(profile)).toEqual({
    mnemonic: ROOT_MNEMONIC,
    nsec: IMPORTED_NSEC,
    cashuMnemonic:
      'amazing small ankle organ august aisle assist bicycle win address cloth orient melt toilet obtain certain add orphan cube six bomb section spring lab',
  });
  expect(retrieveImportedNsec).toHaveBeenCalledWith(profile.pubkey);
});
test('rejects an imported key for a different identity instead of displaying a misleading backup', async () => {
  jest.mocked(retrieveImportedNsec).mockResolvedValue(OTHER_NSEC);
  await expect(readRecoveryInformation(profile)).rejects.toThrow('does not match');
});
test('missing root does not hide an available imported identity or manufacture wallet recovery data', async () => {
  jest.mocked(retrieveMnemonic).mockResolvedValue(null);
  expect(await readRecoveryInformation(profile)).toEqual({
    mnemonic: null,
    cashuMnemonic: null,
    nsec: IMPORTED_NSEC,
  });
  await expect(readRecoveryInformation(null)).rejects.toThrow('unavailable');
});

// The account 0 key and wallet phrase of the NIP-06 vector above.
const derivedProfile: ProfileEntry = {
  accountIndex: 0,
  pubkey: '17162c921dc4d2518f9a101db33695df1afb56ab82f5ff3e5da6eec3ca5cd917',
  addedAt: 0,
};
const DERIVED_WALLET_PHRASE =
  'bitter session sketch page tissue silent purity mix begin series arrow various pigeon destroy woman judge agree marine seek crush change alone liar tortoise';
const OTHER_WALLET_PHRASE =
  'omit minute century number region device breeze trophy enter phrase item harsh shove garbage embark audit law turtle scene lift segment renew sister useful';
const nothingStored = {
  importedNsec: null,
  derivedKeys: null,
  walletPhrase: null,
  walletSeed: null,
  keptDerivedNsec: null,
};

test('shows a conflicting wallet phrase cached on the device beside the derived one', async () => {
  // Stamped as made from the current phrase, but not what it derives: the
  // wallet may have been opened under it, so a person keeping a copy needs both.
  jest.mocked(readAccountSecretsUnchanged).mockResolvedValue({
    ...nothingStored,
    walletPhrase: { value: OTHER_WALLET_PHRASE, mnemonicHash: hashMnemonic(ROOT_MNEMONIC) },
  });
  expect(await readRecoveryInformation(derivedProfile)).toEqual({
    mnemonic: ROOT_MNEMONIC,
    nsec: OTHER_NSEC,
    cashuMnemonic: DERIVED_WALLET_PHRASE,
    storedCashuMnemonic: OTHER_WALLET_PHRASE,
  });
});

test('shows nothing extra for a cache that agrees, or one left by an earlier phrase', async () => {
  for (const walletPhrase of [
    { value: DERIVED_WALLET_PHRASE, mnemonicHash: hashMnemonic(ROOT_MNEMONIC) },
    { value: OTHER_WALLET_PHRASE, mnemonicHash: 'an-earlier-phrase' },
  ]) {
    jest.mocked(readAccountSecretsUnchanged).mockResolvedValue({ ...nothingStored, walletPhrase });
    expect(await readRecoveryInformation(derivedProfile)).toEqual({
      mnemonic: ROOT_MNEMONIC,
      nsec: OTHER_NSEC,
      cashuMnemonic: DERIVED_WALLET_PHRASE,
    });
  }
});

test('shows the key kept in the cache for a profile the phrase does not derive, even from a damaged blob', async () => {
  const mismatched: ProfileEntry = { ...derivedProfile, pubkey: profile.pubkey };
  jest.mocked(readAccountSecretsUnchanged).mockResolvedValue(nothingStored);
  await expect(readRecoveryInformation(mismatched)).rejects.toThrow('does not match');

  jest
    .mocked(readAccountSecretsUnchanged)
    .mockResolvedValue({ ...nothingStored, keptDerivedNsec: IMPORTED_NSEC });
  expect(await readRecoveryInformation(mismatched)).toEqual({
    mnemonic: ROOT_MNEMONIC,
    nsec: IMPORTED_NSEC,
    cashuMnemonic: null,
  });
});
