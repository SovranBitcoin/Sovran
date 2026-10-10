/**
 * @jest-environment node
 */

/* eslint-disable import/first */

const mockSecureBacking = new Map<string, string>();
let mockProfileBlob: string | null = null;
let mockReduxRow: string | null = null;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) =>
    key === 'persist:SOVRAN' ? mockReduxRow : mockProfileBlob
  ),
  setItem: jest.fn(),
  mergeItem: jest.fn(),
  removeItem: jest.fn(),
  multiSet: jest.fn(),
  multiMerge: jest.fn(),
  multiRemove: jest.fn(),
  clear: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureBacking.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureBacking.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureBacking.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

import { useSecureStoreState } from '@/shared/stores/runtime/secureStoreState';
import { nostrLog } from '@/shared/lib/logger';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bytesToHex } from '@noble/hashes/utils.js';
import { deriveCashuMnemonic, deriveNostrKeys } from '@/shared/lib/nostr/keyDerivation';
import {
  clearAllSecureData,
  clearAccountDerivedCache,
  ensureMnemonicExists,
  hashMnemonic,
  retrieveCashuMnemonic,
  retrieveCashuSeed,
  retrieveDerivedKeys,
  retrieveMnemonic,
  storeCashuMnemonic,
  storeCashuSeed,
  storeDerivedKeys,
  storeImportedNsec,
  storeMnemonic,
} from '@/shared/lib/nostr/secureStorage';

const VALID_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const INVALID_CHECKSUM =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
const OTHER_MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

/** A profile as releases 0.0.1 to 0.0.40 saved it (onboard/new.tsx, onboard/animate.tsx). */
function reduxProfile(id: number, mnemonic: string | undefined, pubkey = `${id}`.repeat(64)) {
  return {
    id,
    name: `profile ${id}`,
    pubkey,
    npub: `npub1example${id}`,
    ...(mnemonic === undefined
      ? {}
      : {
          nsec: `nsec1example${id}`,
          mnemonic,
          root: { xpub: 'xpub-example', xpriv: 'xprv-example' },
          nut13: 'derived wallet words',
        }),
  };
}

/**
 * The redux-persist row those releases wrote: one JSON string per reducer,
 * so the phrase is encoded twice. `currentProfile` starts as `{ id: 0 }` and
 * becomes the chosen profile's fields with `id` set to its position.
 */
function reduxRow(nostr: { currentProfile?: unknown; profiles: unknown }): string {
  return JSON.stringify({
    settings: JSON.stringify({ settings: { theme: 'dark', termsAccepted: { date: 1 } } }),
    cashu: JSON.stringify({
      profiles: [
        {
          selectedMint: 'https://mint.example',
          mints: ['https://mint.example'],
          proofs: {
            'https://mint.example': [{ id: '009a1f293253e41e', amount: 8, secret: 's', C: '02ab' }],
          },
          counters: { '009a1f293253e41e': 3 },
          keysets: {},
          transactions: [],
        },
      ],
    }),
    nostr: JSON.stringify({
      search: [],
      messages: { loaded_messages: [] },
      follows: {},
      contacts: [],
      ...nostr,
    }),
    _persist: JSON.stringify({ version: 120, rehydrated: true }),
  });
}

function refuseRandomness(): jest.Mock {
  const getRandomValues = jest.fn();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
  return getRandomValues;
}

async function flushBookkeeping(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('secureStorage mnemonic and seed lifecycle', () => {
  beforeEach(async () => {
    await flushBookkeeping();
    mockSecureBacking.clear();
    mockProfileBlob = null;
    mockReduxRow = null;
    jest.clearAllMocks();
    useSecureStoreState.setState({ secureStoreState: 'available', errorName: null });
  });

  afterEach(() => {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
  });

  it.each([null, JSON.stringify({ version: 2, state: { activeAccountIndex: 0, profiles: [] } })])(
    'uses exactly 128 bits from crypto.getRandomValues for a fresh mnemonic (metadata: %s)',
    async (profileBlob) => {
      mockProfileBlob = profileBlob;
      const getRandomValues = jest.fn((entropy: Uint8Array) => {
        entropy.fill(0);
        return entropy;
      });
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { getRandomValues },
      });

      await expect(ensureMnemonicExists()).resolves.toBe(VALID_MNEMONIC);

      expect(getRandomValues).toHaveBeenCalledTimes(1);
      const [entropy] = getRandomValues.mock.calls[0];
      expect(entropy).toBeInstanceOf(Uint8Array);
      expect(entropy).toHaveLength(16);
      expect(mockSecureBacking.get('user_mnemonic')).toBe(VALID_MNEMONIC);
    }
  );

  it.each([0, 1])(
    'locks on a decrypt error at read %i without RNG, writes or deletes',
    async (successfulReads) => {
      const getRandomValues = jest.fn();
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { getRandomValues },
      });
      if (successfulReads) jest.mocked(SecureStore.getItemAsync).mockResolvedValueOnce(null);
      jest
        .mocked(SecureStore.getItemAsync)
        .mockRejectedValueOnce(new Error('private native detail'));
      await expect(ensureMnemonicExists()).resolves.toBeNull();
      // A later absent read cannot turn a session known to be locked into a fresh wallet.
      await expect(ensureMnemonicExists()).resolves.toBeNull();
      expect(useSecureStoreState.getState()).toEqual({
        secureStoreState: 'locked',
        errorName: 'Error',
      });
      expect(getRandomValues).not.toHaveBeenCalled();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      expect(nostrLog.warn).toHaveBeenCalledTimes(1);
      expect(nostrLog.warn).toHaveBeenCalledWith('secure.mnemonic.locked', {
        platform: expect.any(String),
        errorName: 'Error',
      });
    }
  );

  it('keeps an existing valid seed without RNG or writes', async () => {
    mockSecureBacking.set('user_mnemonic', VALID_MNEMONIC);
    const getRandomValues = jest.fn();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
    await expect(ensureMnemonicExists()).resolves.toBe(VALID_MNEMONIC);
    expect(getRandomValues).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(useSecureStoreState.getState().secureStoreState).toBe('available');
  });

  it.each([
    JSON.stringify({ state: { profiles: [{ accountIndex: 0, pubkey: 'a'.repeat(64) }] } }),
    '{unreadable',
    JSON.stringify({ state: { profiles: 'invalid' } }),
  ])('does not replace a missing root beneath saved or unreadable account data', async (blob) => {
    mockProfileBlob = blob;
    const getRandomValues = jest.fn((entropy: Uint8Array) => entropy.fill(0));
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });

    await expect(ensureMnemonicExists()).resolves.toBeNull();
    expect(useSecureStoreState.getState().secureStoreState).toBe('locked');
    expect(getRandomValues).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('locks if account metadata cannot be read before creating a root', async () => {
    jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('storage unavailable'));
    const getRandomValues = jest.fn();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
    await expect(ensureMnemonicExists()).resolves.toBeNull();
    expect(useSecureStoreState.getState().secureStoreState).toBe('locked');
    expect(getRandomValues).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  describe('a phone coming straight from a redux-era release', () => {
    it('takes the phrase of the profile that was open as the root, without RNG', async () => {
      const open = reduxProfile(1, OTHER_MNEMONIC);
      mockReduxRow = reduxRow({
        currentProfile: { ...open, id: 1 },
        profiles: [reduxProfile(0, VALID_MNEMONIC), open],
      });
      const row = mockReduxRow;
      const getRandomValues = refuseRandomness();

      await expect(ensureMnemonicExists()).resolves.toBe(OTHER_MNEMONIC);

      expect(mockSecureBacking.get('user_mnemonic')).toBe(OTHER_MNEMONIC);
      expect(getRandomValues).not.toHaveBeenCalled();
      expect(useSecureStoreState.getState().secureStoreState).toBe('available');
      // The row still holds the old proofs and the other phrase.
      expect(mockReduxRow).toBe(row);
      for (const write of ['setItem', 'mergeItem', 'removeItem', 'multiSet', 'multiMerge'] as const)
        expect(AsyncStorage[write]).not.toHaveBeenCalled();
      expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
      expect(AsyncStorage.clear).not.toHaveBeenCalled();
      // The next launch reads the stored root and never looks at the row again.
      jest.mocked(AsyncStorage.getItem).mockClear();
      await expect(ensureMnemonicExists()).resolves.toBe(OTHER_MNEMONIC);
      expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    });

    it.each([
      [
        'the open profile is found by key when its position is stale',
        {
          currentProfile: { ...reduxProfile(0, undefined, 'b'.repeat(64)), id: 0 },
          profiles: [
            reduxProfile(0, VALID_MNEMONIC),
            reduxProfile(1, OTHER_MNEMONIC, 'b'.repeat(64)),
          ],
        },
        OTHER_MNEMONIC,
      ],
      [
        'a fresh `{ id: 0 }` selection means the first profile',
        { currentProfile: { id: 0 }, profiles: [reduxProfile(0, VALID_MNEMONIC)] },
        VALID_MNEMONIC,
      ],
      [
        'an open profile added by public key falls back to the first phrase',
        {
          currentProfile: { ...reduxProfile(0, undefined), id: 0 },
          profiles: [reduxProfile(0, undefined), reduxProfile(1, OTHER_MNEMONIC)],
        },
        OTHER_MNEMONIC,
      ],
      [
        'an open profile with a damaged phrase falls back to the first valid one',
        {
          currentProfile: { id: 0 },
          profiles: [reduxProfile(0, INVALID_CHECKSUM), reduxProfile(1, VALID_MNEMONIC)],
        },
        VALID_MNEMONIC,
      ],
    ])('%s', async (_case, nostr, expected) => {
      mockReduxRow = reduxRow(nostr);
      const getRandomValues = refuseRandomness();

      await expect(ensureMnemonicExists()).resolves.toBe(expected);

      expect(mockSecureBacking.get('user_mnemonic')).toBe(expected);
      expect(getRandomValues).not.toHaveBeenCalled();
    });

    it.each([
      ['is not JSON', '{"nostr":"{\\"profiles'],
      ['has a nostr slice that is not JSON', JSON.stringify({ nostr: '{"profiles":[' })],
      ['has no nostr slice', JSON.stringify({ _persist: '{"version":120,"rehydrated":true}' })],
      ['has profiles that are not a list', reduxRow({ profiles: 'invalid' })],
      [
        'holds a phrase with a bad checksum',
        reduxRow({ currentProfile: { id: 0 }, profiles: [reduxProfile(0, INVALID_CHECKSUM)] }),
      ],
      [
        'holds a phrase with a word missing',
        reduxRow({
          profiles: [reduxProfile(0, VALID_MNEMONIC.split(' ').slice(1).join(' '))],
        }),
      ],
      [
        'holds a phrase that is valid only once tidied',
        reduxRow({ profiles: [reduxProfile(0, ` ${VALID_MNEMONIC}`)] }),
      ],
      [
        'holds only profiles without a phrase',
        reduxRow({ profiles: [reduxProfile(0, undefined)] }),
      ],
    ])('asks for the phrase when the row %s', async (_case, row) => {
      mockReduxRow = row;
      const getRandomValues = refuseRandomness();

      await expect(ensureMnemonicExists()).resolves.toBeNull();

      expect(useSecureStoreState.getState().secureStoreState).toBe('locked');
      expect(getRandomValues).not.toHaveBeenCalled();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
      expect(mockSecureBacking.has('user_mnemonic')).toBe(false);
      expect(mockReduxRow).toBe(row);
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
    });

    it('asks for the phrase when the row cannot be read from storage', async () => {
      jest
        .mocked(AsyncStorage.getItem)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('storage unavailable'));
      const getRandomValues = refuseRandomness();

      await expect(ensureMnemonicExists()).resolves.toBeNull();

      expect(useSecureStoreState.getState().secureStoreState).toBe('locked');
      expect(getRandomValues).not.toHaveBeenCalled();
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });

    it('creates a wallet over a row whose install never made one', async () => {
      // What the old app wrote on first launch and again after a reset.
      mockReduxRow = reduxRow({ currentProfile: { id: 0 }, profiles: [] });
      const getRandomValues = jest.fn((entropy: Uint8Array) => entropy.fill(0));
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { getRandomValues },
      });

      await expect(ensureMnemonicExists()).resolves.toBe(VALID_MNEMONIC);
      expect(getRandomValues).toHaveBeenCalledTimes(1);
    });

    it('keeps a stored root over the phrase in the row', async () => {
      mockSecureBacking.set('user_mnemonic', VALID_MNEMONIC);
      mockReduxRow = reduxRow({ profiles: [reduxProfile(0, OTHER_MNEMONIC)] });

      await expect(ensureMnemonicExists()).resolves.toBe(VALID_MNEMONIC);

      expect(mockSecureBacking.get('user_mnemonic')).toBe(VALID_MNEMONIC);
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
      expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    });

    it('does not put the phrase in the row over a stored root that is damaged', async () => {
      mockSecureBacking.set('user_mnemonic', INVALID_CHECKSUM);
      mockReduxRow = reduxRow({ profiles: [reduxProfile(0, VALID_MNEMONIC)] });

      await expect(ensureMnemonicExists()).resolves.toBeNull();

      expect(mockSecureBacking.get('user_mnemonic')).toBe(INVALID_CHECKSUM);
      expect(useSecureStoreState.getState().secureStoreState).toBe('locked');
    });

    it('does not use the row beneath saved accounts whose root is missing', async () => {
      mockProfileBlob = JSON.stringify({
        state: { profiles: [{ accountIndex: 0, pubkey: 'a'.repeat(64) }] },
      });
      mockReduxRow = reduxRow({ profiles: [reduxProfile(0, VALID_MNEMONIC)] });

      await expect(ensureMnemonicExists()).resolves.toBeNull();

      expect(useSecureStoreState.getState().secureStoreState).toBe('locked');
      expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    });
  });

  describe('a cache that matches the phrase but has the wrong shape', () => {
    const hash = hashMnemonic(VALID_MNEMONIC);
    const derived = deriveNostrKeys(VALID_MNEMONIC, 0);
    const good = {
      npub: derived.npub,
      nsec: derived.nsec,
      pubkey: derived.pubkey,
      privateKeyHex: bytesToHex(derived.privateKey),
      mnemonicHash: hash,
    };

    it('reads back the caches this release writes', async () => {
      const cashu = deriveCashuMnemonic(VALID_MNEMONIC, 0);
      await storeDerivedKeys(0, good);
      await storeCashuMnemonic(0, cashu, hash);

      await expect(retrieveDerivedKeys(0)).resolves.toEqual(good);
      await expect(retrieveCashuMnemonic(0)).resolves.toEqual({ value: cashu, mnemonicHash: hash });
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    });

    it.each([
      ['no private key', { ...good, privateKeyHex: undefined }],
      ['a private key that is not hex', { ...good, privateKeyHex: 'z'.repeat(64) }],
      ['a private key of the wrong length', { ...good, privateKeyHex: 'ab' }],
      ['no npub', { ...good, npub: undefined }],
      ['no nsec', { ...good, nsec: undefined }],
      ['no public key', { ...good, pubkey: undefined }],
      ['no hash', { ...good, mnemonicHash: undefined }],
      ['a list', [good]],
      ['null', null],
    ])('treats derived keys with %s as absent and deletes them', async (_case, blob) => {
      mockSecureBacking.set('derived_keys_0', JSON.stringify(blob));

      await expect(retrieveDerivedKeys(0)).resolves.toBeNull();

      expect(mockSecureBacking.has('derived_keys_0')).toBe(false);
    });

    it.each([
      ['no phrase', { mnemonicHash: hash }],
      ['a phrase that is not a string', { value: 7, mnemonicHash: hash }],
      ['a phrase with a bad checksum', { value: INVALID_CHECKSUM, mnemonicHash: hash }],
      ['no hash', { value: VALID_MNEMONIC }],
      ['a bare string', VALID_MNEMONIC],
    ])('treats a wallet phrase cache with %s as absent and deletes it', async (_case, blob) => {
      mockSecureBacking.set('cashu_mnemonic_0', JSON.stringify(blob));

      await expect(retrieveCashuMnemonic(0)).resolves.toBeNull();

      expect(mockSecureBacking.has('cashu_mnemonic_0')).toBe(false);
    });

    it('keeps the secret fields of a rejected cache out of the log', async () => {
      mockSecureBacking.set('derived_keys_0', JSON.stringify({ ...good, pubkey: 'short' }));

      await retrieveDerivedKeys(0);

      const [[, params]] = jest.mocked(nostrLog.error).mock.calls;
      const logged = JSON.stringify(params) + String(Object.values(params ?? {})[0]);
      expect(logged).toContain('wrong shape');
      expect(logged).not.toContain(good.nsec);
      expect(logged).not.toContain(good.privateKeyHex);
    });
  });

  it('fails closed when crypto.getRandomValues is unavailable', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {},
    });

    await expect(ensureMnemonicExists()).resolves.toBeNull();

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockSecureBacking.has('user_mnemonic')).toBe(false);
  });

  it('persists no mnemonic when the native CSPRNG throws', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: () => {
          throw new Error('native rng unavailable');
        },
      },
    });

    await expect(ensureMnemonicExists()).resolves.toBeNull();

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(mockSecureBacking.has('user_mnemonic')).toBe(false);
  });

  it.each([
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon',
    INVALID_CHECKSUM,
  ])('rejects invalid mnemonic %s without writing SecureStore', async (mnemonic) => {
    await expect(storeMnemonic(mnemonic)).resolves.toBe(false);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('stores a checksum-valid mnemonic and remembers its key', async () => {
    await expect(storeMnemonic(VALID_MNEMONIC)).resolves.toBe(true);
    await flushBookkeeping();

    expect(mockSecureBacking.get('user_mnemonic')).toBe(VALID_MNEMONIC);
    expect(JSON.parse(mockSecureBacking.get('secure_key_index') ?? '[]')).toContain(
      'user_mnemonic'
    );
  });

  it('surfaces a corrupt stored mnemonic without deleting it', async () => {
    mockSecureBacking.set('user_mnemonic', INVALID_CHECKSUM);

    await expect(retrieveMnemonic()).resolves.toBeNull();

    expect(mockSecureBacking.get('user_mnemonic')).toBe(INVALID_CHECKSUM);
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('coalesces concurrent mnemonic reads into one SecureStore access', async () => {
    let release!: (value: string | null) => void;
    const pending = new Promise<string | null>((resolve) => {
      release = resolve;
    });
    (SecureStore.getItemAsync as jest.Mock).mockImplementationOnce(() => pending);

    const first = retrieveMnemonic();
    const second = retrieveMnemonic();
    expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(1);

    release(VALID_MNEMONIC);
    await expect(Promise.all([first, second])).resolves.toEqual([VALID_MNEMONIC, VALID_MNEMONIC]);
  });

  it('deletes a cached Cashu seed whose decoded length is not 64 bytes', async () => {
    mockSecureBacking.set('cashu_seed_0', JSON.stringify({ hex: '00', mnemonicHash: 'hash' }));

    await expect(retrieveCashuSeed(0)).resolves.toBeNull();

    expect(mockSecureBacking.has('cashu_seed_0')).toBe(false);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('cashu_seed_0', expect.anything());
  });

  it('rejects malformed account and pubkey keys before writing', () => {
    expect(() => storeCashuSeed(-1, new Uint8Array(64), 'hash')).toThrow('Invalid accountIndex');
    expect(() => storeCashuSeed(1.5, new Uint8Array(64), 'hash')).toThrow('Invalid accountIndex');
    expect(() => storeImportedNsec('not-a-pubkey', 'nsec1example')).toThrow('Invalid pubkeyHex');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('clears caller and indexed orphan keys, deleting the index last', async () => {
    const orphan = `imported_nsec_${'a'.repeat(64)}`;
    mockSecureBacking.set('user_mnemonic', VALID_MNEMONIC);
    mockSecureBacking.set(orphan, 'nsec1secret');
    mockSecureBacking.set('secure_key_index', JSON.stringify([orphan]));

    await expect(clearAllSecureData([0])).resolves.toBe(true);

    const deleted = (SecureStore.deleteItemAsync as jest.Mock).mock.calls.map(
      ([key]) => key as string
    );
    expect(deleted).toContain(orphan);
    expect(deleted).toContain('user_mnemonic');
    expect(deleted.at(-1)).toBe('secure_key_index');
    expect(mockSecureBacking.size).toBe(0);
  });
});

it('clears every derived cache before source repair, including the PBKDF2 seed', async () => {
  jest.clearAllMocks();
  await expect(clearAccountDerivedCache(7)).resolves.toBe(true);
  expect(jest.mocked(SecureStore.deleteItemAsync).mock.calls.map(([key]) => key)).toEqual([
    'derived_keys_7',
    'cashu_mnemonic_7',
    'cashu_seed_7',
  ]);
});

it('retains the key index when any secure deletion fails so retry can enumerate leftovers', async () => {
  jest.clearAllMocks();
  mockSecureBacking.set('secure_key_index', JSON.stringify(['cashu_seed_7']));
  jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('delete failed'));
  await expect(clearAllSecureData([0])).resolves.toBe(false);
  expect(mockSecureBacking.has('secure_key_index')).toBe(true);
});
