import { GetInfoResponse } from '@cashu/cashu-ts';
import { ok, err, Result } from 'neverthrow';
import { apiLog } from './logger';
import {
  AuditMintResponse,
  CatalogResponse,
  LatestVersionResponse,
  MintReviewsResponse,
  MintSearchResponse,
  NostrProfileFull,
  SearchUsersResponse,
  loggableIssues,
  parseWith,
  type AuditMintResponse as AuditMintResponseType,
  type CatalogResponse as CatalogResponseType,
  type LatestVersionResponse as LatestVersionResponseType,
  type MintRecommendation,
  type MintReviewsResponse as MintReviewsResponseType,
  type MintSearchResponse as MintSearchResponseType,
  type MintSearchResult,
  type NostrProfileFull as NostrProfileFullType,
  type NostrSearchResult,
  type ParseError,
  type SearchUsersResponse as SearchUsersResponseType,
  type TopFollower,
} from '@sovranbitcoin/schemas';

const BASE_URL = 'https://api.sovran.money/api';

export const PRICELIST_URL = `wss://ws.sovran.money`;

// Re-export schema-derived types for backwards compatibility with legacy
// interface names used across the app. NostrProfileResponse / UserProfile
// are kept as aliases for the renamed NostrProfileFull / NostrSearchResult
// so downstream consumers don't need to churn their imports.
export type {
  AuditMintResponseType as AuditMintResponse,
  CatalogResponseType as WallpaperCatalogResponse,
  LatestVersionResponseType as LatestVersionResponse,
  MintRecommendation,
  MintReviewsResponseType as MintReviewsResponse,
  MintSearchResult,
  MintSearchResponseType as MintSearchResponse,
  NostrProfileFullType as NostrProfileResponse,
  NostrSearchResult as UserProfile,
  SearchUsersResponseType as SearchUsersResponse,
  TopFollower,
};

type FetchOrParseError = Error | ParseError;

function toError(e: FetchOrParseError): Error {
  if (e instanceof Error) return e;
  if ((e as ParseError).type === 'schema/zod') {
    const issues = (e as ParseError).issues.length;
    return new Error(`${(e as ParseError).where}: ${issues} schema issue(s)`);
  }
  return new Error('unknown error');
}

/**
 * Core fetch-parse helper. Network or HTTP errors surface as `Error`;
 * shape validation failures are logged with paths+codes (never raw input)
 * and collapsed into `Error` to preserve the existing caller signature.
 */
async function fetchParsed<T>(
  url: string,
  parser: (input: unknown) => Result<T, ParseError>,
  where: string,
  init?: RequestInit,
): Promise<Result<T, Error>> {
  try {
    apiLog.debug('api.fetch', { url });
    const res = await fetch(url, init);
    if (!res.ok) {
      apiLog.warn('api.fetch_error', { url, status: res.status });
      return err(new Error(`Fetch error: ${res.status} ${res.statusText}`));
    }
    const raw = await res.json();
    const parsed = parser(raw);
    if (parsed.isErr()) {
      apiLog.warn('api.parse_failed', { where, issues: loggableIssues(parsed.error) });
      return err(toError(parsed.error));
    }
    return ok(parsed.value);
  } catch (e) {
    apiLog.error('api.fetch_failed', { url, error: e });
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
}

// ---------------------------------------------------------------------------
// Parsers — hoisted to module scope to avoid Zod v4 JIT cost on each call.
// ---------------------------------------------------------------------------

const parseSearchUsers = parseWith(SearchUsersResponse, 'nostr/search');
const parseAuditMint = parseWith(AuditMintResponse, 'cashu/mint/audit');
const parseMintReviews = parseWith(MintReviewsResponse, 'cashu/mint/reviews');
const parseMintSearch = parseWith(MintSearchResponse, 'cashu/mints/search');
const parseNostrProfile = parseWith(NostrProfileFull, 'nostr/profile');
const parseLatestVersion = parseWith(LatestVersionResponse, 'app/latest-version');
const parseCatalog = parseWith(CatalogResponse, 'wallpapers/catalog');

// ---------------------------------------------------------------------------
// Public API client functions
// ---------------------------------------------------------------------------

export const searchUsers = ({ query, limit = 10 }: { query: string; limit?: number }) => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return fetchParsed(
    `${BASE_URL}/nostr/search?${params}`,
    parseSearchUsers,
    'nostr/search',
  );
};

export const auditMint = ({ mintUrl }: { mintUrl: string }) =>
  fetchParsed(
    `${BASE_URL}/cashu/mint/audit?mintUrl=${encodeURIComponent(mintUrl)}`,
    parseAuditMint,
    'cashu/mint/audit',
  );

export const reviewMint = ({ mintUrl }: { mintUrl: string }) =>
  fetchParsed(
    `${BASE_URL}/cashu/mint/reviews?mintUrl=${encodeURIComponent(mintUrl)}`,
    parseMintReviews,
    'cashu/mint/reviews',
  );

export const searchMints = ({
  query,
  currency,
  limit,
  fields,
}: {
  query?: string;
  currency?: string;
  limit?: number;
  /** Comma-separated dot paths for /v1/info projection, e.g. "nuts.4,contact" or "*" */
  fields?: string;
}) =>
  fetchParsed(
    `${BASE_URL}/cashu/mints/search?${new URLSearchParams({
      ...(query && { q: query }),
      ...(currency && currency !== 'ALL' && { currency }),
      ...(limit && { limit: String(limit) }),
      ...(fields && { fields }),
    })}`,
    parseMintSearch,
    'cashu/mints/search',
  );

export const getLatestVersion = ({
  storage,
}: {
  storage: { version: string };
}) =>
  fetchParsed(
    `${BASE_URL}/app/latest-version`,
    parseLatestVersion,
    'app/latest-version',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage }),
    },
  );

export const fetchNostrProfile = (pubkey: string) =>
  fetchParsed(
    `${BASE_URL}/nostr/profile?pubkey=${encodeURIComponent(pubkey)}`,
    parseNostrProfile,
    'nostr/profile',
  );

/**
 * Fetches the wallpaper catalog and validates it against the shared Zod schema.
 * Unknown top-level fields are silently dropped (Postel's Law); a malformed
 * envelope is coerced into an `Error` with the parse-issue count for the
 * UI layer and the detail is logged via `loggableIssues`.
 */
export const fetchWallpaperCatalog = () =>
  fetchParsed(
    `${BASE_URL}/wallpapers/catalog`,
    parseCatalog,
    'wallpapers/catalog',
  );

// ---------------------------------------------------------------------------
// Mint `/v1/info` — upstream Cashu shape, owned by `@cashu/cashu-ts`
//
// We deliberately don't validate this with a local Zod schema: the contract
// belongs to the cashu-ts library and we want their types to drive ours.
// Kept as a plain fetch + type-cast — callers treat it as `GetInfoResponse`.
// ---------------------------------------------------------------------------

export const fetchMintInfo = async (mintUrl: string): Promise<Result<GetInfoResponse, Error>> => {
  const normalizedUrl = mintUrl.endsWith('/') ? mintUrl : `${mintUrl}/`;
  const infoUrl = `${normalizedUrl}v1/info`;

  try {
    apiLog.debug('api.mint_info', { mintUrl });
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Request timeout for ${infoUrl}`)), 10000);
    });

    const fetchPromise = fetch(infoUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    const res = await Promise.race([fetchPromise, timeoutPromise]);

    if (!res.ok) {
      apiLog.warn('api.mint_info_error', { mintUrl, status: res.status });
      return err(
        new Error(`Mint info fetch error: ${res.status} ${res.statusText} for ${infoUrl}`)
      );
    }

    const data = await res.json();
    apiLog.debug('api.mint_info.ok', { mintUrl, name: data?.name, hasIcon: !!data?.icon_url });
    return ok(data as GetInfoResponse);
  } catch (e) {
    apiLog.error('api.mint_info_failed', { mintUrl, error: e });
    return err(
      e instanceof Error ? e : new Error(`Unknown error fetching mint info from ${infoUrl}`)
    );
  }
};
