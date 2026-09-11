import { useScanHistoryStore } from '@/shared/stores/profile/scanHistoryStore';

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

describe('useScanHistoryStore.addScan', () => {
  beforeEach(() => {
    useScanHistoryStore.setState({ entries: [], entriesByTransactionId: {} });
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

  it('linkTransaction matches an equivalent normalized scan', () => {
    const { addScan, linkTransaction } = useScanHistoryStore.getState();
    addScan('lnbc1foo', 'lightning', 'qr');
    linkTransaction('  LIGHTNING:LNBC1FOO  ', 'tx-123');
    expect(useScanHistoryStore.getState().entries[0].transactionId).toBe('tx-123');
  });

  it.each([
    ['cashuBAbC', 'cashuBaBc', 'ecash'],
    ['https://mint.example/Bitcoin', 'https://mint.example/bitcoin', 'mint'],
    ['bitcoin:bc1qfixture?label=Alice', 'bitcoin:bc1qfixture?label=alice', 'paymentRequest'],
    ['creqAAbC', 'creqAaBc', 'paymentRequest'],
  ] as const)('keeps case-sensitive inputs distinct: %s', (first, second, type) => {
    const { addScan, linkTransaction } = useScanHistoryStore.getState();
    addScan(first, type, 'qr');
    addScan(second, type, 'paste');
    linkTransaction(second, 'tx-second');
    expect(
      useScanHistoryStore
        .getState()
        .entries.map(({ raw, transactionId }) => ({ raw, transactionId }))
    ).toEqual([
      { raw: first, transactionId: undefined },
      { raw: second, transactionId: 'tx-second' },
    ]);
  });

  it('dedupes a cashu URI without changing its case-sensitive payload', () => {
    const { addScan } = useScanHistoryStore.getState();
    addScan('cashuBAbC', 'ecash', 'qr');
    addScan(' CASHU:cashuBAbC ', 'ecash', 'paste');
    expect(useScanHistoryStore.getState().entries).toHaveLength(1);
    expect(useScanHistoryStore.getState().entries[0].raw).toBe('cashuBAbC');
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
      entriesByTransactionId: {},
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

describe('useScanHistoryStore.entriesByTransactionId', () => {
  beforeEach(() => {
    useScanHistoryStore.setState({ entries: [], entriesByTransactionId: {} });
  });

  it('linkTransaction populates the index for O(1) lookup by transactionId', () => {
    const { addScan, linkTransaction } = useScanHistoryStore.getState();
    addScan('lnbc1foo', 'lightning', 'qr');
    linkTransaction('lnbc1foo', 'tx-123');

    const { entries, entriesByTransactionId } = useScanHistoryStore.getState();
    expect(entriesByTransactionId['tx-123']).toBe(entries[0]);
    expect(entriesByTransactionId['tx-123'].raw).toBe('lnbc1foo');
  });

  it('addScan dedupe path keeps the index in sync with the merged entry ref', () => {
    const { addScan, linkTransaction } = useScanHistoryStore.getState();
    addScan('lnbc1foo', 'lightning', 'qr');
    linkTransaction('lnbc1foo', 'tx-123');
    addScan('lnbc1foo', 'lightning', 'nfc');

    const { entries, entriesByTransactionId } = useScanHistoryStore.getState();
    expect(entriesByTransactionId['tx-123']).toBe(entries[0]);
    expect(entriesByTransactionId['tx-123'].source).toBe('nfc');
  });

  it('skips entries with no transactionId', () => {
    const { addScan } = useScanHistoryStore.getState();
    addScan('lnbc1foo', 'lightning', 'qr');
    expect(Object.keys(useScanHistoryStore.getState().entriesByTransactionId)).toHaveLength(0);
  });
});
