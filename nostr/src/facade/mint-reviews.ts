import { z } from 'zod';
import type { NostrTier } from '@sovranbitcoin/schemas';
import type { NaggFeedEvent } from '../map/feed';
import type { RequestControls } from '../timeout';
import type { TierOutcome } from '../tiers';

// ---------------------------------------------------------------------------
// Mint-favourites surface — NIP-87 cashu mint reviews
//
// The "mint favourite" surface is NIP-87 reviews: kind 38000 with tags
// k=38172 (this review is about a cashu mint), u=<mintUrl>, and a free-text
// `content` carrying the community `[n/5]` score convention. This collapses the
// two existing read paths (colada GraphQL + a raw-NDK discovery hook) behind one
// tiered API: getMintReviews(mintUrl) and discoverMints().
//
// Anti-spam: ONE latest review per reviewer (per-pubkey dedupe) before
// averaging, so a single spammer can't skew a mint's score.
// ---------------------------------------------------------------------------

export const MINT_REVIEW_KIND = 38_000;
/** The `k` tag value marking a review as being about a cashu mint (vs fedimint 38173). */
export const CASHU_MINT_K = '38172';

export type MintReview = {
  eventId: string;
  reviewerPubkey: string;
  mintUrl: string;
  /** Parsed `[n/5]` score clamped to 0..5, or null when the review has no score. */
  score: number | null;
  content: string;
  createdAt: number;
  /** Reviewer kind-0 identity, bundled by nagg's profiles map (nagg tier only). */
  name?: string;
  picture?: string;
};

export type MintReviewsSummary = {
  mintUrl: string;
  averageScore: number | null;
  reviewCount: number;
  /** Reviews posted WITHOUT a score (pure endorsements); 0 when the serving
   *  nagg predates the field. */
  favouriteCount: number;
  reviews: MintReview[];
};

/**
 * A discovered mint card. The nagg tier fills the full shape (audit state,
 * supported units, operator Nostr identity + Vertex reputation, favourite vs
 * scored split); the relay/Primal fallback can only supply the review-derived
 * fields, so audit/social fields are optional.
 */
export type DiscoveredMint = {
  mintUrl: string;
  averageScore: number | null;
  reviewCount: number;
  /** NIP-87 recommendations posted WITHOUT a [n/5] score. */
  favouriteCount: number;
  // --- nagg-tier enrichment (optional; absent on the relay fallback) ---
  name?: string;
  iconUrl?: string;
  description?: string;
  supportedUnits?: string[];
  /**
   * The mint's NUT-06 `nuts` capability map, verbatim from the mint's
   * /v1/info (via nagg's auditor feed). Read whichever NUT entries you need
   * (e.g. nuts['4'].methods payment methods, nuts['7'] state check,
   * nuts['10']/nuts['11'] P2PK, nuts['17'] websockets) — deliberately
   * untyped so new capabilities need no client release.
   */
  nuts?: Record<string, unknown>;
  hasAudit?: boolean;
  state?: string;
  nMints?: number;
  nMelts?: number;
  nErrors?: number;
  operatorPubkey?: string;
  operatorNpub?: string;
  operatorName?: string;
  operatorPicture?: string;
  followers?: number;
  follows?: number;
  vertexRank?: number;
  vertexScore?: number | null;
};

export type MintReviewsRequest = RequestControls & {
  mintUrl: string;
  limit?: number;
  refresh?: boolean;
};

export type DiscoverMintsRequest = RequestControls & {
  limit?: number;
  /** Restrict to a web-of-trust author set (NIP-87 spam resistance). */
  authors?: string[];
  refresh?: boolean;
};

export type ResolvedMintReviews = { tier: NostrTier } & MintReviewsSummary;
export type ResolvedDiscoveredMints = { tier: NostrTier; mints: DiscoveredMint[] };

export interface MintReviewsTier {
  readonly tier: NostrTier;
  getMintReviews(request: MintReviewsRequest): Promise<TierOutcome<MintReviewsSummary>>;
  discoverMints(request: DiscoverMintsRequest): Promise<TierOutcome<DiscoveredMint[]>>;
}

// The nagg server-side aggregate response (`GroupBy:["u"]` over kind 38000).
const MintAggregateSchema = z.object({
  mintUrl: z.string(),
  averageScore: z.number().nullable(),
  reviewCount: z.number(),
  /** Reviews posted WITHOUT a score (pure endorsements). Optional until every
   *  deployed nagg ships it; mirrors the discover row's field. */
  favouriteCount: z.number().optional(),
});

// Bundled kind-0 identity (reviewer or operator), keyed by pubkey.
const ProfileInfoSchema = z
  .object({ name: z.string().optional(), picture: z.string().optional() })
  .passthrough();

const MintReviewItemSchema = z.object({
  eventId: z.string(),
  reviewerPubkey: z.string(),
  mintUrl: z.string(),
  score: z.number().nullable(),
  content: z.string(),
  createdAt: z.number(),
});

export const MintReviewsResponseSchema = z.object({
  summary: MintAggregateSchema,
  reviews: z.array(MintReviewItemSchema).optional(),
  profiles: z.record(z.string(), ProfileInfoSchema).optional(),
});

// The nagg rich discovery row (per-mint card data merged from auditor + Nostr).
const DiscoverMintSchema = z.object({
  mintUrl: z.string(),
  name: z.string().optional(),
  iconUrl: z.string().optional(),
  description: z.string().optional(),
  supportedUnits: z.array(z.string()).optional(),
  nuts: z.record(z.string(), z.unknown()).optional(),
  averageScore: z.number().nullable(),
  reviewCount: z.number(),
  favouriteCount: z.number().optional(),
  hasAudit: z.boolean().optional(),
  state: z.string().optional(),
  nMints: z.number().optional(),
  nMelts: z.number().optional(),
  nErrors: z.number().optional(),
  operatorPubkey: z.string().optional(),
  operatorNpub: z.string().optional(),
  followers: z.number().optional(),
  follows: z.number().optional(),
  vertexRank: z.number().optional(),
  vertexScore: z.number().nullable().optional(),
});

export const DiscoverMintsResponseSchema = z.object({
  mints: z.array(DiscoverMintSchema),
  profiles: z.record(z.string(), ProfileInfoSchema).optional(),
});

// --- NIP-87 parsing ---------------------------------------------------------

const SCORE_RE = /\[(\d+(?:\.\d+)?)\/5\]/;

function tagValue(tags: string[][], key: string): string | undefined {
  return tags.find((t) => t[0] === key && typeof t[1] === 'string')?.[1];
}

/** Strip a single trailing slash so `https://m/` and `https://m` compare equal. */
export function normalizeMintUrl(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

function parseScore(content: string): number | null {
  const m = SCORE_RE.exec(content);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(5, n));
}

/** Parse a kind-38000 event into a MintReview, or null if it isn't a cashu mint review. */
export function parseReviewEvent(event: NaggFeedEvent): MintReview | null {
  if (event.kind !== MINT_REVIEW_KIND) return null;
  if (tagValue(event.tags, 'k') !== CASHU_MINT_K) return null;
  const mintUrl = tagValue(event.tags, 'u');
  if (!mintUrl) return null;
  return {
    eventId: event.id,
    reviewerPubkey: event.pubkey,
    mintUrl,
    score: parseScore(event.content),
    content: event.content,
    createdAt: event.created_at,
  };
}

/** Keep only the latest review per reviewer (anti-spam, NIP-87 `withoutSameAuthor`). */
export function dedupeByReviewer(reviews: ReadonlyArray<MintReview>): MintReview[] {
  const byPubkey = new Map<string, MintReview>();
  for (const review of reviews) {
    const existing = byPubkey.get(review.reviewerPubkey);
    if (!existing || review.createdAt > existing.createdAt) byPubkey.set(review.reviewerPubkey, review);
  }
  return [...byPubkey.values()];
}

function averageOf(reviews: ReadonlyArray<MintReview>): number | null {
  const scored = reviews.filter((r) => r.score != null);
  if (scored.length === 0) return null;
  return scored.reduce((sum, r) => sum + (r.score as number), 0) / scored.length;
}

/** Summarize raw review events for one mint: dedupe by reviewer, average, newest-first. */
export function summarizeReviews(mintUrl: string, events: ReadonlyArray<NaggFeedEvent>): MintReviewsSummary {
  const target = normalizeMintUrl(mintUrl);
  const reviews = dedupeByReviewer(
    events
      .map(parseReviewEvent)
      .filter((r): r is MintReview => r !== null && normalizeMintUrl(r.mintUrl) === target),
  ).sort((a, b) => b.createdAt - a.createdAt);

  return {
    mintUrl,
    averageScore: averageOf(reviews),
    reviewCount: reviews.length,
    favouriteCount: reviews.filter((r) => r.score == null).length,
    reviews,
  };
}

/** Group review events by mint for discovery: per-mint average + count, best-attested first. */
export function discoverFromReviews(events: ReadonlyArray<NaggFeedEvent>): DiscoveredMint[] {
  const byMint = new Map<string, MintReview[]>();
  for (const review of events.map(parseReviewEvent)) {
    if (!review) continue;
    const key = normalizeMintUrl(review.mintUrl);
    const list = byMint.get(key) ?? [];
    list.push(review);
    byMint.set(key, list);
  }

  const mints: DiscoveredMint[] = [];
  for (const [, list] of byMint) {
    const deduped = dedupeByReviewer(list);
    mints.push({
      mintUrl: deduped[0]?.mintUrl ?? list[0].mintUrl,
      averageScore: averageOf(deduped),
      reviewCount: deduped.length,
      favouriteCount: deduped.filter((r) => r.score == null).length,
    });
  }
  // Most-reviewed first, then highest average — surface well-attested mints.
  return mints.sort((a, b) => b.reviewCount - a.reviewCount || (b.averageScore ?? 0) - (a.averageScore ?? 0));
}
