/**
 * Pins the outbound-data redactor used by Settings → Share Full Dump
 * (audit 24#F-007). The Settings screen ships an AsyncStorage dump
 * through the OS share sheet for debugging; without this redactor it
 * would leak bearer instruments (cashu tokens, lightning invoices)
 * and precise transaction-location geolocation to any chat/email the
 * user pastes the dump into.
 */

import { redactStorageDump } from '@/shared/lib/debug/storageInventory';

describe('redactStorageDump', () => {
  it('drops every transaction-location-store variant', () => {
    const out = redactStorageDump({
      'transaction-location-store': { lat: 51.5, lon: -0.1 },
      'transaction-location-store:profile:abc': { lat: 40.7, lon: -74 },
      'mint-store': { mints: [] },
    });
    expect(out['transaction-location-store']).toBe('<REDACTED:geolocation-store>');
    expect(out['transaction-location-store:profile:abc']).toBe('<REDACTED:geolocation-store>');
    expect(out['mint-store']).toEqual({ mints: [] });
  });

  it('redacts cashu tokens embedded inside any string value', () => {
    const out = redactStorageDump({
      'scan-history-store': {
        items: [
          { raw: 'cashuAeyJhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5elxx' },
          { raw: 'just text' },
          { note: 'received cashuB-eyJhMSIsImEyIiwiYTMiLCJhNCJdfQ via DM' },
        ],
      },
    });
    const items = (out['scan-history-store'] as { items: { raw?: string; note?: string }[] }).items;
    expect(items[0].raw).toBe('<REDACTED:cashu-token>');
    expect(items[1].raw).toBe('just text');
    expect(items[2].note).toBe('received <REDACTED:cashu-token> via DM');
  });

  it('redacts lightning invoices in any of the four hrp variants', () => {
    const out = redactStorageDump({
      a: 'lnbc100n1pj9abcdefgh1234567890qwerty',
      b: 'LNTB200n1pjxabcdefgh1234567890mainnet',
      c: { nested: 'lnbcrt500n1pj9abcdefghdevtestnetdevtest' },
      d: ['lnsb1000n1pj9abcdefgh1234567890simnet'],
    });
    expect(out.a).toBe('<REDACTED:lightning-invoice>');
    expect(out.b).toBe('<REDACTED:lightning-invoice>');
    expect((out.c as { nested: string }).nested).toBe('<REDACTED:lightning-invoice>');
    expect((out.d as string[])[0]).toBe('<REDACTED:lightning-invoice>');
  });

  it('redacts nsec strings embedded anywhere in a dump', () => {
    const nsec = 'nsec1' + 'a'.repeat(58);
    const out = redactStorageDump({
      'legacy-nostr-store': {
        raw: nsec,
        note: `imported ${nsec}`,
      },
    });
    const legacy = out['legacy-nostr-store'] as { raw: string; note: string };
    expect(legacy.raw).toBe('<REDACTED:nsec>');
    expect(legacy.note).toBe('imported <REDACTED:nsec>');
  });

  it('redacts mnemonic and private-key fields by key name', () => {
    const out = redactStorageDump({
      'legacy-wallet-store': {
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        cashuMnemonic:
          'legal winner thank year wave sausage worth useful legal winner thank yellow',
        keys: {
          privateKeyHex: 'f'.repeat(64),
          secretKey: 'e'.repeat(64),
          publicKeyHex: 'a'.repeat(64),
        },
      },
    });
    const legacy = out['legacy-wallet-store'] as {
      mnemonic: string;
      cashuMnemonic: string;
      keys: { privateKeyHex: string; secretKey: string; publicKeyHex: string };
    };
    expect(legacy.mnemonic).toBe('<REDACTED:secret>');
    expect(legacy.cashuMnemonic).toBe('<REDACTED:secret>');
    expect(legacy.keys.privateKeyHex).toBe('<REDACTED:private-key>');
    expect(legacy.keys.secretKey).toBe('<REDACTED:private-key>');
    expect(legacy.keys.publicKeyHex).toBe('a'.repeat(64));
  });

  it('preserves non-sensitive primitive values unchanged', () => {
    const out = redactStorageDump({
      'settings-store': { theme: 'dark', count: 42, enabled: true, deleted: null },
    });
    expect(out['settings-store']).toEqual({
      theme: 'dark',
      count: 42,
      enabled: true,
      deleted: null,
    });
  });

  it('does not redact bare 64-hex strings (npubs / event ids are public)', () => {
    const npubHex = 'a'.repeat(64);
    const out = redactStorageDump({ 'nostr-social-store': { pubkey: npubHex } });
    expect((out['nostr-social-store'] as { pubkey: string }).pubkey).toBe(npubHex);
  });
});
