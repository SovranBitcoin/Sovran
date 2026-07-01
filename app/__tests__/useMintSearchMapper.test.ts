import { discoverMintToSearchResult } from '@/features/mint/hooks/useMintSearch';
import type { DiscoverMint } from '@/shared/lib/apiClient';

const base: DiscoverMint = {
  mintUrl: 'https://mint.example',
  name: 'Example Mint',
  iconUrl: 'https://i/x.png',
  description: 'a mint',
  supportedUnits: ['sat', 'usd'],
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
      state: 'unknown',
      review_score: null,
      review_count: 1,
    });
    expect((r.info as { contact: unknown[] }).contact).toEqual([]);
  });
});
