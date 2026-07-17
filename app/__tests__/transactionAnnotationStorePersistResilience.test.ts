/**
 * @jest-environment node
 *
 * A single poisoned annotation entry must degrade locally. The shared persist
 * merge rejects the entire blob when this schema fails, which is exactly how a
 * pre-hashing `raw:<full-token>` key (>1kB, over the 256-char key cap) used to
 * silently erase every transaction annotation — scan sources, counterparties,
 * P2PK locks, distributions, locations, swap groupings — on the next launch.
 */

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import '@/shared/stores/profile/transactionAnnotationStore';

jest.mock('@/shared/lib/cashu/profileScopedStorage', () => ({
  createProfileScopedStorage: () => ({
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
  }),
}));

jest.mock('@/shared/lib/logger', () => ({
  storeLog: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  log: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  redactError: (error: unknown) => error,
}));

function annotationSchema() {
  const entry = persistRegistry.find(
    (candidate) => candidate.name === 'transaction-annotation-store'
  );
  if (!entry) throw new Error('transaction-annotation-store missing from persistRegistry');
  return entry.schema;
}

describe('transactionAnnotationStore persistence', () => {
  it('drops a poisoned over-length raw key without rejecting the valid annotations', () => {
    const poisonedKey = `raw:${'cashubo2f'.repeat(150)}`;
    expect(poisonedKey.length).toBeGreaterThan(256);

    const parsed = annotationSchema().parse({
      annotations: {
        [poisonedKey]: { 'scan.method': 'paste' },
        'id:receive:1udIEOJSWCTuVPB083ecbA': { 'scan.method': 'paste' },
        'op:1udIEOJSWCTuVPB083ecbA': { 'counterparty.pubkey': 'ab'.repeat(32) },
        'quote:some-quote': { 'distribution.kind': 'copied' },
      },
    }) as { annotations: Record<string, Record<string, string>> };

    expect(parsed.annotations).toEqual({
      'id:receive:1udIEOJSWCTuVPB083ecbA': { 'scan.method': 'paste' },
      'op:1udIEOJSWCTuVPB083ecbA': { 'counterparty.pubkey': 'ab'.repeat(32) },
      'quote:some-quote': { 'distribution.kind': 'copied' },
    });
  });

  it('drops an entry whose record is malformed without rejecting its siblings', () => {
    const parsed = annotationSchema().parse({
      annotations: {
        'id:good': { 'scan.method': 'paste' },
        'id:bad-record': { nested: { not: 'a-string' } },
      },
    }) as { annotations: Record<string, Record<string, string>> };

    expect(parsed.annotations).toEqual({
      'id:good': { 'scan.method': 'paste' },
    });
  });
});
