import { createNaggClient, type NaggError } from 'nostr';
import { z } from 'zod';
import { errField, logger, mintUrlFields } from './logger';
import type { RequestControls } from './safeFetch';
import type {
  MintContactProfile,
  MintReviewRecommendation,
  MintReviewsSummary,
} from './types';

export interface NostrMintEnrichmentConfig {
  /** REST app-view base URL for the `/nostr/mint/*` routes. */
  appViewBaseUrl: string;
  /**
   * Host for `/nostr/profile`, which resolves the mint operator's Nostr
   * identity. Defaults to `appViewBaseUrl`.
   *
   * It is separable because the two routes can live on different deployments.
   * A nagg running `NAGG_MODULES=mint` serves the mint routes off a tiny
   * ClickHouse but does NOT mount `/nostr/profile` — that route reads
   * `pubkey_stats` and the follower graph, which belong to the `nostr` module —
   * so pointing the whole client at a mint-only host 404s every operator
   * profile lookup.
   */
  profileBaseUrl?: string;
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

// nagg bundles each reviewer's kind-0 (name/picture) in a profiles map keyed by
// pubkey, exactly like the feed responses, so the client renders reviewer
// identity without a second round-trip per reviewer.
const ReviewerProfile = z
  .object({
    name: z.string().max(256).optional(),
    picture: z.string().max(2048).optional(),
  })
  .passthrough();

const MintReviewsResponse = z.object({
  summary: z.object({
    mintUrl: z.string(),
    averageScore: z.number().nullable(),
    reviewCount: z.number(),
  }),
  reviews: z.array(MintReviewItem).optional(),
  profiles: z.record(z.string(), ReviewerProfile).optional(),
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
  const profileBaseUrl = (config.profileBaseUrl ?? config.appViewBaseUrl).trim();
  const version = config.appViewVersion ?? 'v1';
  const reviewLimit = Math.max(1, Math.min(config.reviewLimit ?? 100, 500));
  logger.info('nostrMint.create', {
    baseUrlLength: baseUrl.length,
    profileBaseUrlLength: profileBaseUrl.length,
    splitHosts: profileBaseUrl !== baseUrl,
    version,
    requestedReviewLimit: config.reviewLimit ?? null,
    reviewLimit,
    timeoutMs: config.timeoutMs ?? null,
  });
  const client = createNaggClient({
    appView: { baseUrl, version },
    defaultTimeoutMs: config.timeoutMs,
  });
  // Same client when the hosts match, so the common case keeps one connection
  // pool and one set of defaults.
  const profileClient =
    profileBaseUrl === baseUrl
      ? client
      : createNaggClient({
          appView: { baseUrl: profileBaseUrl, version },
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
      const result = await profileClient.rest({
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
      const profiles = data.profiles ?? {};
      // Trust nagg's server-side parse + dedupe: keep every returned review
      // (scored or score-less), use the server score verbatim, and attach the
      // bundled reviewer identity. This keeps the list 1:1 with summary.reviewCount
      // instead of re-filtering with a stricter regex (the old new-device vs API
      // discrepancy).
      const recommendations = (data.reviews ?? [])
        .map((item) => reviewFromItem(item, profiles[item.reviewerPubkey]))
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
        profileCount: Object.keys(profiles).length,
        score: data.summary.averageScore,
        lastUpdated,
      });

      return {
        mintUrl: data.summary.mintUrl,
        score: clampScore(data.summary.averageScore),
        // Authoritative full-set count from the server, not the page length.
        reviewCount: data.summary.reviewCount,
        recommendations,
        lastUpdated,
        // This is a fresh network fetch; nagg's own response cache is opaque to
        // us, so report not-from-our-cache rather than hardcoding true.
        fromCache: false,
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
  profile?: z.infer<typeof ReviewerProfile>,
): MintReviewRecommendation {
  return {
    score: clampScore(item.score),
    comment: stripScoreMarker(item.content),
    pubkey: item.reviewerPubkey,
    eventId: item.eventId,
    created_at: item.createdAt,
    ...(profile?.name ? { name: profile.name } : {}),
    ...(profile?.picture ? { picture: profile.picture } : {}),
  };
}

// "Trust nagg's parse" still keeps one guard at the network boundary: a score
// is a 0–5 rating, so clamp anything outside that range (a server bug or a
// malformed upstream event must never render a 42/5 mint). `null` = unscored.
function clampScore(score: number | null): number | null {
  if (score === null) return null;
  return Math.min(5, Math.max(0, score));
}

// nagg keeps the [n/5] marker in the review content; strip the first occurrence
// so the comment shown to the user is just their prose. Mirrors nagg's score
// regex (decimals allowed, marker anywhere) rather than the old strict form.
const SCORE_MARKER = /\[\d+(?:\.\d+)?\/5\]/;
function stripScoreMarker(content: string): string {
  return content.replace(SCORE_MARKER, '').trim();
}
