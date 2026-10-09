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
jest.mock('@/shared/lib/nostr/secureStorage', () => ({
  hashMnemonic: (mnemonic: string) => `hash:${mnemonic.length}:${mnemonic.slice(0, 7)}`,
  retrieveImportedNsec: jest.fn(),
  retrieveDerivedKeys: jest.fn(),
  retrieveCashuMnemonic: jest.fn(),
  storeDerivedKeys: jest.fn(),
  storeCashuMnemonic: jest.fn(),
  clearAccountDerivedCache: jest.fn(),
}));

/**
 * The three ways an account's keys are found at startup, and the one repair.
 * Real derivation throughout: what matters is which key and which wallet
 * phrase an account ends up with, since the wallet's funds sit behind them.
 */
const ROOT =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OTHER_ROOT = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const HASH = secure.hashMnemonic(ROOT);
const mocked = jest.mocked(secure);

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
  mocked.clearAccountDerivedCache.mockResolvedValue(true);
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
    mocked.retrieveCashuMnemonic.mockResolvedValue({ value: 'cached phrase', mnemonicHash: HASH });

    jest.mocked(deriveNostrKeys).mockClear();
    jest.mocked(deriveCashuMnemonic).mockClear();

    const loaded = await load(0);

    expect(loaded?.keys?.pubkey).toBe(derived.pubkey);
    expect(loaded?.keys?.privateKey).toEqual(derived.privateKey);
    expect(loaded?.cashuMnemonic).toBe('cached phrase');
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

  it('keeps going when the saved row names another key', async () => {
    // A state 0.1.3 produced and ran in: a restored backup without the
    // keychain. Refusing would strand that user's funds behind a re-import
    // form for a key they never held.
    activeProfile({ accountIndex: 0, pubkey: 'f'.repeat(64) });

    const loaded = await load(0);

    expect(loaded?.keys?.pubkey).toBe(deriveNostrKeys(ROOT, 0).pubkey);
    expect(useProfileStore.getState().profiles[0].pubkey).toBe('f'.repeat(64));
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
    mocked.retrieveCashuMnemonic.mockResolvedValue({ value: 'cached phrase', mnemonicHash: HASH });

    expect((await load(index))?.cashuMnemonic).toBe('cached phrase');
    expect(mocked.storeCashuMnemonic).not.toHaveBeenCalled();

    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: 'stale phrase',
      mnemonicHash: secure.hashMnemonic(OTHER_ROOT),
    });

    expect((await load(index))?.cashuMnemonic).toBe(deriveCashuMnemonicForImported(ROOT, index));
  });

  it('refuses a stored value that is not an nsec', async () => {
    activeProfile({ accountIndex: index, pubkey, source: 'imported' });
    mocked.retrieveImportedNsec.mockResolvedValue(nip19.npubEncode(pubkey));

    await expect(load(index)).rejects.toThrow('Stored imported key is not a valid nsec');
  });

  it('refuses a stored key that belongs to another identity', async () => {
    activeProfile({ accountIndex: index, pubkey: 'e'.repeat(64), source: 'imported' });
    mocked.retrieveImportedNsec.mockResolvedValue(nsec);

    await expect(load(index)).rejects.toThrow('Saved account requires re-import');
  });

  it('asks for a re-import when its key is gone and the root does not derive it', async () => {
    activeProfile({ accountIndex: index, pubkey, source: 'imported' });

    await expect(load(index)).rejects.toThrow('Saved account requires re-import');
    expect(useProfileStore.getState().profiles[0].source).toBe('imported');
  });

  it('repairs a row marked imported that the root phrase derives after all', async () => {
    const derived = deriveNostrKeys(ROOT, 1);
    activeProfile({ accountIndex: 1, pubkey: derived.pubkey, source: 'imported' });

    const loaded = await load(1);

    expect(loaded?.isImported).toBe(false);
    expect(loaded?.keys?.pubkey).toBe(derived.pubkey);
    expect(loaded?.cashuMnemonic).toBe(deriveCashuMnemonic(ROOT, 1));
    expect(mocked.clearAccountDerivedCache).toHaveBeenCalledWith(1);
    expect(useProfileStore.getState().profiles[0].source).toBe('derived');
  });

  it('asks for a re-import when the stale cache cannot be cleared for the repair', async () => {
    const derived = deriveNostrKeys(ROOT, 1);
    activeProfile({ accountIndex: 1, pubkey: derived.pubkey, source: 'imported' });
    mocked.clearAccountDerivedCache.mockResolvedValue(false);

    await expect(load(1)).rejects.toThrow('Saved account requires re-import');
    expect(useProfileStore.getState().profiles[0].source).toBe('imported');
  });

  it('does not trust a cache when it has just repaired the row', async () => {
    const derived = deriveNostrKeys(ROOT, 1);
    activeProfile({ accountIndex: 1, pubkey: derived.pubkey, source: 'imported' });
    mocked.retrieveCashuMnemonic.mockResolvedValue({
      value: 'imported phrase',
      mnemonicHash: HASH,
    });
    mocked.retrieveDerivedKeys.mockResolvedValue({
      npub: derived.npub,
      nsec: derived.nsec,
      pubkey: derived.pubkey,
      privateKeyHex: bytesToHex(derived.privateKey),
      mnemonicHash: HASH,
    });

    // The cached phrase was the imported account's; the derived one differs.
    expect((await load(1))?.cashuMnemonic).toBe(deriveCashuMnemonic(ROOT, 1));
  });

  it('does not repair anything once the caller has gone away', async () => {
    const derived = deriveNostrKeys(ROOT, 1);
    activeProfile({ accountIndex: 1, pubkey: derived.pubkey, source: 'imported' });

    await expect(load(1, () => false)).resolves.toBeNull();

    expect(mocked.clearAccountDerivedCache).not.toHaveBeenCalled();
    expect(useProfileStore.getState().profiles[0].source).toBe('imported');
  });
});
