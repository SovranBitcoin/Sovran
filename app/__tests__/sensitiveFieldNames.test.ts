/**
 * The logger and the Settings → "Share Full Dump" exporter must agree on which
 * field names hold secrets. They used to keep private copies of the list and
 * the copies drifted: the dump path never learned about `token`/`authorization`
 * and the two disagreed on `xpriv`. A field one path redacts and the other
 * prints is a leak, so this pins the shared vocabulary and the dump's use of it.
 */
import { sensitiveFieldKind } from '@/shared/lib/sensitiveFieldNames';

describe('sensitiveFieldKind', () => {
  it.each([
    ['secret', 'private-key'],
    ['nsec', 'private-key'],
    ['userNsec', 'private-key'],
    ['privkey', 'private-key'],
    ['privateKey', 'private-key'],
    ['privateKeyHex', 'private-key'],
    ['secretKey', 'private-key'],
    ['signerKey', 'private-key'],
    // Extended private keys are key material, not a recovery phrase. The logger
    // used to bucket this as `secret` while the dump said `private-key`.
    ['walletXpriv', 'private-key'],
    ['mnemonic', 'secret'],
    ['cashuMnemonic', 'secret'],
    ['seed', 'secret'],
    ['seedHex', 'secret'],
    ['passphrase', 'secret'],
    ['password', 'secret'],
    // Bearer credentials — previously logger-only, so these survived the
    // storage dump in the clear unless the value matched a bearer pattern.
    ['token', 'secret'],
    ['accessToken', 'secret'],
    ['authorization', 'secret'],
    ['proxyAuthorization', 'secret'],
  ])('classifies %s as %s', (field, kind) => {
    expect(sensitiveFieldKind(field)).toBe(kind);
  });

  it('normalizes separators and casing', () => {
    for (const spelling of ['private_key', 'private-key', 'PrivateKey', 'PRIVATE_KEY']) {
      expect(sensitiveFieldKind(spelling)).toBe('private-key');
    }
  });

  it.each(['pubkey', 'publicKeyHex', 'theme', 'count', 'mintUrl', 'npub'])(
    'leaves the public field %s alone',
    (field) => {
      expect(sensitiveFieldKind(field)).toBeNull();
    }
  );
});
