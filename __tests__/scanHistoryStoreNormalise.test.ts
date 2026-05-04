/**
 * Pins the dedupe-key shape for `useScanHistoryStore.addScan`. Surface forms
 * a real user produces — leading scheme prefixes from QR / clipboard / NFC,
 * stray whitespace, mixed casing on hex blobs — must collapse to a single
 * entry instead of accumulating once per surface form. The helper is pure
 * so the test exercises it directly without booting zustand+persist.
 */

import { normaliseForDedupe, useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';

jest.mock('@sovranbitcoin/schemas', () => ({
  loggableIssues: () => [],
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (e: unknown) => e,
}));

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

describe('normaliseForDedupe', () => {
  it('strips a leading nostr: scheme', () => {
    const npub = 'npub1abc';
    expect(normaliseForDedupe(`nostr:${npub}`)).toBe(npub);
    expect(normaliseForDedupe(npub)).toBe(npub);
  });

  it('strips bitcoin: / lightning: / cashu: schemes', () => {
    expect(normaliseForDedupe('bitcoin:bc1q...')).toBe('bc1q...');
    expect(normaliseForDedupe('lightning:lnbc1...')).toBe('lnbc1...');
    expect(normaliseForDedupe('cashu:cashuB...')).toBe('cashub...');
  });

  it('lowercases and trims surrounding whitespace', () => {
    expect(normaliseForDedupe('  LNBC1Foo  ')).toBe('lnbc1foo');
  });

  it('collapses scheme + casing + whitespace variants onto the same key', () => {
    const variants = ['LNBC1Foo', 'lnbc1foo', 'lightning:LNBC1Foo', '  Lightning:lnbc1foo  '];
    const keys = new Set(variants.map(normaliseForDedupe));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('lnbc1foo');
  });

  it('only strips a scheme prefix, not embedded matches', () => {
    expect(normaliseForDedupe('nostr:npub:embedded')).toBe('npub:embedded');
    expect(normaliseForDedupe('http://example.com/lightning:foo')).toBe(
      'http://example.com/lightning:foo'
    );
  });
});

describe('useScanHistoryStore.addScan', () => {
  beforeEach(() => {
    useScanHistoryStore.setState({ entries: [] });
  });

  it('dedupes scheme-prefixed and bare forms onto a single entry', () => {
    const { addScan } = useScanHistoryStore.getState();
    addScan('lnbc1foo', 'lightning', 'qr');
    addScan('lightning:LNBC1Foo', 'lightning', 'paste');
    addScan('  lnbc1foo  ', 'lightning', 'nfc');

    const { entries } = useScanHistoryStore.getState();
    expect(entries).toHaveLength(1);
    // Original raw is preserved; the most recent source wins.
    expect(entries[0].raw).toBe('lnbc1foo');
    expect(entries[0].source).toBe('nfc');
  });

  it('linkTransaction matches on raw (the same value addScan recorded)', () => {
    const { addScan, linkTransaction } = useScanHistoryStore.getState();
    addScan('lnbc1foo', 'lightning', 'qr');
    linkTransaction('lnbc1foo', 'tx-123');
    expect(useScanHistoryStore.getState().entries[0].transactionId).toBe('tx-123');
  });

  it('caps entries at MAX_SCAN_HISTORY (500), tail-evicting oldest by scannedAt', () => {
    // Seed 500 distinct entries with monotonically-increasing timestamps so
    // sort order is unambiguous, then add one more and assert tail-eviction.
    useScanHistoryStore.setState({
      entries: Array.from({ length: 500 }, (_, i) => ({
        id: `seed-${i}`,
        raw: `seed-${i}`,
        type: 'unknown' as const,
        source: 'qr' as const,
        scannedAt: 1_000_000 + i,
      })),
    });

    useScanHistoryStore.getState().addScan('newest', 'unknown', 'qr');

    const { entries } = useScanHistoryStore.getState();
    expect(entries).toHaveLength(500);
    expect(entries[0].raw).toBe('newest');
    // The oldest seeded entry (seed-0, scannedAt=1_000_000) was evicted.
    expect(entries.some((e) => e.id === 'seed-0')).toBe(false);
    expect(entries.some((e) => e.id === 'seed-499')).toBe(true);
  });
});
