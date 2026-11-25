/* eslint-disable import/first */

// `mintMetadataStore.auditObservations`: additive, tolerant per-source readings
// that never cost a cached mint row (or the `auditData.swaps` rebalance reads).

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

import { persistRegistry } from '@/shared/lib/persist/persistConfig';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import { mergeAuditObservations } from '@/shared/lib/cashu/auditors/observation';
import type { DiscoverMint } from '@/shared/lib/apiClient';
import { normalizeMintUrlKey } from '@/shared/lib/url';

const MINT = 'https://mint.example.com';

function schema() {
  const entry = persistRegistry.find((e) => e.name === 'mint-metadata-store');
  if (!entry) throw new Error('mint-metadata-store not registered');
  return entry.schema;
}

const SWAPS = [{ state: 'OK', time_taken: 120 }];

/** A row as 0.1.3 saved it, with the auditor blob rebalance routes from. */
const releasedRow = {
  displayName: 'Example',
  nMints: 3,
  nMelts: 2,
  nErrors: 1,
  auditSource: 'ucash',
  auditData: {
    url: MINT,
    name: 'Example',
    state: 'OK',
    n_mints: 3,
    n_melts: 2,
    n_errors: 1,
    swaps: SWAPS,
  },
  auditAt: 1_700_000_000_000,
};

beforeEach(() => {
  useMintMetadataStore.setState({ byMintUrl: {}, legacyMigrated: false });
});

describe('saved auditObservations', () => {
  it('reads a row saved before the field existed, unchanged', () => {
    const parsed = schema().parse({ byMintUrl: { [MINT]: releasedRow }, legacyMigrated: true }) as {
      byMintUrl: Record<string, typeof releasedRow & { auditObservations?: unknown }>;
    };
    expect(parsed.byMintUrl[MINT]).toEqual(releasedRow);
    expect(parsed.byMintUrl[MINT].auditData.swaps).toEqual(SWAPS);
  });

  it('drops one malformed reading and keeps its siblings and the whole row', () => {
    const parsed = schema().parse({
      byMintUrl: {
        [MINT]: {
          ...releasedRow,
          auditObservations: {
            ucash: { source: 'ucash', observedAt: 'yesterday' },
            mintradar: {
              source: 'mintradar',
              observedAt: 5,
              uptime: { pct: 140, window: '24h' },
              operations: { okCount: 9, totalCount: 10, window: '7d' },
              latency: { ms: 100, kind: 'p99', window: '24h' },
            },
          },
        },
      },
      legacyMigrated: true,
    }) as { byMintUrl: Record<string, { auditObservations?: Record<string, unknown> }> };
    const row = parsed.byMintUrl[MINT];
    expect(row).toMatchObject({ nMints: 3, auditData: { swaps: SWAPS } });
    expect(row.auditObservations?.ucash).toBeUndefined();
    // Each group checks on its own: the bad uptime and latency go, the counts stay.
    expect(row.auditObservations?.mintradar).toEqual({
      source: 'mintradar',
      observedAt: 5,
      operations: { okCount: 9, totalCount: 10, window: '7d' },
    });
  });

  it('reads a map that is not a map as absent, never rejecting the row', () => {
    const parsed = schema().parse({
      byMintUrl: { [MINT]: { ...releasedRow, auditObservations: 'garbage' } },
      legacyMigrated: true,
    }) as { byMintUrl: Record<string, Record<string, unknown>> };
    expect(parsed.byMintUrl[MINT].auditObservations).toBeUndefined();
    expect(parsed.byMintUrl[MINT].nMints).toBe(3);
  });

  it('round-trips what the store writes', () => {
    useMintMetadataStore.getState().recordAuditObservations(MINT, [
      {
        source: 'ucash',
        observedAt: 10,
        uptime: { pct: 100, window: '24h', checks: 25 },
        latency: { ms: 3394, kind: 'mean', window: '24h' },
        auditorMintId: 2,
      },
    ]);
    const state = JSON.parse(JSON.stringify({ ...useMintMetadataStore.getState() }));
    const parsed = schema().parse({ byMintUrl: state.byMintUrl, legacyMigrated: false }) as {
      byMintUrl: Record<string, { auditObservations?: unknown }>;
    };
    const key = normalizeMintUrlKey(MINT);
    expect(parsed.byMintUrl[key]?.auditObservations).toEqual(
      useMintMetadataStore.getState().byMintUrl[key]?.auditObservations
    );
    expect(parsed.byMintUrl[key]?.auditObservations).toBeDefined();
  });
});

describe('writing auditObservations', () => {
  it('records per source without stamping any freshness group', () => {
    useMintMetadataStore.setState({
      byMintUrl: { [normalizeMintUrlKey(MINT)]: releasedRow as never },
    });
    useMintMetadataStore
      .getState()
      .recordAuditObservations(MINT, [
        { source: 'mintradar', observedAt: 10, uptime: { pct: 99, window: '24h' } },
      ]);
    const entry = useMintMetadataStore.getState().getCached(MINT)!;
    expect(entry.auditAt).toBe(releasedRow.auditAt);
    expect(entry.auditData?.swaps).toEqual(SWAPS);
    expect(entry.auditObservations?.mintradar?.uptime).toEqual({ pct: 99, window: '24h' });
  });

  it('keeps groups a newer reading leaves out and clears groups it nulls', () => {
    const held = mergeAuditObservations(undefined, [
      {
        source: 'ucash',
        observedAt: 1,
        operations: { okCount: 9, totalCount: 10, window: 'all' },
        latency: { ms: 500, kind: 'mean', window: '24h' },
        auditorMintId: 2,
      },
    ]);
    const next = mergeAuditObservations(held, [
      {
        source: 'ucash',
        observedAt: 2,
        uptime: { pct: 50, window: '24h', checks: 2 },
        latency: null,
      },
    ]);
    expect(next.ucash).toEqual({
      source: 'ucash',
      observedAt: 2,
      operations: { okCount: 9, totalCount: 10, window: 'all' },
      uptime: { pct: 50, window: '24h', checks: 2 },
      auditorMintId: 2,
    });
  });

  it('ignores an older reading and an unknown source', () => {
    const held = mergeAuditObservations(undefined, [
      { source: 'ucash', observedAt: 5, uptime: { pct: 90, window: '24h', checks: 1 } },
    ]);
    const next = mergeAuditObservations(held, [
      { source: 'ucash', observedAt: 4, uptime: { pct: 10, window: '24h', checks: 1 } },
      { source: 'evil' as never, observedAt: 9 },
    ]);
    expect(next.ucash?.uptime?.pct).toBe(90);
    expect(Object.keys(next)).toEqual(['ucash']);
  });

  it('merges readings a discovery row carries', () => {
    const row = {
      mintUrl: MINT,
      name: 'Example',
      supportedUnits: ['sat'],
      averageScore: null,
      reviewCount: 0,
      auditObservations: {
        macadamia: {
          source: 'macadamia',
          observedAt: 3,
          operations: { okCount: 1, totalCount: 2, window: 'all' },
          auditorMintId: 4,
        },
      },
    } as unknown as DiscoverMint;
    useMintMetadataStore
      .getState()
      .recordAuditObservations(MINT, [
        { source: 'ucash', observedAt: 1, uptime: { pct: 99, window: '24h', checks: 3 } },
      ]);
    useMintMetadataStore.getState().upsertFromDiscover([row]);
    const obs = useMintMetadataStore.getState().getCached(MINT)?.auditObservations;
    expect(obs?.ucash?.uptime?.pct).toBe(99);
    expect(obs?.macadamia?.auditorMintId).toBe(4);
  });
});
