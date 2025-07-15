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
  about: string;
  banner: string;
  picture: string;
  image: string;
  website: string;
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

export interface ProductPackage {
  packageCode: number | string;
  slug: string;
  name: string;
  price: number;
  currencyCode: string;
  volume: number;
  smsStatus: string;
  dataType: string;
  unusedValidTime: number;
  duration: number;
  durationUnit: string;
  location: string;
  description: string;
  activeType: string;
  favourite: boolean;
  retailPrice: number;
  speed: string;
}

export interface QuoteResponse {
  sats: number;
  request: string;
}

export interface OrderResponse {
  obj?: {
    orderNo: string;
    esimList?: any[];
  };
  [key: string]: any;
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

export const fetchProducts = () => {
  return safeFetch<{ success: boolean; obj?: { packageList: ProductPackage[] } }>(
    `${BASE_URL}/esim/products`
  );
};

export const fetchQuote = ({
  packageCode,
  iccid,
  type,
}: {
  packageCode: string | number;
  iccid?: string;
  type?: 'TOPUP' | 'BASE';
}) => {
  const params = new URLSearchParams({ packageCode: String(packageCode) });
  if (type === 'TOPUP' && iccid) {
    params.append('type', 'TOPUP');
    params.append('iccid', iccid);
  }
  return safeFetch<QuoteResponse>(`${BASE_URL}/esim/quote?${params}`);
};

export const fetchOrderData = ({
  request,
  packageCode,
  slug,
  iccid,
  type,
}: {
  request: string;
  packageCode: string | number;
  slug?: string;
  iccid?: string;
  type?: 'TOPUP';
}) => {
  const params = new URLSearchParams({ request, packageCode: String(packageCode) });
  if (type === 'TOPUP' && slug && iccid) {
    params.append('slug', slug);
    params.append('iccid', iccid);
    params.append('type', 'TOPUP');
  }
  return safeFetch<OrderResponse>(`${BASE_URL}/esim/order?${params}`);
};

export const fetchEsimData = ({ orderNo }: { orderNo: string }) =>
  safeFetch<OrderResponse>(`${BASE_URL}/order/query?orderNo=${orderNo}`);

export const searchUsers = ({ query, limit = 10 }: { query: string; limit?: number }) => {
  const params = new URLSearchParams({ query, limit: String(limit) });
  return safeFetch<SearchUsersResponse>(`${BASE_URL}/nostr/search?${params}`);
};

export const fetchVpnInvoice = ({ duration }: { duration: string | number }) =>
  safeFetch<{ payment_hash: string; payment_request: string }>(
    `${BASE_URL}/vpn/invoice?duration=${duration}`
  );

export const fetchVpnCountries = () => safeFetch<any>(`${BASE_URL}/vpn/countries`);

export const activateVpn = ({
  paymentHash,
  location,
}: {
  paymentHash: string;
  location: string;
}) => {
  const params = new URLSearchParams({ paymentHash, location });
  return safeFetch<any>(`${BASE_URL}/vpn/activate?${params}`);
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
