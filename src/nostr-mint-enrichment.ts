import { createNaggClient, type NaggError } from '@sovranbitcoin/nagg-ts';
import { z } from 'zod';
import { errField, logger, mintUrlFields } from './logger';
import type { RequestControls } from './safeFetch';
import type {
  MintContactProfile,
  MintReviewRecommendation,
  MintReviewsSummary,
} from './types';

export interface NostrMintEnrichmentConfig {
  /** REST app-view base URL, e.g. `https://nagg.up.railway.app`. */
  appViewBaseUrl: string;
  /** Route version prefix: `''` → `/nostr/*`, `'v1'` → `/v1/nostr/*`. Default `'v1'`. */
  appViewVersion?: '' | 'v1';
  reviewLimit?: number;
  timeoutMs?: number;
}

export interface NostrMintEnrichment {
  resolveMintContactProfile: (
    pubkey: string,
    mintUrl: string,
    controls?: RequestControls,
  ) => Promise<MintContactProfile | undefined>;
  fetchMintReviews: (
    mintUrl: string,
    controls?: RequestControls,
  ) => Promise<MintReviewsSummary | undefined>;
}

// nagg's `/nostr/profile` returns FULL kind-0 metadata, already parsed. We only
// consume the display fields the mint UI shows; everything else is tolerated.
const ProfileResponse = z
  .object({
    pubkey: z.string().optional(),
    npub: z.string().optional(),
    name: z.string().max(256).optional(),
    displayName: z.string().max(256).optional(),
    picture: z.string().max(2048).optional(),
    image: z.string().max(2048).optional(),
  })
  .passthrough();

// nagg's `/nostr/mint/reviews` aggregate: a server-side per-mint summary
// (average + count over the full review set) plus the individual NIP-87
// kind-38000 reviews. The summary average is computed over every review nagg
// holds, not just this page.
const MintReviewItem = z.object({
  eventId: z.string(),
  reviewerPubkey: z.string(),
  mintUrl: z.string(),
  score: z.number().nullable(),
  content: z.string(),
  createdAt: z.number(),
});

const MintReviewsResponse = z.object({
  summary: z.object({
    mintUrl: z.string(),
    averageScore: z.number().nullable(),
    reviewCount: z.number(),
  }),
  reviews: z.array(MintReviewItem).optional(),
});

function summarizeControls(controls: RequestControls): Record<string, unknown> {
  return {
    hasSignal: !!controls.signal,
    signalAborted: controls.signal?.aborted === true,
    timeoutMs: controls.timeoutMs ?? null,
  };
}

export function createNostrMintEnrichment(
  config: NostrMintEnrichmentConfig,
): NostrMintEnrichment {
  const baseUrl = config.appViewBaseUrl.trim();
  const version = config.appViewVersion ?? 'v1';
  const reviewLimit = Math.max(1, Math.min(config.reviewLimit ?? 100, 500));
  logger.info('nostrMint.create', {
    baseUrlLength: baseUrl.length,
    version,
    requestedReviewLimit: config.reviewLimit ?? null,
    reviewLimit,
    timeoutMs: config.timeoutMs ?? null,
  });
  const client = createNaggClient({
    appView: { baseUrl, version },
    defaultTimeoutMs: config.timeoutMs,
  });

  return {
    resolveMintContactProfile: async (pubkey, _mintUrl, controls = {}) => {
      const effectiveControls = {
        ...controls,
        timeoutMs: controls.timeoutMs ?? config.timeoutMs,
      };
      logger.info('nostrMint.contactProfile.start', {
        pubkeyLength: pubkey.length,
        ...mintUrlFields(_mintUrl),
        ...summarizeControls(effectiveControls),
      });
      const result = await client.rest({
        path: '/nostr/profile',
        method: 'GET',
        searchParams: { pubkey },
        responseSchema: ProfileResponse,
        operationName: 'MintContactProfile',
        signal: effectiveControls.signal,
        timeoutMs: effectiveControls.timeoutMs,
      });
      if (result.isErr()) {
        logger.warn('nostrMint.contactProfile.failed', {
          pubkeyLength: pubkey.length,
          ...mintUrlFields(_mintUrl),
          error: errField(errorFromNaggError(result.error)),
        });
        throw errorFromNaggError(result.error);
      }
      const profile = result.value;
      const fields = profileFields(profile);
      const hasProfile = Object.keys(fields).length > 0;
      logger.info('nostrMint.contactProfile.result', {
        pubkeyLength: pubkey.length,
        ...mintUrlFields(_mintUrl),
        hasProfile,
        hasName: !!profile.name,
        hasDisplayName: !!profile.displayName,
        hasPicture: !!profile.picture || !!profile.image,
      });
      if (!hasProfile) return undefined;
      return {
        pubkey,
        ...(profile.npub ? { npub: profile.npub } : {}),
        ...fields,
      };
    },

    fetchMintReviews: async (mintUrl, controls = {}) => {
      const effectiveControls = {
        ...controls,
        timeoutMs: controls.timeoutMs ?? config.timeoutMs,
      };
      logger.info('nostrMint.mintReviews.start', {
        ...mintUrlFields(mintUrl),
        reviewLimit,
        ...summarizeControls(effectiveControls),
      });
      const result = await client.rest({
        path: '/nostr/mint/reviews',
        method: 'GET',
        searchParams: { u: mintUrl, limit: reviewLimit },
        responseSchema: MintReviewsResponse,
        operationName: 'MintReviews',
        signal: effectiveControls.signal,
        timeoutMs: effectiveControls.timeoutMs,
      });
      if (result.isErr()) {
        logger.warn('nostrMint.mintReviews.failed', {
          ...mintUrlFields(mintUrl),
          error: errField(errorFromNaggError(result.error)),
        });
        throw errorFromNaggError(result.error);
      }
      const data = result.value;
      const recommendations = (data.reviews ?? [])
        .map(reviewFromItem)
        .filter((review): review is MintReviewRecommendation => review !== null)
        .sort((a, b) => b.created_at - a.created_at);
      const lastUpdated =
        recommendations.length > 0
          ? Math.max(...recommendations.map((review) => review.created_at))
          : null;

      logger.info('nostrMint.mintReviews.result', {
        ...mintUrlFields(mintUrl),
        reviewCount: data.summary.reviewCount,
        returnedReviews: data.reviews?.length ?? 0,
        recommendationCount: recommendations.length,
        score: data.summary.averageScore,
        lastUpdated,
      });

      return {
        mintUrl: data.summary.mintUrl,
        score: data.summary.averageScore,
        recommendations,
        lastUpdated,
        fromCache: true,
      };
    },
  };
}

function errorFromNaggError(error: NaggError): Error {
  const out = new Error(error.message);
  out.name =
    error.type === 'network' && /abort|timed out|timeout/i.test(error.message)
      ? 'AbortError'
      : 'NaggAppViewError';
  return out;
}

function profileFields(profile: {
  name?: string;
  displayName?: string;
  picture?: string;
  image?: string;
}) {
  return {
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.picture ? { picture: profile.picture } : {}),
    ...(profile.image ? { image: profile.image } : {}),
  };
}

function reviewFromItem(
  item: z.infer<typeof MintReviewItem>,
): MintReviewRecommendation | null {
  const parsed = parseMintReviewContent(item.content);
  if (!parsed) {
    logger.debug('nostrMint.review.skipped', {
      eventIdPresent: item.eventId.length > 0,
      pubkeyLength: item.reviewerPubkey.length,
      reason: 'no_score_marker',
      contentLength: item.content.length,
    });
    return null;
  }
  return {
    score: parsed.score,
    comment: parsed.comment,
    pubkey: item.reviewerPubkey,
    eventId: item.eventId,
    created_at: item.createdAt,
  };
}

function parseMintReviewContent(
  raw: string,
): { score: number; comment: string } | null {
  const match = raw.match(/^\s*\[(\d+)\/(\d+)\]\s*(.*)$/);
  if (!match) return null;
  const score = Number.parseInt(match[1] ?? '', 10);
  const outOf = Number.parseInt(match[2] ?? '', 10);
  if (!Number.isFinite(score) || score < 0 || score > 5 || outOf !== 5)
    return null;
  return { score, comment: match[3]?.trim() ?? '' };
}
