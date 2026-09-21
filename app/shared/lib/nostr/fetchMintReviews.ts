import type { facade } from 'nostr';
import { err, ok, type Result } from 'neverthrow';

import { reviewMint, type MintReviewsResponse } from '@/shared/lib/apiClient';
import { buildNostrDataLayer } from '@/shared/lib/nostr/buildNostrDataLayer';

// NIP-87 content carries the `[n/5]` score inline; the score is already parsed
// out, so `comment` is just the reviewer's prose (matches the wallet REST path).
const SCORE_MARKER = /\[\d+(?:\.\d+)?\/5\]/;
function stripScoreMarker(content: string): string {
  return content.replace(SCORE_MARKER, '').trim();
}

/** Facade answer → the app's review response (the wallet's summary shape). */
function reviewsFromFacade(resolved: facade.ResolvedMintReviews): MintReviewsResponse {
  return {
    mintUrl: resolved.mintUrl,
    score: resolved.averageScore,
    recommendations: resolved.reviews.map((review) => ({
      score: review.score,
      comment: stripScoreMarker(review.content),
      pubkey: review.reviewerPubkey,
      eventId: review.eventId,
      created_at: review.createdAtSec,
      ...(review.name ? { name: review.name } : {}),
      ...(review.picture ? { picture: review.picture } : {}),
    })),
    lastUpdated: null,
    fromCache: false,
    tier: resolved.tier,
    // A fallback tier carries no reviewer identities (names fall back to the
    // entity cache) — and a nagg answer with a failed sibling is still marked.
    degraded: resolved.tier !== 'nagg' || resolved.provenance?.degraded === true,
  };
}

/**
 * Reviews for one mint: the tiered facade (nagg app-view + relay NIP-87
 * fan-out, merged by event id, first paint at the aggregate gate) when the
 * data layer is available, else nagg's REST app-view directly. Both land on
 * the same response shape. Never throws; every failure is an `err`.
 */
export async function fetchMintReviews(args: {
  mintUrl: string;
  signal?: AbortSignal;
  readId?: string;
}): Promise<Result<MintReviewsResponse, Error>> {
  const layer = buildNostrDataLayer();
  if (!layer) return reviewMint({ mintUrl: args.mintUrl, signal: args.signal });
  try {
    const resolved = await layer.getMintReviews({
      mintUrl: args.mintUrl,
      ...(args.signal ? { signal: args.signal } : {}),
      ...(args.readId ? { readId: args.readId } : {}),
    });
    return resolved.match(
      (value) => ok(reviewsFromFacade(value)),
      (error) => err(new Error(`mint reviews: ${error.type}`, { cause: error }))
    );
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
