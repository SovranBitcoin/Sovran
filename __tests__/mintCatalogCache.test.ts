/* eslint-disable import/first */

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

jest.mock('@/shared/lib/apiClient', () => ({
  auditMint: jest.fn(),
  reviewMint: jest.fn(),
  fetchNostrProfile: jest.fn(),
}));

import { ok } from 'neverthrow';
import type { GetInfoResponse } from '@cashu/cashu-ts';

import { getMintCatalog } from '@/shared/lib/getMintCatalog';
import type { AuditMintResponse } from '@/shared/lib/apiClient';
import { auditMint, fetchNostrProfile, reviewMint } from '@/shared/lib/apiClient';
import { useMintMetadataStore } from '@/shared/stores/global/mintMetadataStore';

const MINT_URL = 'https://mint.example.com';
const OPERATOR_PUBKEY = 'a'.repeat(64);

function auditData(overrides: Record<string, unknown> = {}) {
  return {
    url: MINT_URL,
    name: 'Example Mint',
    state: 'OK',
    n_mints: 10,
    n_melts: 5,
    n_errors: 0,
    swaps: [
      { state: 'OK', time_taken: 100 },
      { state: 'ERROR', time_taken: 0 },
    ],
    info: {
      name: 'Example Mint',
      pubkey: 'mint-pubkey',
      version: '1.0.0',
      contact: [{ method: 'nostr', info: OPERATOR_PUBKEY }],
    },
    ...overrides,
  };
}

function seedCatalogCaches() {
  const store = useMintMetadataStore.getState();
  store.setAudit(
    MINT_URL,
    auditData() as unknown as AuditMintResponse,
    auditData().info as unknown as GetInfoResponse
  );
  // Only the aggregate is cached now — the row count, not the rows.
  store.setReviewsAggregate(MINT_URL, 4.2, 2);
  store.setSocial(MINT_URL, 123, 88);
}

describe('getMintCatalog cache-first behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useMintMetadataStore.setState({ byMintUrl: {} });
  });

  it('returns cached catalog fields without network calls in cache-only mode', async () => {
    seedCatalogCaches();
    const getMintInfo = jest.fn();

    const catalog = await getMintCatalog([MINT_URL], getMintInfo, {
      networkMode: 'cache-only',
    });

    expect(catalog[MINT_URL]).toMatchObject({
      auditScore: 2.5,
      auditState: 'OK',
      auditTotalOps: 15,
      kymScore: 4.2,
      reviewCount: 2,
      contactFollowers: 123,
      contactReputation: 88,
    });
    expect(auditMint).not.toHaveBeenCalled();
    expect(reviewMint).not.toHaveBeenCalled();
    expect(fetchNostrProfile).not.toHaveBeenCalled();
    expect(getMintInfo).not.toHaveBeenCalled();
  });

  it('falls back to cached fields when network refresh fails', async () => {
    seedCatalogCaches();
    (auditMint as jest.Mock).mockRejectedValue(new Error('offline'));
    (reviewMint as jest.Mock).mockRejectedValue(new Error('offline'));
    const getMintInfo = jest.fn().mockRejectedValue(new Error('offline'));

    const catalog = await getMintCatalog([MINT_URL], getMintInfo, {
      networkMode: 'network-first',
    });

    expect(catalog[MINT_URL]).toMatchObject({
      auditState: 'OK',
      kymScore: 4.2,
      contactFollowers: 123,
    });
  });

  it('writes fresh network data through the existing source caches', async () => {
    (auditMint as jest.Mock).mockResolvedValue(ok(auditData()));
    (reviewMint as jest.Mock).mockResolvedValue(
      ok({
        score: 3.7,
        recommendations: [{ score: 4, comment: 'recommended' }],
      })
    );
    (fetchNostrProfile as jest.Mock).mockResolvedValue(ok({ followers: 55, score: 77 }));
    const getMintInfo = jest.fn();

    const catalog = await getMintCatalog([MINT_URL], getMintInfo, {
      networkMode: 'network-first',
    });

    expect(catalog[MINT_URL]).toMatchObject({
      auditState: 'OK',
      kymScore: 3.7,
      reviewCount: 1,
      contactFollowers: 55,
      contactReputation: 77,
    });
    expect(useMintMetadataStore.getState().getCached(MINT_URL)?.auditData?.state).toBe('OK');
    expect(useMintMetadataStore.getState().getCached(MINT_URL)?.averageScore).toBe(3.7);
    expect(useMintMetadataStore.getState().getCached(MINT_URL)?.contactFollowers).toBe(55);
    expect(getMintInfo).not.toHaveBeenCalled();
  });

  it('overwrites a stale cached entry when the fresh review score is null (audit F3)', async () => {
    // Populated device: an old snapshot with a score is cached…
    seedCatalogCaches();
    expect(useMintMetadataStore.getState().getCached(MINT_URL)?.averageScore).toBe(4.2);

    // …then the live mint's reviews lose their score (e.g. all current reviews
    // are score-less endorsements). The fresh result MUST replace the snapshot.
    (auditMint as jest.Mock).mockResolvedValue(ok(auditData()));
    (reviewMint as jest.Mock).mockResolvedValue(
      ok({
        score: null,
        recommendations: [{ score: null, comment: 'still recommend it' }],
      })
    );
    (fetchNostrProfile as jest.Mock).mockResolvedValue(ok({ followers: 55, score: null }));

    await getMintCatalog([MINT_URL], jest.fn(), { networkMode: 'network-first' });

    const cached = useMintMetadataStore.getState().getCached(MINT_URL);
    expect(cached?.averageScore).toBeNull(); // not the stale 4.2
    // Rows are no longer persisted — only the fresh aggregate count survives.
    expect(cached?.reviewCount).toBe(1);
  });

  it('keeps operator followers when Vertex reputation is null', async () => {
    (auditMint as jest.Mock).mockResolvedValue(ok(auditData()));
    (fetchNostrProfile as jest.Mock).mockResolvedValue(ok({ followers: 55, score: null }));
    const getMintInfo = jest.fn();

    const catalog = await getMintCatalog([MINT_URL], getMintInfo, {
      networkMode: 'network-first',
    });

    expect(catalog[MINT_URL]).toMatchObject({
      auditState: 'OK',
      contactFollowers: 55,
    });
    expect(catalog[MINT_URL]).not.toHaveProperty('contactReputation');
    expect(useMintMetadataStore.getState().getCached(MINT_URL)?.contactReputation).toBeNull();
  });
});
