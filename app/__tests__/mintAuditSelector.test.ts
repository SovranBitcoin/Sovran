/* eslint-disable import/first */

// One reading of a mint's audit for every surface. Locks the source rule (nagg's
// discovery group, else the retired-API blob, never a blend), the wholesale
// store write that keeps one auditor's fields from outliving its row, and that
// a mint row and the mint info page derive identical numbers.

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  multiGet: jest.fn(() => Promise.resolve([])),
  multiRemove: jest.fn(() => Promise.resolve()),
}));

import type { MintListItem } from 'wallet';

import { resolveMintRows } from '@/features/mint/hooks/useMintRowsWithCache';
import { projectMintMeta, selectMintAudit } from '@/features/mint/lib/auditInfo';
import type { DiscoverMint } from '@/shared/lib/apiClient';
import { normalizeMintUrlKey } from '@/shared/lib/url';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';
import type { LegacyMintAudit, MintMetadataEntry } from '@/shared/stores/global/mintMetadataTypes';

const MINT = 'https://mint.example.com';

// Audit halves of live `/nostr/mint/discover` rows, one per auditor.
const UCASH_ROW: DiscoverMint = {
  mintUrl: MINT,
  averageScore: null,
  reviewCount: 0,
  hasAudit: true,
  state: 'OK',
  nMints: 94,
  nMelts: 106,
  nErrors: 10,
  uptime24h: 100,
  avgLatencyMs: 3183.4,
  auditSource: 'ucash',
  auditUpdatedAt: 1789964506,
};
const LEGACY_AUDITOR_ROW: DiscoverMint = {
  mintUrl: MINT,
  averageScore: null,
  reviewCount: 0,
  hasAudit: true,
  state: 'OK',
  nMints: 1760,
  nMelts: 1817,
  nErrors: 280,
  auditSource: '8333',
};
// Nagg still sends zero counts for a mint no auditor tracks.
const UNAUDITED_ROW: DiscoverMint = {
  mintUrl: MINT,
  averageScore: null,
  reviewCount: 0,
  hasAudit: false,
  nMints: 0,
  nMelts: 0,
  nErrors: 0,
};

const BLOB = {
  url: MINT,
  name: 'Example',
  state: 'ERROR',
  n_mints: 6,
  n_melts: 2,
  n_errors: 2,
  swaps: [
    { state: 'OK', time_taken: 400 },
    { state: 'OK', time_taken: 600 },
    { state: 'ERROR', time_taken: 0 },
  ],
} as unknown as LegacyMintAudit;

const store = () => useMintMetadataStore.getState();
const cached = () => store().getCached(MINT);

beforeEach(() => {
  useMintMetadataStore.setState({ byMintUrl: {} });
});

describe('selectMintAudit', () => {
  it('reads a ucash row: operation rate plus the latency only ucash measures', () => {
    store().upsertFromDiscover([UCASH_ROW]);
    expect(selectMintAudit(cached())).toEqual({
      source: 'ucash',
      state: 'OK',
      successRate: 200 / 210,
      score: (200 / 210) * 5,
      totalOps: 210,
      mints: 94,
      melts: 106,
      avgLatencyMs: 3183.4,
    });
  });

  it('reads the 8333 row nagg falls back to for a mint ucash does not track', () => {
    store().upsertFromDiscover([LEGACY_AUDITOR_ROW]);
    const audit = selectMintAudit(cached());
    expect(audit).toMatchObject({ source: '8333', state: 'OK', totalOps: 3857 });
    expect(audit?.successRate).toBeCloseTo(3577 / 3857);
    expect(audit).not.toHaveProperty('avgLatencyMs');
  });

  it('takes the discovery group whole and lets nothing from the blob through', () => {
    store().setAudit(MINT, BLOB);
    store().upsertFromDiscover([LEGACY_AUDITOR_ROW]);
    const audit = selectMintAudit(cached());
    expect(audit).toMatchObject({ source: '8333', state: 'OK', mints: 1760, melts: 1817 });
    // The blob's swap latency belongs to a different measurement.
    expect(audit).not.toHaveProperty('avgLatencyMs');
  });

  it('falls back to the blob, read whole, once nagg reports no audit', () => {
    store().setAudit(MINT, BLOB);
    store().upsertFromDiscover([UNAUDITED_ROW]);
    expect(selectMintAudit(cached())).toEqual({
      source: '8333',
      state: 'ERROR',
      successRate: 0.8,
      score: 4,
      totalOps: 10,
      mints: 6,
      melts: 2,
      avgLatencyMs: 500,
    });
  });

  it('has no audit for a missing entry, an unaudited mint, or a cached zero-count group', () => {
    expect(selectMintAudit(undefined)).toBeUndefined();
    expect(selectMintAudit({ displayName: 'Mint' })).toBeUndefined();
    // What app versions before the wholesale write cached for an unaudited mint.
    expect(selectMintAudit({ nMints: 0, nMelts: 0, nErrors: 0, auditScore: null })).toBeUndefined();
    store().upsertFromDiscover([UNAUDITED_ROW]);
    expect(selectMintAudit(cached())).toBeUndefined();
  });

  it('keeps the state but claims no rate while a count is unknown', () => {
    expect(selectMintAudit({ auditState: 'OK', nMints: 3, nMelts: 2 })).toEqual({
      source: undefined,
      state: 'OK',
      mints: 3,
      melts: 2,
    });
  });

  it('ignores a persisted auditScore that disagrees with the counts', () => {
    const entry: MintMetadataEntry = { auditScore: 1, nMints: 5, nMelts: 5, nErrors: 0 };
    expect(selectMintAudit(entry)?.score).toBe(5);
  });
});

describe('upsertFromDiscover audit group', () => {
  it('drops ucash-only fields when the mint moves to the 8333 auditor', () => {
    store().upsertFromDiscover([UCASH_ROW]);
    store().upsertFromDiscover([LEGACY_AUDITOR_ROW]);
    expect(cached()).toMatchObject({ auditSource: '8333', nMints: 1760 });
    expect(cached()?.uptime24h).toBeUndefined();
    expect(cached()?.avgLatencyMs).toBeUndefined();
    expect(cached()?.auditUpdatedAt).toBeUndefined();
  });

  it('clears the group and settles the read when nagg reports no audit', () => {
    store().upsertFromDiscover([UCASH_ROW]);
    store().upsertFromDiscover([UNAUDITED_ROW]);
    expect(cached()?.auditState).toBeUndefined();
    expect(cached()?.nMints).toBeUndefined();
    expect(cached()?.auditSource).toBeUndefined();
    expect(store().isStale(MINT, 'audit')).toBe(false);
  });

  it('leaves a cached audit alone when the row says nothing about audit', () => {
    store().upsertFromDiscover([UCASH_ROW]);
    store().upsertFromDiscover([{ mintUrl: MINT, averageScore: 4, reviewCount: 3 }]);
    expect(cached()).toMatchObject({ auditSource: 'ucash', nMints: 94, avgLatencyMs: 3183.4 });
  });

  it('survives a persist round-trip: the cleared keys are simply absent', () => {
    store().upsertFromDiscover([UCASH_ROW]);
    store().upsertFromDiscover([LEGACY_AUDITOR_ROW]);
    const revived = JSON.parse(JSON.stringify(cached())) as MintMetadataEntry;
    expect(selectMintAudit(revived)).toEqual(selectMintAudit(cached()));
  });
});

describe('mint row and mint info page congruence', () => {
  function row(overrides: Partial<MintListItem> = {}): MintListItem {
    return {
      mintUrl: MINT,
      displayName: 'Mint',
      balance: 0,
      unit: 'sat',
      status: 'available',
      reason: null,
      isPreferred: false,
      ...overrides,
    };
  }

  it.each([
    ['ucash', [UCASH_ROW]],
    ['8333', [LEGACY_AUDITOR_ROW]],
    ['ucash then 8333', [UCASH_ROW, LEGACY_AUDITOR_ROW]],
  ])('shows the same numbers on both for %s', (_label, writes) => {
    for (const write of writes) store().upsertFromDiscover([write]);
    // The base row carries an older snapshot, as it does after a background refresh.
    const { rows } = resolveMintRows({
      isTestnutMint: () => false,
      baseItems: [row({ auditScore: 1.5, auditState: 'ERROR', auditTotalOps: 7 })],
      itemsStatus: 'ready',
      byMintUrl: { [normalizeMintUrlKey(MINT)]: cached()! },
    });
    const page = projectMintMeta(cached()).audit;
    expect(page?.score).toEqual(expect.any(Number));
    expect(rows[0].auditScore).toBe(page?.score);
    expect(rows[0].auditState).toBe(page?.state);
    expect(rows[0].auditTotalOps).toBe(page?.totalOps);
  });

  it('keeps the row snapshot only when the cache holds no audit at all', () => {
    const { rows } = resolveMintRows({
      isTestnutMint: () => false,
      baseItems: [row({ auditScore: 4, auditState: 'OK', auditTotalOps: 12 })],
      itemsStatus: 'ready',
      byMintUrl: { [normalizeMintUrlKey(MINT)]: { displayName: 'Mint' } },
    });
    expect(rows[0]).toMatchObject({ auditScore: 4, auditState: 'OK', auditTotalOps: 12 });
  });
});
