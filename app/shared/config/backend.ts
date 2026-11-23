import { z } from 'zod';

/**
 * Primal's PUBLIC cache servers (Primal operates them; we only connect).
 * Tier 1 of the resilient Nostr data layer (`Primal caches → raw relays`).
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
  // Primal public cache server. Defaults to cache1 + cache2.
  EXPO_PUBLIC_PRIMAL_CACHE_URL: OptionalUrl,
});

type BackendEnvInput = Partial<Record<keyof z.input<typeof BackendEnv>, string | undefined>>;

type BackendConfig = {
  /** Primal public cache server URLs, tried in order. */
  primalCacheUrls: readonly string[];
};

function readBackendEnv(): BackendEnvInput {
  return {
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

  return {
    primalCacheUrls:
      splitUrls(parsed.data.EXPO_PUBLIC_PRIMAL_CACHE_URL) ?? DEFAULT_PRIMAL_CACHE_URLS,
  };
}

export const backendConfig = parseBackendConfig();
