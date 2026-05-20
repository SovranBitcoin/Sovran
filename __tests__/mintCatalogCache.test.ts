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
import type { AuditMintResponse, MintRecommendation } from '@/shared/lib/apiClient';
import { auditMint, fetchNostrProfile, reviewMint } from '@/shared/lib/apiClient';
import { useAuditMintStore } from '@/shared/stores/global/auditMintStore';
import { useKYMMintStore } from '@/shared/stores/global/kymMintStore';
import { useMintProfileStore } from '@/shared/stores/global/mintProfileStore';

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
  useAuditMintStore
    .getState()
    .setCached(
      MINT_URL,
      auditData() as unknown as AuditMintResponse,
      auditData().info as unknown as GetInfoResponse
    );
  useKYMMintStore.getState().setCached(MINT_URL, 4.2, [
    { score: 4, comment: 'solid' },
    { score: 5, comment: 'fast' },
  ] as unknown as MintRecommendation[]);
  useMintProfileStore.getState().setCached(MINT_URL, 123, 88);
}

describe('getMintCatalog cache-first behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuditMintStore.getState().clearCache();
    useKYMMintStore.getState().clearCache();
    useMintProfileStore.setState({ cache: {} });
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
    expect(useAuditMintStore.getState().getCached(MINT_URL)?.auditData.state).toBe('OK');
    expect(useKYMMintStore.getState().getCached(MINT_URL)?.score).toBe(3.7);
    expect(useMintProfileStore.getState().getCached(MINT_URL)?.followers).toBe(55);
    expect(getMintInfo).not.toHaveBeenCalled();
  });
});
