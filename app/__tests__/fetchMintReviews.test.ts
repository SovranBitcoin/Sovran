import { ok } from 'neverthrow';
import { fetchMintReviews } from '@/shared/lib/nostr/fetchMintReviews';

const mockGetMintReviews = jest.fn();

jest.mock('@/shared/lib/apiClient', () => ({ reviewMint: jest.fn() }));
jest.mock('@/shared/lib/nostr/buildNostrDataLayer', () => ({
  buildNostrDataLayer: () => ({ getMintReviews: mockGetMintReviews }),
}));

const MINT = 'https://mint.example.com';
const facadeReview = (eventId: string, content: string, score: number | null) => ({
  eventId,
  reviewerPubkey: 'a'.repeat(64),
  mintUrl: MINT,
  score,
  content,
  createdAt: 1789070400,
});

it('strips the NIP-87 [n/5] score marker from facade review content', async () => {
  mockGetMintReviews.mockResolvedValue(
    ok({
      tier: 'nagg',
      mintUrl: MINT,
      averageScore: 4.25,
      reviewCount: 4,
      reviews: [
        facadeReview('1', '[5/5] Fast and reliable', 5),
        facadeReview('2', 'Solid mint [3.5/5]', 3.5),
        facadeReview('3', '[4/5]', 4),
        facadeReview('4', 'No score here', null),
      ],
    })
  );
  const result = await fetchMintReviews({ mintUrl: MINT });
  expect(result._unsafeUnwrap().recommendations.map((r) => r.comment)).toEqual([
    'Fast and reliable',
    'Solid mint',
    '',
    'No score here',
  ]);
});
