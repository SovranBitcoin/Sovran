import { createLogger } from '@/shared/lib/logger';

// Exercise the real compaction/redaction pipeline end to end: log a value under
// a NEUTRAL field name (so field-name rules don't fire) and inspect what landed
// in the ring buffer. Anything a private key could be encoded as — hex, base58
// (WIF / xprv), base64 — must never appear in the stored entry.
function logValue(value: unknown): { brand: unknown; json: string } {
  const log = createLogger({ level: 'debug', async: false, transports: [], pretty: false });
  log.info('redaction.test', { blob: value });
  const entry = log.getRecentLogs().find((e) => e.event === 'redaction.test');
  const brand = (entry?.params as Record<string, unknown> | undefined)?.blob;
  return { brand, json: JSON.stringify(brand) };
}

function logField(field: string, value: unknown): { brand: unknown; json: string } {
  const log = createLogger({ level: 'debug', async: false, transports: [], pretty: false });
  log.info('redaction.field-test', { [field]: value });
  const entry = log.getRecentLogs().find((e) => e.event === 'redaction.field-test');
  const brand = (entry?.params as Record<string, unknown> | undefined)?.[field];
  return { brand, json: JSON.stringify(brand) };
}

describe('logger redaction — private key material is never shown', () => {
  it('brands a WIF private key (base58) as a secret, no value', () => {
    const wif = '5' + 'K'.repeat(50); // 51 chars, mainnet-shaped
    const { brand, json } = logValue(wif);
    expect(brand).toEqual({ _kind: 'wif', len: wif.length });
    expect(json).not.toContain(wif);
  });

  it('brands an extended private key (xprv) — was logged in full at ≤120 chars', () => {
    const xprv = 'xprv' + '9'.repeat(107); // 111 chars
    const { brand, json } = logValue(xprv);
    expect(brand).toEqual({ _kind: 'xprv', len: xprv.length });
    expect(json).not.toContain('9'.repeat(20));
  });

  it('brands a 32-byte base64 secret (44 chars) — was shown in full', () => {
    const b64 = 'A'.repeat(43) + '='; // 44 chars => 32 bytes
    const { brand, json } = logValue(b64);
    expect(brand).toEqual({ _kind: 'base64_key', len: 44 });
    expect(json).not.toContain('AAAA');
  });

  it('never previews opaque hex / base64 / base58 long values', () => {
    // 50-char hex (below base64's 60 floor, so it lands on the hex pattern).
    expect(logValue('a'.repeat(50)).brand).toEqual({ _kind: 'hex', len: 50 });
    expect(logValue('A'.repeat(70)).brand).toEqual({ _kind: 'base64', len: 70 });
    // 45-char base58 blob (e.g. an opaque key encoding) — no bytes shown.
    const b58 = 'z'.repeat(40);
    expect(logValue(b58).brand).toEqual({ _kind: 'base58', len: 40 });
  });

  it('still brands a 32-byte hex value (privkey length) with no preview', () => {
    const hex64 = 'a'.repeat(64);
    expect(logValue(hex64).brand).toEqual({ _kind: 'hex32', len: 64 });
  });

  it('redacts an embedded xprv inside a larger string', () => {
    const xprv = 'xprv' + 'z'.repeat(107);
    const { brand } = logValue(`restored from ${xprv} ok`);
    expect(String(brand)).toContain('<REDACTED:xprv>');
    expect(String(brand)).not.toContain('z'.repeat(20));
  });

  it('does NOT over-redact a public npub (stays readable)', () => {
    const npub = 'npub1' + 'q'.repeat(58);
    const { brand } = logValue(npub);
    // Public identity: kept as a readable string, not branded away.
    expect(typeof brand).toBe('string');
    expect(brand).toBe(npub);
  });

  it('does NOT over-redact ordinary short strings', () => {
    expect(logValue('hello world').brand).toBe('hello world');
    expect(logValue('feed.note.inline').brand).toBe('feed.note.inline');
  });

  it('brands a BIP39 mnemonic under a neutral field as a secret, no value', () => {
    const mnemonic = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const { brand, json } = logValue(mnemonic);
    expect(brand).toEqual({ _kind: 'mnemonic', len: mnemonic.length });
    expect(json).not.toContain('winner');
  });

  it('redacts a mnemonic embedded inside a larger error string', () => {
    const mnemonic = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const { brand } = logValue(`restore failed for seed: ${mnemonic} (aborting)`);
    expect(String(brand)).toContain('<REDACTED:mnemonic>');
    expect(String(brand)).not.toContain('sausage');
  });

  it.each(['privateKeyHex', 'signerKey', 'nsec'])(
    'redacts short strings under sensitive field %s',
    (field) => {
      const { brand, json } = logField(field, 'abc');
      expect(brand).toEqual({ _kind: 'private_key', len: 3 });
      expect(json).not.toContain('abc');
    }
  );

  it('redacts raw seed bytes under a sensitive field name', () => {
    const { brand, json } = logField('cashuSeed', new Uint8Array([1, 2, 3, 4]));
    expect(brand).toEqual({ _kind: 'secret', bytes: 4 });
    expect(json).not.toContain('1,2,3,4');
  });

  it('keeps a value-derived nsec brand when it is more specific than the field', () => {
    const nsec = `nsec1${'q'.repeat(58)}`;
    const { brand } = logField('signerKey', nsec);
    expect(brand).toEqual({ _kind: 'nsec', len: nsec.length });
  });
});
