import { GetInfoResponse } from '@cashu/cashu-ts';
import { ok, err, Result } from 'neverthrow';

const BASE_URL = 'https://api.sovran.money/api';

export const PRICELIST_URL = `wss://ws.sovran.money`;

export interface UserStats {
  pubkey: string;
  follows_count: number;
  followers_count: number;
  note_count: number;
  long_form_note_count: number;
  reply_count: number;
  time_joined: number;
  relay_count: number;
  total_zap_count: number;
  total_satszapped: number;
  media_count: number;
  content_zap_count: number;
}

export interface UserProfile {
  profileEvent: string;
  name: string;
  displayName: string;
  about?: string;
  banner?: string;
  picture: string;
  image: string;
  website?: string;
  lud16: string;
  lud06?: string;
  nip05?: string;
  nip05Valid: boolean;
  hasNip05Conflict: boolean;
  created_at: number;
  pubkey: string;
  npub: string;
  reactions?: boolean;
  userStats?: UserStats;
}

export interface SearchUsersResponse {
  query: string;
  limit: number;
  sort: string;
  results: UserProfile[];
  fromCache: boolean;
}

export interface SearchResult {
  profileEvent: string;
  [key: string]: any;
}

const safeFetch = async <T = any>(url: string): Promise<Result<T, Error>> => {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return err(new Error(`Fetch error: ${res.status} ${res.statusText}`));
    }
    const data = await res.json();
    return ok(data as T);
  } catch (e) {
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
};

const safePost = async <T = any>(url: string, body: any): Promise<Result<T, Error>> => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return err(new Error(`Post error: ${res.status} ${res.statusText}`));
    }
    const data = await res.json();
    return ok(data as T);
  } catch (e) {
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
};

export const searchUsers = ({ query, limit = 10 }: { query: string; limit?: number }) => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return safeFetch<SearchUsersResponse>(`${BASE_URL}/nostr/search?${params}`);
};

interface AuditMintResponse {
  id: number;
  url: string;
  info: GetInfoResponse;
  name: string;
  balance: number;
  sum_donations: number;
  updated_at: string;
  next_update: string;
  state: string;
  n_errors: number;
  n_mints: number;
  n_melts: number;
  swaps: {
    id: number;
    from_id: number;
    to_id: number;
    from_url: string;
    to_url: string;
    amount: number;
    fee: number;
    created_at: string;
    time_taken: number;
    state: string;
    error: string | null;
  }[];
}

export const auditMint = ({ mintUrl }: { mintUrl: string }) =>
  safeFetch<AuditMintResponse>(`${BASE_URL}/cashu/mint/audit?mintUrl=${mintUrl}`);

// The point of this object is to extract the structure of the state object
// This is so we don't send the state object with all its private data
// The reason I'm doing this is so I can help ensure the users state is not corrupted or invalid
// It's not a fullproof solution, but it will allow me to purge parts of the state if unused
// or restructure the state object if needed without being concerned about bugs.
// If any private data is leaked from this that would be considered a bug.
// Also we can at the same time check if the user is on the latest version.
export const getLatestVersion = ({
  storage,
}: {
  storage: {
    version: string;
    store: object;
  };
}) => safePost<{ version: string }>(`${BASE_URL}/app/latest-version`, storage);

// Fetch mint info directly from the mint's /v1/info endpoint
export const fetchMintInfo = async (mintUrl: string): Promise<Result<GetInfoResponse, Error>> => {
  // Ensure the URL ends with a slash for consistency
  const normalizedUrl = mintUrl.endsWith('/') ? mintUrl : `${mintUrl}/`;
  const infoUrl = `${normalizedUrl}v1/info`;

  try {
    // Create a timeout promise that rejects after 10 seconds
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Request timeout for ${infoUrl}`)), 10000);
    });

    // Race the fetch against the timeout
    const fetchPromise = fetch(infoUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    const res = await Promise.race([fetchPromise, timeoutPromise]);

    if (!res.ok) {
      return err(
        new Error(`Mint info fetch error: ${res.status} ${res.statusText} for ${infoUrl}`)
      );
    }

    const data = await res.json();
    return ok(data as GetInfoResponse);
  } catch (e) {
    return err(
      e instanceof Error ? e : new Error(`Unknown error fetching mint info from ${infoUrl}`)
    );
  }
};
