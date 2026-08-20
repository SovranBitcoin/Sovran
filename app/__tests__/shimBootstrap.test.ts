/**
 * @jest-environment node
 */

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function setCrypto(value: object) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value });
}

describe('runtime shim bootstrap', () => {
  afterEach(() => {
    jest.resetModules();
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'crypto');
    }
  });

  it('probes the final QuickCrypto provider and requires SubtleCrypto', () => {
    const getRandomValues = jest.fn((values: Uint8Array) => values);
    const subtle = {};
    const install = jest.fn(() => setCrypto({ getRandomValues, subtle }));
    jest.doMock('react-native-quick-crypto', () => ({ install }));

    jest.isolateModules(() => jest.requireActual('../shim'));

    expect(install).toHaveBeenCalledTimes(1);
    expect(globalThis.crypto.getRandomValues).toBe(getRandomValues);
    expect(globalThis.crypto.subtle).toBe(subtle);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    expect(getRandomValues.mock.calls[0]?.[0]).toBeInstanceOf(Uint8Array);
    expect(getRandomValues.mock.calls[0]?.[0]).toHaveLength(1);
    expect(process.env).toBeDefined();
    expect(process.nextTick).toEqual(expect.any(Function));
  });

  it('stops startup when QuickCrypto does not install a CSPRNG', () => {
    setCrypto({});
    jest.doMock('react-native-quick-crypto', () => ({ install: jest.fn() }));

    expect(() => jest.isolateModules(() => jest.requireActual('../shim'))).toThrow(
      'Secure random bootstrap failed'
    );
  });

  it('stops startup when the native random provider throws', () => {
    jest.doMock('react-native-quick-crypto', () => ({
      install: () =>
        setCrypto({
          getRandomValues: () => {
            throw new Error('native module unavailable');
          },
          subtle: {},
        }),
    }));

    expect(() => jest.isolateModules(() => jest.requireActual('../shim'))).toThrow(
      'Secure random bootstrap failed'
    );
  });

  it('stops startup when QuickCrypto does not install SubtleCrypto', () => {
    jest.doMock('react-native-quick-crypto', () => ({
      install: () => setCrypto({ getRandomValues: (values: Uint8Array) => values }),
    }));

    expect(() => jest.isolateModules(() => jest.requireActual('../shim'))).toThrow(
      'Secure crypto bootstrap failed: crypto.subtle is unavailable'
    );
  });
});
