import { GetInfoResponse } from '@cashu/cashu-ts';
import { ok, err, Result } from 'neverthrow';
import { apiLog } from './logger';
const BASE_URL = 'https://api.sovran.money/api';

export const PRICELIST_URL = `wss://ws.sovran.money`;

interface UserStats {
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
  profileEvent?: string;
  name?: string;
  displayName?: string;
  about?: string;
  banner?: string;
  picture?: string;
  image?: string;
  website?: string;
  lud16?: string;
  lud06?: string;
  nip05?: string;
  nip05Valid?: boolean;
  hasNip05Conflict?: boolean;
  created_at?: number;
  pubkey: string;
  npub?: string;
  reactions?: boolean;
  userStats?: UserStats;
}

interface SearchUsersResponse {
  query: string;
  limit: number;
  sort: string;
  results: UserProfile[];
  fromCache: boolean;
}

const safeFetch = async <T = any>(url: string): Promise<Result<T, Error>> => {
  try {
    apiLog.debug('api.fetch', { url });
    const res = await fetch(url);
    if (!res.ok) {
      apiLog.warn('api.fetch_error', { url, status: res.status });
      return err(new Error(`Fetch error: ${res.status} ${res.statusText}`));
    }
    const data = await res.json();
    return ok(data as T);
  } catch (e) {
    apiLog.error('api.fetch_failed', { url, error: e });
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
};

const safePost = async <T = any>(url: string, body: any): Promise<Result<T, Error>> => {
  try {
    apiLog.debug('api.post', { url });
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      apiLog.warn('api.post_error', { url, status: res.status });
      return err(new Error(`Post error: ${res.status} ${res.statusText}`));
    }
    const data = await res.json();
    return ok(data as T);
  } catch (e) {
    apiLog.error('api.post_failed', { url, error: e });
    return err(e instanceof Error ? e : new Error('Unknown error'));
  }
};

export const searchUsers = ({ query, limit = 10 }: { query: string; limit?: number }) => {
  const params = new URLSearchParams({ query });
  return safeFetch<SearchUsersResponse>(`${BASE_URL}/nostr/search?${params}`);
};

export interface AuditMintResponse {
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

export const getLatestVersion = ({
  storage,
}: {
  storage: {
    version: string;
  };
}) => safePost<{ version: string }>(`${BASE_URL}/app/latest-version`, storage);

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

export interface NostrProfileResponse {
  pubkey: string;
  npub: string;
  rank: number;
  followers: number;
  follows: number;
  score: number;
  topFollowers: TopFollower[];
  created_at: number;
  fromCache: boolean;
  mintUrl?: string;
}

export interface TopFollower {
  pubkey: string;
  npub: string;
  rank: number;
  name?: string;
  displayName?: string;
  picture?: string;
  image?: string;
  banner?: string;
  about?: string;
  nip05?: string;
  nip05Valid?: boolean;
  website?: string;
  lud16?: string;
}

export const fetchNostrProfile = (pubkey: string) =>
  safeFetch<NostrProfileResponse>(`${BASE_URL}/nostr/profile?pubkey=${pubkey}`);
