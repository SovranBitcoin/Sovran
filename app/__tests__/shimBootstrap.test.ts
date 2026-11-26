/**
 * @jest-environment node
 */
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { generateSecretKey } from 'nostr-tools/pure';

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalBufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
const originalNextTickDescriptor = Object.getOwnPropertyDescriptor(process, 'nextTick');

function setCrypto(value: unknown) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value });
}

function makeNonZeroFill() {
  let seed = 1;
  return jest.fn(<T extends ArrayBufferView>(values: T): T => {
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = ((seed + i * 37) % 251) + 1;
    }
    seed += 13;
    return values;
  });
}

describe('runtime shim bootstrap', () => {
  afterEach(() => {
    jest.resetModules();
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
    if (originalBufferDescriptor) {
      Object.defineProperty(globalThis, 'Buffer', originalBufferDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'Buffer');
    }
    if (originalNextTickDescriptor) {
      Object.defineProperty(process, 'nextTick', originalNextTickDescriptor);
    } else {
      Reflect.deleteProperty(process, 'nextTick');
    }
  });

  it('installs expo-crypto getRandomValues, global Buffer, and process.nextTick on Hermes-like startup', async () => {
    setCrypto(undefined);
    Reflect.deleteProperty(globalThis, 'Buffer');
    Reflect.deleteProperty(process, 'nextTick');

    const getRandomValues = makeNonZeroFill();
    jest.doMock('expo-crypto', () => ({ getRandomValues }));

    jest.isolateModules(() => jest.requireActual('../shim'));

    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    const probe = getRandomValues.mock.calls[0]?.[0];
    expect(probe).toBeInstanceOf(Uint8Array);
    expect(probe).toHaveLength(32);

    // Buffer must be installed globally so cashu-ts / coco-core do not fall back
    // to chunked btoa/atob on payloads larger than 32 KiB.
    expect(typeof globalThis.Buffer?.from).toBe('function');
    const large = new Uint8Array(40_000);
    for (let i = 0; i < large.length; i += 1) large[i] = i & 0xff;
    const encoded = globalThis.Buffer.from(large).toString('base64');
    // 40_000 % 3 === 1 → trailing `==` only; zero mid-string padding from 32 KiB chunking.
    expect(encoded.endsWith('==')).toBe(true);
    expect(encoded.indexOf('=')).toBe(encoded.length - 2);
    expect(Uint8Array.from(globalThis.Buffer.from(encoded, 'base64'))).toEqual(large);

    expect(process.env).toBeDefined();
    expect(typeof process.nextTick).toBe('function');
    const tickResult = await new Promise<string>((resolve) => {
      process.nextTick((value: string) => resolve(value), 'ok');
    });
    expect(tickResult).toBe('ok');
  });

  it('fails closed without stack overflow when web adapter recurses into missing WebCrypto', () => {
    setCrypto(undefined);
    jest.doMock('expo-crypto', () => ({
      getRandomValues: <T extends ArrayBufferView>(values: T): T =>
        globalThis.crypto.getRandomValues(values),
    }));

    expect(() => jest.isolateModules(() => jest.requireActual('../shim'))).toThrow(
      'Secure random bootstrap failed: native provider is unavailable'
    );
  });

  it('preserves an existing platform WebCrypto CSPRNG without wrapping recursively', () => {
    const existingGetRandomValues = makeNonZeroFill();
    setCrypto({ getRandomValues: existingGetRandomValues });
    const nativeGetRandomValues = jest.fn();
    jest.doMock('expo-crypto', () => ({ getRandomValues: nativeGetRandomValues }));

    jest.isolateModules(() => jest.requireActual('../shim'));

    expect(globalThis.crypto.getRandomValues).toBe(existingGetRandomValues);
    expect(existingGetRandomValues).toHaveBeenCalledTimes(1);
    expect(nativeGetRandomValues).not.toHaveBeenCalled();
  });

  it('stops startup when no CSPRNG is available', () => {
    setCrypto({});
    jest.doMock('expo-crypto', () => ({}));

    expect(() => jest.isolateModules(() => jest.requireActual('../shim'))).toThrow(
      'Secure random bootstrap failed'
    );
  });

  it('stops startup when the native random provider throws', () => {
    setCrypto(undefined);
    jest.doMock('expo-crypto', () => ({
      getRandomValues: () => {
        throw new Error('native module unavailable');
      },
    }));

    expect(() => jest.isolateModules(() => jest.requireActual('../shim'))).toThrow(
      'Secure random bootstrap failed: native provider is unavailable'
    );
  });

  it('stops startup when a broken provider silently returns all-zero bytes', () => {
    setCrypto(undefined);
    jest.doMock('expo-crypto', () => ({
      getRandomValues: <T extends ArrayBufferView>(values: T): T => values,
    }));

    expect(() => jest.isolateModules(() => jest.requireActual('../shim'))).toThrow(
      'Secure random bootstrap failed: native provider returned all-zero bytes'
    );
  });

  it('backs cold-start BIP-39 mnemonic and nostr-tools key generation after bootstrap', () => {
    setCrypto(undefined);
    const getRandomValues = makeNonZeroFill();
    jest.doMock('expo-crypto', () => ({ getRandomValues }));

    jest.isolateModules(() => jest.requireActual('../shim'));

    const mnemonic = bip39.generateMnemonic(wordlist, 128);
    expect(bip39.validateMnemonic(mnemonic, wordlist)).toBe(true);

    const secretKey = generateSecretKey();
    expect(secretKey).toBeInstanceOf(Uint8Array);
    expect(secretKey).toHaveLength(32);
    expect(secretKey.some((byte) => byte !== 0)).toBe(true);
    // 1 startup probe + 1 BIP-39 entropy read + 1 nostr-tools secret key read
    expect(getRandomValues).toHaveBeenCalledTimes(3);
  });
});
