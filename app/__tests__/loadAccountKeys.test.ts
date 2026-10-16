/** @jest-environment node */
import { bytesToHex } from '@noble/hashes/utils.js';
import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

import {
  deriveCashuMnemonic,
  deriveCashuMnemonicForImported,
  deriveNostrKeys,
  pubkeyToAccountNumber,
} from '@/shared/lib/nostr/keyDerivation';
import { AccountIntegrityError } from '@/shared/lib/nostr/derivationIntegrity';
import { loadAccountKeys } from '@/shared/lib/nostr/loadAccountKeys';
import * as secure from '@/shared/lib/nostr/secureStorage';
import { useProfileStore } from '@/shared/stores/global/profileStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));
jest.mock('@/shared/lib/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  storeLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  initLog: jest.fn(),
  initPhase: (_name: string, run: () => unknown) => run(),
  redactError: (error: unknown) => error,
}));
jest.mock('@/shared/lib/nostr/keyDerivation', () => {
  const actual = jest.requireActual('@/shared/lib/nostr/keyDerivation');
  return {
    ...actual,
    deriveNostrKeys: jest.fn(actual.deriveNostrKeys),
    deriveCashuMnemonic: jest.fn(actual.deriveCashuMnemonic),
    deriveCashuMnemonicForImported: jest.fn(actual.deriveCashuMnemonicForImported),
  };
});
jest.mock('@/shared/lib/nostr/secureStorage', () => {
  // One stub per stored value, so a test sets only what its account holds.
  const retrieveImportedNsec = jest.fn();
  const retrieveDerivedKeys = jest.fn();
  const retrieveCashuMnemonic = jest.fn();
  return {
    hashMnemonic: (mnemonic: string) => `hash:${mnemonic.length}:${mnemonic.slice(0, 7)}`,
    retrieveImportedNsec,
    retrieveDerivedKeys,
    retrieveCashuMnemonic,
    // The loader's one read: everything stored for the account, unchanged.
    readAccountSecretsUnchanged: jest.fn(
      async (accountIndex: number, importedPubkey: string | null) => ({
        importedNsec: importedPubkey ? await retrieveImportedNsec(importedPubkey) : null,
        derivedKeys: await retrieveDerivedKeys(accountIndex),
        walletPhrase: await retrieveCashuMnemonic(accountIndex),
        walletSeed: null,
        keptDerivedNsec: null,
      })
    ),
    storeDerivedKeys: jest.fn(),
    storeCashuMnemonic: jest.fn(),
  };
});
// The integrity check stretches the phrase for itself. Node's own PBKDF2 keeps
// that quick and the same on every run.
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

/**
 * The three ways an account's keys are found at startup, and the one repair.
 * Real derivation throughout: what matters is which key and which wallet
 * phrase an account ends up with, since the wallet's funds sit behind them.
 */
const ROOT =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_ROOT = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const HASH = secure.hashMnemonic(ROOT);
// The two cache stubs exist only in this file's double of the module.
const mocked = jest.mocked(secure) as jest.MockedObjectDeep<typeof secure> & {
  retrieveDerivedKeys: jest.Mock;
  retrieveCashuMnemonic: jest.Mock;
};

const load = (accountIndex: number, shouldContinue = () => true) =>
  loadAccountKeys({ mnemonic: ROOT, accountIndex, onProgress: () => {}, shouldContinue });

function activeProfile(profile: {
  accountIndex: number;
  pubkey: string;
  source?: 'derived' | 'imported';
}) {
  useProfileStore.setState({
    activeAccountIndex: profile.accountIndex,
    profiles: [{ ...profile, addedAt: 1 }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  useProfileStore.setState({ activeAccountIndex: 0, profiles: [] });
  mocked.retrieveImportedNsec.mockResolvedValue(null);
  mocked.retrieveDerivedKeys.mockResolvedValue(null);
  mocked.retrieveCashuMnemonic.mockResolvedValue(null);
  mocked.storeDerivedKeys.mockResolvedValue(true);
  mocked.storeCashuMnemonic.mockResolvedValue(true);
});

describe('a derived profile', () => {
  it('derives its keys and wallet phrase from the root phrase and caches them', async () => {
    const expected = deriveNostrKeys(ROOT, 2);
    activeProfile({ accountIndex: 2, pubkey: expected.pubkey });

    const loaded = await load(2);

    expect(loaded?.keys?.pubkey).toBe(expected.pubkey);
    expect(loaded?.keys?.nsec).toBe(expected.nsec);
    expect(loaded?.cashuMnemonic).toBe(deriveCashuMnemonic(ROOT, 2));
    expect(loaded?.isImported).toBe(false);
    expect(mocked.storeDerivedKeys).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ pubkey: expected.pubkey, mnemonicHash: HASH })
    );
    expect(mocked.storeCashuMnemonic).toHaveBeenCalledWith(2, deriveCashuMnemonic(ROOT, 2), HASH);
  });

  it('uses cached keys made from this root phrase without deriving again', async () => {
    const derived = deriveNostrKeys(ROOT, 0);
    activeProfile({ accountIndex: 0, pubkey: derived.pubkey });
    mocked.retrieveDerivedKeys.mockResolvedValue({
      npub: derived.npub,
      nsec: derived.nsec,
      pubkey: derived.pubkey,
      privateKeyHex: bytesToHex(derived.privateKey),
      mnemonicHash: HASH,
    });
    const walletPhrase = deriveCashuMnemonic(ROOT, 0);
    mocked.retrieveCashuMnemonic.mockResolvedValue({ value: walletPhrase, mnemonicHash: HASH });

    jest.mocked(deriveNostrKeys).mockClear();
    jest.mocked(deriveCashuMnemonic).mockClear();

    const loaded = await load(0);

    expect(loaded?.keys?.pubkey).toBe(derived.pubkey);
    expect(loaded?.keys?.privateKey).toEqual(derived.privateKey);
    expect(loaded?.cashuMnemonic).toBe(walletPhrase);
    expect(deriveNostrKeys).not.toHaveBeenCalled();
    expect(deriveCashuMnemonic).not.toHaveBeenCalled();
    expect(mocked.storeDerivedKeys).not.toHaveBeenCalled();
  });

  it('ignores a cache made from another root phrase', async () => {
    const stale = deriveNostrKeys(OTHER_ROOT, 0);
    const expected = deriveNostrKeys(ROOT, 0);
    activeProfile({ accountIndex: 0, pubkey: expected.pubkey });
    mocked.retrieveDerivedKeys.mockResolvedValue({
      npub: stale.npub,
      nsec: stale.nsec,
      pubkey: stale.pubkey,
      privateKeyHex: bytesToHex(stale.privateKey),
      mnemonicHash: secure.hashMnemonic(OTHER_ROOT),
    });
    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: 'stale phrase',
      mnemonicHash: secure.hashMnemonic(OTHER_ROOT),
    });

    const loaded = await load(0);

    expect(loaded?.keys?.pubkey).toBe(expected.pubkey);
    expect(loaded?.cashuMnemonic).toBe(deriveCashuMnemonic(ROOT, 0));
  });

  it('derives both again when only one of the two caches matches', async () => {
    const derived = deriveNostrKeys(ROOT, 0);
    activeProfile({ accountIndex: 0, pubkey: derived.pubkey });
    mocked.retrieveDerivedKeys.mockResolvedValue({
      npub: derived.npub,
      nsec: derived.nsec,
      pubkey: derived.pubkey,
      privateKeyHex: bytesToHex(derived.privateKey),
      mnemonicHash: HASH,
    });
    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: 'stale phrase',
      mnemonicHash: secure.hashMnemonic(OTHER_ROOT),
    });

    const loaded = await load(0);

    // A wallet phrase from another root would open someone else's wallet.
    expect(loaded?.cashuMnemonic).toBe(deriveCashuMnemonic(ROOT, 0));
    expect(mocked.storeCashuMnemonic).toHaveBeenCalledWith(0, deriveCashuMnemonic(ROOT, 0), HASH);
  });

  it('stops, and writes nothing, when the saved row names another key', async () => {
    // A state 0.1.3 produced and ran in: a restored backup without the
    // keychain. The phrase cannot make that account's key again, so the app
    // stops on the critical screen instead of opening its wallet.
    activeProfile({ accountIndex: 0, pubkey: 'f'.repeat(64) });

    const error = await load(0).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AccountIntegrityError);
    expect((error as AccountIntegrityError).result.mismatches.map((m) => m.invariant)).toContain(
      'row.derived-pubkey'
    );
    expect(useProfileStore.getState().profiles[0].pubkey).toBe('f'.repeat(64));
    expect(mocked.storeDerivedKeys).not.toHaveBeenCalled();
    expect(mocked.storeCashuMnemonic).not.toHaveBeenCalled();
  });

  it("stops when a cache from this phrase holds a key that is not the row's", async () => {
    // The fast start derives nothing, so this is the check that has to catch it.
    const other = deriveNostrKeys(ROOT, 5);
    activeProfile({ accountIndex: 0, pubkey: deriveNostrKeys(OTHER_ROOT, 0).pubkey });
    mocked.retrieveDerivedKeys.mockResolvedValue({
      npub: other.npub,
      nsec: other.nsec,
      pubkey: other.pubkey,
      privateKeyHex: bytesToHex(other.privateKey),
      mnemonicHash: HASH,
    });
    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: deriveCashuMnemonic(ROOT, 0),
      mnemonicHash: HASH,
    });

    await expect(load(0)).rejects.toBeInstanceOf(AccountIntegrityError);
    expect(mocked.storeDerivedKeys).not.toHaveBeenCalled();
  });

  it('derives afresh, ignoring a cache, before the first profile row is made', async () => {
    const stray = deriveNostrKeys(ROOT, 5);
    mocked.retrieveDerivedKeys.mockResolvedValue({
      npub: stray.npub,
      nsec: stray.nsec,
      pubkey: stray.pubkey,
      privateKeyHex: bytesToHex(stray.privateKey),
      mnemonicHash: HASH,
    });
    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: deriveCashuMnemonic(ROOT, 5),
      mnemonicHash: HASH,
    });

    // The row is about to be created from this key, so it must be the phrase's.
    await expect(load(0)).rejects.toBeInstanceOf(AccountIntegrityError);
  });

  it('stops before the wallet can open when only the cached wallet phrase is wrong', async () => {
    // The key, the row and the key cache all agree. Without a derivation of
    // its own the check could not tell, and the wallet would open under a
    // seed that is not this account's.
    const derived = deriveNostrKeys(ROOT, 0);
    activeProfile({ accountIndex: 0, pubkey: derived.pubkey });
    mocked.retrieveDerivedKeys.mockResolvedValue({
      npub: derived.npub,
      nsec: derived.nsec,
      pubkey: derived.pubkey,
      privateKeyHex: bytesToHex(derived.privateKey),
      mnemonicHash: HASH,
    });
    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: deriveCashuMnemonic(ROOT, 1),
      mnemonicHash: HASH,
    });

    const error = await load(0).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AccountIntegrityError);
    expect((error as AccountIntegrityError).result.mismatches.map((m) => m.invariant)).toEqual([
      'cache.wallet-phrase',
      'session.wallet-phrase',
    ]);
  });

  it('stops on a row that shares only the first characters of the right key', async () => {
    const right = deriveNostrKeys(ROOT, 0).pubkey;
    activeProfile({ accountIndex: 0, pubkey: right.slice(0, 8) + '0'.repeat(56) });

    await expect(load(0)).rejects.toBeInstanceOf(AccountIntegrityError);
  });

  it('works before any profile row exists', async () => {
    const loaded = await load(0);

    expect(loaded?.keys?.pubkey).toBe(deriveNostrKeys(ROOT, 0).pubkey);
    expect(loaded?.isImported).toBe(false);
  });
});

describe('an imported profile', () => {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const nsec = nip19.nsecEncode(secretKey);
  const index = pubkeyToAccountNumber(pubkey);

  it('takes its identity from the stored key and its wallet phrase from the root', async () => {
    activeProfile({ accountIndex: index, pubkey, source: 'imported' });
    mocked.retrieveImportedNsec.mockResolvedValue(nsec);

    const loaded = await load(index);

    expect(loaded?.keys?.pubkey).toBe(pubkey);
    expect(loaded?.keys?.nsec).toBe(nsec);
    expect(loaded?.isImported).toBe(true);
    expect(loaded?.cashuMnemonic).toBe(deriveCashuMnemonicForImported(ROOT, index));
    expect(mocked.retrieveImportedNsec).toHaveBeenCalledWith(pubkey);
  });

  it('uses a cached wallet phrase made from this root, and ignores one that was not', async () => {
    activeProfile({ accountIndex: index, pubkey, source: 'imported' });
    mocked.retrieveImportedNsec.mockResolvedValue(nsec);
    const walletPhrase = deriveCashuMnemonicForImported(ROOT, index);
    mocked.retrieveCashuMnemonic.mockResolvedValue({ value: walletPhrase, mnemonicHash: HASH });
    jest.mocked(deriveCashuMnemonicForImported).mockClear();

    expect((await load(index))?.cashuMnemonic).toBe(walletPhrase);
    expect(deriveCashuMnemonicForImported).not.toHaveBeenCalled();
    expect(mocked.storeCashuMnemonic).not.toHaveBeenCalled();

    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: 'stale phrase',
      mnemonicHash: secure.hashMnemonic(OTHER_ROOT),
    });

    expect((await load(index))?.cashuMnemonic).toBe(deriveCashuMnemonicForImported(ROOT, index));
  });

  it('stops on a stored value that is not an nsec', async () => {
    activeProfile({ accountIndex: index, pubkey, source: 'imported' });
    mocked.retrieveImportedNsec.mockResolvedValue(nip19.npubEncode(pubkey));

    await expect(load(index)).rejects.toBeInstanceOf(AccountIntegrityError);
  });

  it('stops on a stored nsec that decodes to bytes no key can be made from', async () => {
    // A valid encoding of zero: deriving its public key throws.
    activeProfile({ accountIndex: index, pubkey, source: 'imported' });
    mocked.retrieveImportedNsec.mockResolvedValue(nip19.nsecEncode(new Uint8Array(32)));

    const error = await load(index).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AccountIntegrityError);
    expect((error as AccountIntegrityError).result.mismatches.map((m) => m.invariant)).toContain(
      'row.imported-key'
    );
  });

  it('stops on a stored key that belongs to another identity, and writes nothing', async () => {
    activeProfile({ accountIndex: index, pubkey: 'e'.repeat(64), source: 'imported' });
    mocked.retrieveImportedNsec.mockResolvedValue(nsec);

    const error = await load(index).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AccountIntegrityError);
    expect((error as AccountIntegrityError).result.mismatches.map((m) => m.invariant)).toContain(
      'row.imported-key'
    );
    expect(mocked.storeCashuMnemonic).not.toHaveBeenCalled();
  });

  it('asks for a re-import when its key is gone and the root does not derive it', async () => {
    activeProfile({ accountIndex: index, pubkey, source: 'imported' });

    await expect(load(index)).rejects.toThrow('Saved account requires re-import');
    expect(useProfileStore.getState().profiles[0].source).toBe('imported');
  });

  it('corrects the label of a row marked imported that the root phrase derives after all', async () => {
    const derived = deriveNostrKeys(ROOT, 1);
    activeProfile({ accountIndex: 1, pubkey: derived.pubkey, source: 'imported' });

    const loaded = await load(1);

    expect(loaded?.isImported).toBe(false);
    expect(loaded?.keys?.pubkey).toBe(derived.pubkey);
    expect(loaded?.cashuMnemonic).toBe(deriveCashuMnemonic(ROOT, 1));
    expect(useProfileStore.getState().profiles[0].source).toBe('derived');
  });

  it("keeps and uses that row's own caches: only the label was wrong", async () => {
    const derived = deriveNostrKeys(ROOT, 1);
    activeProfile({ accountIndex: 1, pubkey: derived.pubkey, source: 'imported' });
    mocked.retrieveDerivedKeys.mockResolvedValue({
      npub: derived.npub,
      nsec: derived.nsec,
      pubkey: derived.pubkey,
      privateKeyHex: bytesToHex(derived.privateKey),
      mnemonicHash: HASH,
    });
    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: deriveCashuMnemonic(ROOT, 1),
      mnemonicHash: HASH,
    });

    expect((await load(1))?.cashuMnemonic).toBe(deriveCashuMnemonic(ROOT, 1));
    expect(useProfileStore.getState().profiles[0].source).toBe('derived');
    expect(mocked.storeDerivedKeys).not.toHaveBeenCalled();
  });

  it('never corrects the label when the caches disagree: that is a mismatch', async () => {
    const derived = deriveNostrKeys(ROOT, 1);
    activeProfile({ accountIndex: 1, pubkey: derived.pubkey, source: 'imported' });
    // A wallet phrase from the imported chain, stamped as current. The wallet
    // may have been opened under it, so nothing here is safe to rewrite.
    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: deriveCashuMnemonicForImported(ROOT, 1),
      mnemonicHash: HASH,
    });

    const error = await load(1).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AccountIntegrityError);
    expect((error as AccountIntegrityError).result.mismatches.map((m) => m.invariant)).toEqual([
      'cache.wallet-phrase',
    ]);
    expect(useProfileStore.getState().profiles[0].source).toBe('imported');
    expect(mocked.storeDerivedKeys).not.toHaveBeenCalled();
    expect(mocked.storeCashuMnemonic).not.toHaveBeenCalled();
  });

  it('does not repair anything once the caller has gone away', async () => {
    const derived = deriveNostrKeys(ROOT, 1);
    activeProfile({ accountIndex: 1, pubkey: derived.pubkey, source: 'imported' });

    await expect(load(1, () => false)).resolves.toBeNull();

    expect(useProfileStore.getState().profiles[0].source).toBe('imported');
  });
});
