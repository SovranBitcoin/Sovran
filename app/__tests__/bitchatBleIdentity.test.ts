import { deriveBitchatBLEIdentityMaterial } from '@/features/bitchat/lib/bleIdentity';

const PRIVATE_KEY_A = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1));
const PRIVATE_KEY_B = new Uint8Array(Array.from({ length: 32 }, (_, index) => 32 - index));
const PUBKEY_A = 'aa'.repeat(32);
const PUBKEY_B = 'bb'.repeat(32);

describe('BitChat BLE identity derivation', () => {
  it('derives stable BitChat child keys from the same Nostr identity', () => {
    const first = deriveBitchatBLEIdentityMaterial({
      privateKey: PRIVATE_KEY_A,
      pubkey: PUBKEY_A,
    });
    const second = deriveBitchatBLEIdentityMaterial({
      privateKey: new Uint8Array(PRIVATE_KEY_A),
      pubkey: PUBKEY_A.toUpperCase(),
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: 'sovran-bitchat-ble-v1',
      nostrPubkey: PUBKEY_A,
    });
    expect(first.noisePrivateKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(first.signingPrivateKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(first.noisePrivateKeyHex).not.toBe(first.signingPrivateKeyHex);
  });

  it('changes derived BitChat keys when the Nostr identity changes', () => {
    const first = deriveBitchatBLEIdentityMaterial({
      privateKey: PRIVATE_KEY_A,
      pubkey: PUBKEY_A,
    });
    const differentPrivateKey = deriveBitchatBLEIdentityMaterial({
      privateKey: PRIVATE_KEY_B,
      pubkey: PUBKEY_A,
    });
    const differentPubkey = deriveBitchatBLEIdentityMaterial({
      privateKey: PRIVATE_KEY_A,
      pubkey: PUBKEY_B,
    });

    expect(differentPrivateKey.noisePrivateKeyHex).not.toBe(first.noisePrivateKeyHex);
    expect(differentPrivateKey.signingPrivateKeyHex).not.toBe(first.signingPrivateKeyHex);
    expect(differentPubkey.noisePrivateKeyHex).not.toBe(first.noisePrivateKeyHex);
    expect(differentPubkey.signingPrivateKeyHex).not.toBe(first.signingPrivateKeyHex);
  });

  it('does not mutate the caller private key bytes', () => {
    const privateKey = new Uint8Array(PRIVATE_KEY_A);

    deriveBitchatBLEIdentityMaterial({
      privateKey,
      pubkey: PUBKEY_A,
    });

    expect(privateKey).toEqual(PRIVATE_KEY_A);
  });

  it('does not log derived private material', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      deriveBitchatBLEIdentityMaterial({
        privateKey: PRIVATE_KEY_A,
        pubkey: PUBKEY_A,
      });
      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('rejects malformed Nostr keys', () => {
    expect(() =>
      deriveBitchatBLEIdentityMaterial({
        privateKey: new Uint8Array(31),
        pubkey: PUBKEY_A,
      })
    ).toThrow('Nostr private key must be 32 bytes');

    expect(() =>
      deriveBitchatBLEIdentityMaterial({
        privateKey: PRIVATE_KEY_A,
        pubkey: 'not-hex',
      })
    ).toThrow('Nostr pubkey must be 32-byte hex');
  });
});
