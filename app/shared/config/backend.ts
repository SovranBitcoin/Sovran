import { z } from 'zod';

// The v2 stack: this branch's vendored nostr/ package speaks the v2 generic
// envelope, so the code-coupled default must be the v2 deployment. Release
// profiles override via eas.json env until the production cutover.
const DEFAULT_NOSTR_APPVIEW_BASE_URL = 'https://nagg-mint-production.up.railway.app';
const DEFAULT_API_BASE_URL = 'https://api.sovran.money/api';
/**
 * Primal's PUBLIC cache server (Primal operates it; we only connect). Tier 2 of
 * the resilient Nostr data layer — the `nagg → Primal cache → raw relays`
 * fallback. Override via EXPO_PUBLIC_PRIMAL_CACHE_URL for a different instance.
 */
const DEFAULT_PRIMAL_CACHE_URL = 'wss://cache2.primal.net/v1';

const emptyStringToUndefined = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const stripTrailingSlashes = (value: string) => value.replace(/\/+$/, '');

const RequiredUrl = (fallback: string) =>
  z
    .preprocess(emptyStringToUndefined, z.string().trim().url().default(fallback))
    .transform(stripTrailingSlashes);

const OptionalUrl = z
  .preprocess(emptyStringToUndefined, z.string().trim().url().optional())
  .transform((value) => (value ? stripTrailingSlashes(value) : undefined));

const BackendEnv = z.object({
  EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: OptionalUrl,
  EXPO_PUBLIC_NAGG_BASE_URL: OptionalUrl,
  EXPO_PUBLIC_API_BASE_URL: RequiredUrl(DEFAULT_API_BASE_URL),
  EXPO_PUBLIC_SCORE_API_BASE_URL: OptionalUrl,
  EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT: OptionalUrl,
  // Primal public cache server (tier 2). Defaults to wss://cache2.primal.net/v1.
  EXPO_PUBLIC_PRIMAL_CACHE_URL: OptionalUrl,
});

type BackendEnvInput = Partial<Record<keyof z.input<typeof BackendEnv>, string | undefined>>;

type BackendConfig = {
  nostrAppViewBaseUrl: string;
  apiBaseUrl: string;
  scoreApiBaseUrl: string;
  /**
   * nagg's GraphQL endpoint. The feed/thread/notifications/DM data layer is
   * app-view-only (no client GraphQL); this remains ONLY for integrations that
   * embed nagg's GraphQL via coco-core (mint enrichment, mint-operator Nostr
   * profiles) plus the recent-people-profiles lookup — none of which route
   * through nagg-ts. Pending their own migration to REST.
   */
  nostrGraphqlEndpoint: string;
  /** Primal public cache server URL (tier 2 of the Nostr data layer). */
  primalCacheUrl: string;
};

function readBackendEnv(): BackendEnvInput {
  return {
    EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL,
    EXPO_PUBLIC_NAGG_BASE_URL: process.env.EXPO_PUBLIC_NAGG_BASE_URL,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
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
    apiBaseUrl: parsed.data.EXPO_PUBLIC_API_BASE_URL,
    scoreApiBaseUrl: parsed.data.EXPO_PUBLIC_SCORE_API_BASE_URL ?? nostrAppViewBaseUrl,
    nostrGraphqlEndpoint:
      parsed.data.EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT ?? `${nostrAppViewBaseUrl}/graphql`,
    primalCacheUrl: parsed.data.EXPO_PUBLIC_PRIMAL_CACHE_URL ?? DEFAULT_PRIMAL_CACHE_URL,
  };
}

export const backendConfig = parseBackendConfig();
