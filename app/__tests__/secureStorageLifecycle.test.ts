/**
 * @jest-environment node
 */

/* eslint-disable import/first */

const mockSecureBacking = new Map<string, string>();

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
  nostrLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

import * as SecureStore from 'expo-secure-store';
import {
  clearAllSecureData,
  ensureMnemonicExists,
  retrieveCashuSeed,
  retrieveMnemonic,
  storeCashuSeed,
  storeImportedNsec,
  storeMnemonic,
} from '@/shared/lib/nostr/secureStorage';

const VALID_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const INVALID_CHECKSUM =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

async function flushBookkeeping(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('secureStorage mnemonic and seed lifecycle', () => {
  beforeEach(async () => {
    await flushBookkeeping();
    mockSecureBacking.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
  });

  it('uses exactly 128 bits from crypto.getRandomValues for a fresh mnemonic', async () => {
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
