import { z } from 'zod';

// Development, preview, and production share one Nagg host. Override with
// EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL only for local development.
const DEFAULT_NOSTR_APPVIEW_BASE_URL = 'https://nagg.up.railway.app';
/**
 * Primal's PUBLIC cache servers (Primal operates them; we only connect). Tier 2
 * of the resilient Nostr data layer — the `nagg → Primal caches → raw relays`
 * fallback.
 *
 * A LIST, tried in order, because these hosts do not fail together: on
 * 2026-09-24 `cache2` refused every connection while `cache1` served normally,
 * which put every feed, thread and profile on the raw-relay floor. Exhausting
 * the list before falling through keeps one dead host from costing the whole
 * tier.
 *
 * Override with EXPO_PUBLIC_PRIMAL_CACHE_URL (comma-separated for several).
 */
const DEFAULT_PRIMAL_CACHE_URLS = ['wss://cache1.primal.net/v1', 'wss://cache2.primal.net/v1'];

/** A comma-separated override becomes the ordered host list; blank entries drop. */
function splitUrls(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const urls = value
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  return urls.length > 0 ? urls : undefined;
}

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const OptionalUrl = z
  .preprocess(emptyStringToUndefined, z.string().trim().url().optional())
  .transform((value) => (value ? stripTrailingSlashes(value) : undefined));

const BackendEnv = z.object({
  EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: OptionalUrl,
  EXPO_PUBLIC_NAGG_BASE_URL: OptionalUrl,
  EXPO_PUBLIC_SCORE_API_BASE_URL: OptionalUrl,
  EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT: OptionalUrl,
  // Primal public cache server (tier 2). Defaults to wss://cache2.primal.net/v1.
  EXPO_PUBLIC_PRIMAL_CACHE_URL: OptionalUrl,
});

type BackendEnvInput = Partial<Record<keyof z.input<typeof BackendEnv>, string | undefined>>;

type BackendConfig = {
  nostrAppViewBaseUrl: string;
  scoreApiBaseUrl: string;
  /**
   * nagg's GraphQL endpoint. The feed/thread/notifications/DM data layer is
   * app-view-only (no client GraphQL); this remains ONLY for integrations that
   * embed nagg's GraphQL via coco-core (mint enrichment, mint-operator Nostr
   * profiles) plus the recent-people-profiles lookup — none of which route
   * through nagg-ts. Pending their own migration to REST.
   */
  nostrGraphqlEndpoint: string;
  /** Primal public cache server URLs, tried in order (tier 2 of the data layer). */
  primalCacheUrls: readonly string[];
};

function readBackendEnv(): BackendEnvInput {
  return {
    EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL,
    EXPO_PUBLIC_NAGG_BASE_URL: process.env.EXPO_PUBLIC_NAGG_BASE_URL,
    EXPO_PUBLIC_SCORE_API_BASE_URL: process.env.EXPO_PUBLIC_SCORE_API_BASE_URL,
    EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT: process.env.EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT,
    EXPO_PUBLIC_PRIMAL_CACHE_URL: process.env.EXPO_PUBLIC_PRIMAL_CACHE_URL,
  };
}

export function parseBackendConfig(env: BackendEnvInput = readBackendEnv()): BackendConfig {
  const parsed = BackendEnv.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.code}`)
      .join('; ');
    throw new Error(`Invalid backend config: ${issues}`);
  }

  // nagg's REST app-view is the only Nostr transport: one fully bundled payload
  // per page (events + profiles + reliable single-query engagement stats). There
  // is no client-side GraphQL.
  const nostrAppViewBaseUrl =
    parsed.data.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL ??
    parsed.data.EXPO_PUBLIC_NAGG_BASE_URL ??
    DEFAULT_NOSTR_APPVIEW_BASE_URL;
  return {
    nostrAppViewBaseUrl,
    scoreApiBaseUrl: parsed.data.EXPO_PUBLIC_SCORE_API_BASE_URL ?? nostrAppViewBaseUrl,
    nostrGraphqlEndpoint:
      parsed.data.EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT ?? `${nostrAppViewBaseUrl}/graphql`,
    primalCacheUrls:
      splitUrls(parsed.data.EXPO_PUBLIC_PRIMAL_CACHE_URL) ?? DEFAULT_PRIMAL_CACHE_URLS,
  };
}

export const backendConfig = parseBackendConfig();
