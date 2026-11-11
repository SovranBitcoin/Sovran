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
    useScanHistoryStore.setState({ entries: [] });
  });

  it('dedupes scheme-prefixed and bare forms onto a single entry', () => {
    const { addScan } = useScanHistoryStore.getState();
    addScan({ raw: 'lnbc1foo', type: 'lightning', source: 'qr' });
    addScan({ raw: 'lightning:LNBC1Foo', type: 'lightning', source: 'paste' });
    addScan({ raw: '  lnbc1foo  ', type: 'lightning', source: 'nfc' });

    const { entries } = useScanHistoryStore.getState();
    expect(entries).toHaveLength(1);
    // Original raw is preserved; the most recent source wins.
    expect(entries[0].raw).toBe('lnbc1foo');
    expect(entries[0].source).toBe('nfc');
  });

  it('linkTransaction matches an equivalent normalized scan', () => {
    const { addScan, linkTransaction } = useScanHistoryStore.getState();
    addScan({ raw: 'lnbc1foo', type: 'lightning', source: 'qr' });
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
    addScan({ raw: first, type, source: 'qr' });
    addScan({ raw: second, type, source: 'paste' });
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
    addScan({ raw: 'cashuBAbC', type: 'ecash', source: 'qr' });
    addScan({ raw: ' CASHU:cashuBAbC ', type: 'ecash', source: 'paste' });
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
    });

    useScanHistoryStore.getState().addScan({ raw: 'newest', type: 'unknown', source: 'qr' });

    const { entries } = useScanHistoryStore.getState();
    expect(entries).toHaveLength(500);
    expect(entries[0].raw).toBe('newest');
    // The oldest seeded entry (seed-0, scannedAt=1_000_000) was evicted.
    expect(entries.some((e) => e.id === 'seed-0')).toBe(false);
    expect(entries.some((e) => e.id === 'seed-499')).toBe(true);
  });
});

describe('useScanHistoryStore.linkTransaction', () => {
  beforeEach(() => {
    useScanHistoryStore.setState({ entries: [] });
  });

  it('records the transaction on the matching scan', () => {
    const { addScan, linkTransaction } = useScanHistoryStore.getState();
    addScan({ raw: 'lnbc1foo', type: 'lightning', source: 'qr' });
    linkTransaction('lnbc1foo', 'tx-123');

    expect(useScanHistoryStore.getState().entries[0]).toMatchObject({
      raw: 'lnbc1foo',
      transactionId: 'tx-123',
    });
  });

  it('a later scan of the same string keeps the link and takes the new source', () => {
    const { addScan, linkTransaction } = useScanHistoryStore.getState();
    addScan({ raw: 'lnbc1foo', type: 'lightning', source: 'qr' });
    linkTransaction('lnbc1foo', 'tx-123');
    addScan({ raw: 'lnbc1foo', type: 'lightning', source: 'nfc' });

    const { entries } = useScanHistoryStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ transactionId: 'tx-123', source: 'nfc' });
  });
});
