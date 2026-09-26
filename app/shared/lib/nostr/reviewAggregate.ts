import type { MintReviewsResponse } from '@/shared/lib/apiClient';
/**
 * The review total a response stands for, and whether it may replace a stored
 * aggregate. The facade's first paint is whichever tier answered first with one
 * review — often a relay's bounded `#u` scan — and its count is a lower bound,
 * not the mint's total. Persisting it over nagg's aggregate is how Minibits
 * showed "1 review" on one selector open and ~90 on the next. nagg's answer
 * always overwrites (including a count that genuinely fell); a fallback tier
 * only fills a mint nothing has counted yet.
 */
export function reviewAggregateOf(
  response: MintReviewsResponse,
  storedCount: number | undefined
): { score: number | null; reviewCount: number; authoritative: boolean } {
  const reviewCount = response.reviewCount ?? response.recommendations.length;
  const authoritative = response.tier === 'nagg' || response.tier === undefined;
  return {
    score: response.score,
    reviewCount,
    authoritative: authoritative || storedCount === undefined,
  };
}
