import {
  discoverMintToSearchResult,
  discoveryMethodMatches,
} from '@/features/mint/hooks/useMintSearch';
import type { DiscoverMint } from '@/shared/lib/apiClient';

const base: DiscoverMint = {
  mintUrl: 'https://mint.example',
  name: 'Example Mint',
  iconUrl: 'https://i/x.png',
  description: 'a mint',
  supportedUnits: ['sat', 'usd'],
  // Raw NUT-06 capability map, as nagg passes it through from the auditor.
  nuts: {
    '4': {
      methods: [
        { method: 'bolt11', unit: 'sat' },
        { method: 'bolt12', unit: 'sat' },
        { method: 'bolt11', unit: 'usd' },
      ],
    },
    '5': { methods: [{ method: 'bolt11', unit: 'sat' }] },
    '7': { supported: true },
  },
  averageScore: 4.5,
  reviewCount: 12,
  favouriteCount: 3,
  hasAudit: true,
  state: 'OK',
  nMints: 100,
  nMelts: 40,
  nErrors: 2,
  operatorPubkey: 'a'.repeat(64),
  followers: 1234,
  vertexScore: 0.8,
};

describe('discoverMintToSearchResult', () => {
  it('maps a full discovery row to the screen MintSearchResult shape', () => {
    const r = discoverMintToSearchResult(base);
    expect(r).toMatchObject({
      url: 'https://mint.example',
      name: 'Example Mint',
      supported_units: ['sat', 'usd'],
      state: 'OK',
      n_mints: 100,
      n_melts: 40,
      n_errors: 2,
      review_score: 4.5, // inline, no per-mint fan-out
      review_count: 12,
      // Derived from nuts['4'].methods (deduped, order-preserving).
      supported_methods: ['bolt11', 'bolt12'],
      // Full (method, unit) pairs retained for unit-aware discovery filtering.
      supported_method_units: [
        { method: 'bolt11', unit: 'sat' },
        { method: 'bolt12', unit: 'sat' },
        { method: 'bolt11', unit: 'usd' },
      ],
    });
    // operator pubkey surfaced as a NUT-06 nostr contact for the profile path
    expect((r.info as { contact: { method: string; info: string }[] }).contact).toEqual([
      { method: 'nostr', info: 'a'.repeat(64) },
    ]);
    expect((r.info as { icon_url: string }).icon_url).toBe('https://i/x.png');
  });

  it('tolerates a Nostr-only row (no audit / operator)', () => {
    const r = discoverMintToSearchResult({
      mintUrl: 'https://m2',
      averageScore: null,
      reviewCount: 1,
    });
    expect(r).toMatchObject({
      url: 'https://m2',
      name: 'https://m2', // falls back to url
      supported_units: [],
      // No nuts map (auditor had no info) — the method filter treats this
      // as "not known to support".
      supported_methods: [],
      state: 'unknown',
      review_score: null,
      review_count: 1,
    });
    expect((r.info as { contact: unknown[] }).contact).toEqual([]);
  });
});

describe('discoveryMethodMatches — unit-aware (method, unit) pair filter', () => {
  const mint = (mintUrl: string, methods: { method: string; unit: string }[]) =>
    discoverMintToSearchResult({
      mintUrl,
      averageScore: null,
      reviewCount: 0,
      nuts: { '4': { methods } },
    });

  const satBolt12 = mint('https://sat', [{ method: 'bolt12', unit: 'sat' }]);
  const eurBolt12 = mint('https://eur', [{ method: 'bolt12', unit: 'eur' }]);

  it('excludes a bolt12+eur-only mint for a (bolt12, SAT) rail, keeps bolt12+sat', () => {
    expect(discoveryMethodMatches(satBolt12, 'bolt12', 'SAT')).toBe(true);
    expect(discoveryMethodMatches(eurBolt12, 'bolt12', 'SAT')).toBe(false);
  });

  it("currency 'ALL' falls back to method-only (browse every unit)", () => {
    expect(discoveryMethodMatches(eurBolt12, 'bolt12', 'ALL')).toBe(true);
  });

  it('no method filter leaves rows unfiltered', () => {
    expect(discoveryMethodMatches(eurBolt12, undefined, 'SAT')).toBe(true);
  });

  it('matches case-insensitively and rejects the wrong method on the right unit', () => {
    expect(discoveryMethodMatches(satBolt12, 'BOLT12', 'sat')).toBe(true);
    expect(discoveryMethodMatches(satBolt12, 'onchain', 'SAT')).toBe(false);
  });
});
