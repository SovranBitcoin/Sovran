/**
 * Upgrading a scan history that an older release wrote past today's limits.
 *
 * Releases from 0.0.52 saved every scan with no limit on the list or on the
 * scanned string. A read that turns such a list down empties the history, and
 * the one-time annotation import then finds no transaction links to carry
 * over. The import reads `entries` from this store once it has loaded, so what
 * survives here is what it sees.
 */

const mockMemory: Record<string, string> = {};

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async (k: string) => mockMemory[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockMemory[k] = v;
    },
    removeItem: async (k: string) => {
      delete mockMemory[k];
    },
  }),
}));
jest.mock('@/shared/lib/logger', () => {
  const noop = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { storeLog: noop, log: noop, redactError: (e: unknown) => e };
});

const STORAGE_KEY = 'scan-history-store';

/** An entry as 0.0.52 wrote it: `processed` beside `raw`, no parser fields. */
function releasedScan(index: number, extra: Record<string, unknown> = {}) {
  return {
    id: `${1_700_000_000_000 + index}-abc${index}`,
    raw: `lnbc1scan${index}`,
    processed: `lnbc1scan${index}`,
    type: 'lightning',
    source: 'qr',
    scannedAt: 1_700_000_000_000 + index,
    ...extra,
  };
}

/** Old releases appended, so the oldest scan is first. Version 0 is zustand's default. */
function preload(entries: unknown[], version = 0) {
  mockMemory[STORAGE_KEY] = JSON.stringify({ state: { entries }, version });
}

async function loadStore() {
  const mod =
    require('@/shared/stores/profile/scanHistoryStore') as typeof import('@/shared/stores/profile/scanHistoryStore');
  await mod.useScanHistoryStore.persist.rehydrate();
  return mod.useScanHistoryStore;
}

describe('scan history upgrade past the limits', () => {
  beforeEach(() => {
    jest.resetModules();
    for (const k of Object.keys(mockMemory)) delete mockMemory[k];
  });

  it('keeps all 501 scans an earlier release saved, with their transaction links', async () => {
    preload(
      Array.from({ length: 501 }, (_, i) =>
        releasedScan(i, i === 0 || i === 1 || i === 500 ? { transactionId: `tx-${i}` } : {})
      )
    );

    const store = await loadStore();
    const { entries, entriesByTransactionId } = store.getState();

    // The oldest scan holds the only link to its transaction, and the
    // annotation import reads these after loading.
    expect(entries).toHaveLength(501);
    expect(entriesByTransactionId['tx-0'].raw).toBe('lnbc1scan0');
    expect(entriesByTransactionId['tx-1'].raw).toBe('lnbc1scan1');
    expect(entriesByTransactionId['tx-500'].raw).toBe('lnbc1scan500');
  });

  it('keeps a scan whose string is longer than a new scan may be', async () => {
    preload([
      releasedScan(0, { transactionId: 'tx-0' }),
      releasedScan(1, { raw: 'c'.repeat(16_385), transactionId: 'tx-1' }),
      releasedScan(2, { raw: 'c'.repeat(16_384), transactionId: 'tx-2' }),
    ]);

    const store = await loadStore();
    const { entries, entriesByTransactionId } = store.getState();

    expect(entries.map((e) => e.transactionId)).toEqual(['tx-0', 'tx-1', 'tx-2']);
    expect(Object.keys(entriesByTransactionId).sort()).toEqual(['tx-0', 'tx-1', 'tx-2']);
  });

  it('comes back under the limit the next time a scan is added', async () => {
    preload(Array.from({ length: 501 }, (_, i) => releasedScan(i)));
    const store = await loadStore();
    store.getState().addScan({ raw: 'lnbc1brandnew', type: 'lightning', source: 'paste' });
    expect(store.getState().entries).toHaveLength(500);
    expect(store.getState().entries.some((e) => e.raw === 'lnbc1brandnew')).toBe(true);
  });

  it('drops an entry it cannot read without losing the rest', async () => {
    preload([releasedScan(0), null, { raw: 'no-id' }, releasedScan(1)]);
    const store = await loadStore();
    expect(store.getState().entries.map((e) => e.raw)).toEqual(['lnbc1scan0', 'lnbc1scan1']);
  });

  it('reads a 0.1.3 history back unchanged', async () => {
    // Version 1, with the parser fields 0.1.3 records and its own 500 limit.
    const entries = [
      {
        id: 'scan-b',
        raw: 'bitcoin:bc1qfixture?lightning=lnbc1fixture',
        type: 'paymentRequest',
        source: 'nfc',
        inputType: 'bip321',
        container: 'bip321',
        optionKinds: ['lightningInvoice', 'onchain'],
        scannedAt: 1_800_000_000_002,
        transactionId: 'tx-b',
      },
      { id: 'scan-a', raw: 'cashuBfixture', type: 'ecash', source: 'paste', scannedAt: 5 },
      ...Array.from({ length: 498 }, (_, i) => ({
        id: `scan-${i}`,
        raw: `npub1fixture${i}`,
        type: 'npub',
        source: 'qr',
        scannedAt: 1_800_000_000_000 - i,
      })),
    ];
    preload(entries, 1);
    const before = mockMemory[STORAGE_KEY];

    const store = await loadStore();

    expect(store.getState().entries).toEqual(entries);
    expect(store.getState().entriesByTransactionId['tx-b'].raw).toBe(entries[0].raw);
    expect(mockMemory[STORAGE_KEY]).toBe(before);
  });

  it('does not record a new scan that is too long', async () => {
    const store = await loadStore();
    store.getState().addScan({ raw: 'c'.repeat(16_385), type: 'ecash', source: 'paste' });
    store.getState().addScan({ raw: 'c'.repeat(16_384), type: 'ecash', source: 'paste' });
    expect(store.getState().entries).toHaveLength(1);
  });
});
