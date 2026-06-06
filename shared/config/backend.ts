import { z } from 'zod';

const DEFAULT_NOSTR_APPVIEW_BASE_URL = 'https://nagg.up.railway.app';
const DEFAULT_API_BASE_URL = 'https://api.sovran.money/api';

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
  // Flip the contacts/DM-list fetch from GraphQL `dmEnvelopes` to the dedicated
  // REST app-view `/nostr/dm/envelopes` once it's deployed. Defaults to GraphQL.
  EXPO_PUBLIC_NOSTR_DM_APPVIEW: z.preprocess(emptyStringToUndefined, z.string().optional()),
  // Flip the feed / thread / notifications fetches from GraphQL to nagg's REST
  // app-view (`/nostr/feed*`, `/nostr/thread`). Defaults to GraphQL; opt in only
  // after device testing the REST routes.
  EXPO_PUBLIC_NOSTR_FEED_APPVIEW: z.preprocess(emptyStringToUndefined, z.string().optional()),
});

type BackendEnvInput = Partial<Record<keyof z.input<typeof BackendEnv>, string | undefined>>;

type BackendConfig = {
  nostrAppViewBaseUrl: string;
  apiBaseUrl: string;
  scoreApiBaseUrl: string;
  nostrGraphqlEndpoint: string;
  /** Prefer the REST app-view `/nostr/dm/envelopes` for the contacts/DM list. */
  nostrDmAppView: boolean;
  /** Route feed / thread / notifications fetches through nagg's REST app-view. */
  nostrFeedAppView: boolean;
};

function readBackendEnv(): BackendEnvInput {
  return {
    EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL: process.env.EXPO_PUBLIC_NOSTR_APPVIEW_BASE_URL,
    EXPO_PUBLIC_NAGG_BASE_URL: process.env.EXPO_PUBLIC_NAGG_BASE_URL,
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_SCORE_API_BASE_URL: process.env.EXPO_PUBLIC_SCORE_API_BASE_URL,
    EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT: process.env.EXPO_PUBLIC_NOSTR_GRAPHQL_ENDPOINT,
    EXPO_PUBLIC_NOSTR_DM_APPVIEW: process.env.EXPO_PUBLIC_NOSTR_DM_APPVIEW,
    EXPO_PUBLIC_NOSTR_FEED_APPVIEW: process.env.EXPO_PUBLIC_NOSTR_FEED_APPVIEW,
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
    nostrDmAppView: parsed.data.EXPO_PUBLIC_NOSTR_DM_APPVIEW === 'true',
    nostrFeedAppView: parsed.data.EXPO_PUBLIC_NOSTR_FEED_APPVIEW === 'true',
  };
}

export const backendConfig = parseBackendConfig();
