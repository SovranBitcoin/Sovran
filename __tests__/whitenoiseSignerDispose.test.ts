import { createWhitenoiseSigner } from '@/features/whitenoise/client/signer';

describe('whitenoise signer disposal (audit 33.json F-004)', () => {
  function makeKey(): Uint8Array {
    const key = new Uint8Array(32);
    for (let i = 0; i < 32; i++) key[i] = (i * 17 + 3) & 0xff;
    return key;
  }

  it('exposes a dispose() method on the signer', () => {
    const signer = createWhitenoiseSigner(makeKey());
    expect(typeof signer.dispose).toBe('function');
  });

  it('does not mutate the caller-owned key buffer (defensive copy)', () => {
    const key = makeKey();
    const before = Array.from(key);
    const signer = createWhitenoiseSigner(key);
    signer.dispose();
    expect(Array.from(key)).toEqual(before);
  });

  it('disposed signers refuse to sign or run nip44 ops', () => {
    const signer = createWhitenoiseSigner(makeKey());
    signer.dispose();
    expect(() => signer.signEvent({ kind: 1, content: 'x', tags: [], created_at: 0 })).toThrow(
      /disposed/
    );
    expect(() => signer.nip44.encrypt('aa'.repeat(32), 'plaintext')).toThrow(/disposed/);
    expect(() => signer.nip44.decrypt('aa'.repeat(32), 'ciphertext')).toThrow(/disposed/);
  });

  it('dispose is idempotent — calling twice does not throw', () => {
    const signer = createWhitenoiseSigner(makeKey());
    signer.dispose();
    expect(() => signer.dispose()).not.toThrow();
  });

  it('getPublicKey continues to work after dispose (cached, no key access)', () => {
    const signer = createWhitenoiseSigner(makeKey());
    const pubkey = signer.getPublicKey();
    signer.dispose();
    expect(signer.getPublicKey()).toBe(pubkey);
  });
});
